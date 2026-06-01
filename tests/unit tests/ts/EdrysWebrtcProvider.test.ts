import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { EdrysWebrtcProvider } from '../../../src/ts/EdrysWebrtcProvider';
import * as Y from 'yjs';
import { encoding, decoding } from 'lib0';

vi.mock('../../../src/ts/Utils', () => ({
  getPeerID: vi.fn(() => 'test-pubkey-base64'),
  signChallenge: vi.fn(() => Promise.resolve('mock-signature')),
  verifyChallenge: vi.fn(() => Promise.resolve(true)),
  REVERT_INVALID_ORIGIN: 'revert-invalid',
}));

// Mock WebrtcProvider as a minimal base class that EdrysWebrtcProvider can extend
// without triggering real WebRTC/signaling connections.
vi.mock('y-webrtc', () => {
  class WebrtcProvider {
    room: any = null;
    awareness: any = { setLocalState: vi.fn(), getLocalState: vi.fn(() => ({})), on: vi.fn() };
    doc: any;
    // Simulates y-webrtc's own update handler that the real provider attaches to the doc.
    _docUpdateHandler: (update: Uint8Array, origin: any) => void;
    on(_event: string, _cb: any) {}
    destroy() {}
    disconnect() {}
    connect() {}
    constructor(_roomName: string, doc: any, _options?: any) {
      this.doc = doc;
      this._docUpdateHandler = vi.fn();
      doc.on('update', this._docUpdateHandler);
    }
  }
  return { WebrtcProvider };
});

// Mock BroadcastChannel
const mockPostMessage = vi.fn();
const mockAddEventListener = vi.fn();
const mockRemoveEventListener = vi.fn();
const mockClose = vi.fn();

global.BroadcastChannel = vi.fn().mockImplementation(() => ({
  postMessage: mockPostMessage,
  addEventListener: mockAddEventListener,
  removeEventListener: mockRemoveEventListener,
  close: mockClose,
}));

describe('EdrysWebrtcProvider', () => {
  let provider: EdrysWebrtcProvider;
  let doc: Y.Doc;
  let mockPeer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    doc = new Y.Doc();

    mockPeer = {
      on: vi.fn(),
      send: vi.fn(),
      destroy: vi.fn(),
      connected: true,
    };

    provider = new EdrysWebrtcProvider('test-room', doc, {
      signaling: ['wss://example.local'],
      password: 'test-password',
      userid: 'test-user-123',
    });
  });

  afterEach(() => {
    provider.destroy();
    vi.clearAllMocks();
  });

  test('should initialize with correct parameters', () => {
    expect(provider.userid).toBe('test-user-123');
    expect(BroadcastChannel).toHaveBeenCalledWith('custom-webrtc-provider-test-room');
  });

  test('should handle message sending', () => {
    const message = { type: 'test', content: 'hello' };
    provider.sendMessage(message);

    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'test',
      content: 'hello',
      id: expect.any(String),
    }));
  });

  test('should handle targeted message sending', () => {
    const targetUserId = 'target-user-123';
    const message = { type: 'direct', content: 'hello' };

    provider['_userIdToPeer'].set(targetUserId, mockPeer);
    (provider as any).room = { webrtcConns: new Map() };

    provider.sendMessage(message, targetUserId);

    expect(mockPeer.send).toHaveBeenCalled();
    expect(mockPostMessage).toHaveBeenCalled();
  });

  test('should register message listeners', () => {
    const mockCallback = vi.fn();
    provider.onMessage(mockCallback);

    const message = { type: 'test', content: 'hello' };
    const event = { data: message };

    const listener = mockAddEventListener.mock.calls[0][1].bind(provider);
    listener(event);

    expect(mockCallback).toHaveBeenCalledWith(message);
  });

  test('should handle peer connections', () => {
    const peerId = 'peer-123';
    const mockConn = {
      remotePeerId: peerId,
      peer: mockPeer,
      room: provider.room,
      glareToken: Math.random(),
      closed: false,
      connected: true,
      destroy: vi.fn(),
      synced: true,
    };

    (provider as any).room = { webrtcConns: new Map() };
    (provider as any).room.webrtcConns.set(peerId, mockConn);

    provider['_setupPeerListeners'](peerId);

    expect(mockPeer.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockPeer.on).toHaveBeenCalledWith('data', expect.any(Function));
    expect(mockPeer.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(mockPeer.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  test('should handle peer disconnection', () => {
    const peerId = 'peer-123';
    const userId = 'user-123';
    const leaveCallback = vi.fn();

    const mockConn = {
      remotePeerId: peerId,
      peer: mockPeer,
      room: provider.room,
      glareToken: Math.random(),
      closed: false,
      connected: true,
      destroy: vi.fn(),
      synced: true,
    };

    (provider as any).room = { webrtcConns: new Map() };
    (provider as any).room.webrtcConns.set(peerId, mockConn);

    provider['_setupPeerListeners'](peerId);
    provider['_peerUserIds'].set(peerId, userId);
    provider['_userIdToPeer'].set(userId, mockPeer);
    provider.onLeave(leaveCallback);

    const closeHandler = mockPeer.on.mock.calls.find(([evt]) => evt === 'close')?.[1];
    closeHandler && closeHandler();

    expect(leaveCallback).toHaveBeenCalledWith(userId);
    expect(provider['_peerUserIds'].has(peerId)).toBe(false);
    expect(provider['_userIdToPeer'].has(userId)).toBe(false);
  });

  test('should handle incoming custom data messages', () => {
    const mockCallback = vi.fn();
    provider.onMessage(mockCallback);

    const message = { type: 'test', content: 'hello', id: 'msg-123' };
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 42); // MESSAGE_TYPE_CUSTOM
    encoding.writeVarString(encoder, JSON.stringify(message));

    provider['_handleIncomingData'](encoding.toUint8Array(encoder), 'sender-123', mockPeer);

    expect(mockCallback).toHaveBeenCalledWith(message);
  });

  test('should prevent duplicate custom messages', () => {
    const mockCallback = vi.fn();
    provider.onMessage(mockCallback);

    const message = { id: 'duplicate-123', content: 'test' };
    const encode = () => {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 42);
      encoding.writeVarString(enc, JSON.stringify(message));
      return encoding.toUint8Array(enc);
    };

    provider['_handleIncomingData'](encode(), 'sender-123', mockPeer);
    provider['_handleIncomingData'](encode(), 'sender-123', mockPeer);

    expect(mockCallback).toHaveBeenCalledTimes(1);
  });

  // Handshake flow: ID message puts peer in _pendingVerification; handshake message verifies and promotes
  describe('Handshake flow', () => {
    const peerId = 'peer-456';
    const remoteUserId = 'remote-user-456';

    function encodeId(userId: string) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 43); // MESSAGE_TYPE_ID
      encoding.writeVarString(enc, userId);
      return encoding.toUint8Array(enc);
    }

    function encodeHandshake(pubKey: string, sig: string) {
      const enc = encoding.createEncoder();
      encoding.writeVarUint(enc, 44); // MESSAGE_TYPE_HANDSHAKE
      encoding.writeVarString(enc, pubKey);
      encoding.writeVarString(enc, sig);
      return encoding.toUint8Array(enc);
    }

    test('ID message places peer in pendingVerification, not yet in peerUserIds', () => {
      provider['_handleIncomingData'](encodeId(remoteUserId), peerId, mockPeer);

      expect(provider['_pendingVerification'].get(peerId)).toMatchObject({ userid: remoteUserId });
      expect(provider['_peerUserIds'].has(peerId)).toBe(false);
    });

    test('valid handshake promotes peer from pending to verified maps', async () => {
      provider['_handleIncomingData'](encodeId(remoteUserId), peerId, mockPeer);
      provider['_handleIncomingData'](encodeHandshake('test-pubkey', 'valid-sig'), peerId, mockPeer);

      await Promise.resolve(); // flush verifyChallenge promise

      expect(provider['_peerUserIds'].get(peerId)).toBe(remoteUserId);
      expect(provider['_userIdToPeer'].get(remoteUserId)).toBe(mockPeer);
      expect(provider['_pendingVerification'].has(peerId)).toBe(false);
    });

    test('invalid handshake destroys the peer and clears pending state', async () => {
      const { verifyChallenge } = await import('../../../src/ts/Utils');
      vi.mocked(verifyChallenge).mockResolvedValueOnce(false);

      provider['_handleIncomingData'](encodeId(remoteUserId), peerId, mockPeer);
      provider['_handleIncomingData'](encodeHandshake('bad-pubkey', 'bad-sig'), peerId, mockPeer);

      await Promise.resolve();

      expect(mockPeer.destroy).toHaveBeenCalled();
      expect(provider['_pendingVerification'].has(peerId)).toBe(false);
      expect(provider['_peerUserIds'].has(peerId)).toBe(false);
    });

    test('handshake message with no preceding ID message is a no-op', () => {
      provider['_handleIncomingData'](encodeHandshake('pubkey', 'sig'), peerId, mockPeer);

      expect(provider['_peerUserIds'].has(peerId)).toBe(false);
      expect(provider['_pendingVerification'].has(peerId)).toBe(false);
    });

    test('_cleanupProcessedMessages times out expired pending verifications', () => {
      provider['_pendingVerification'].set(peerId, {
        userid: remoteUserId,
        peer: mockPeer,
        expiresAt: Date.now() - 1,
      });

      provider['_cleanupProcessedMessages']();

      expect(mockPeer.destroy).toHaveBeenCalled();
      expect(provider['_pendingVerification'].has(peerId)).toBe(false);
    });
  });

  test('_sendOwnId sends ID message then signed handshake', async () => {
    provider['_sendOwnId'](mockPeer);

    // First send: ID message (synchronous)
    expect(mockPeer.send).toHaveBeenCalledTimes(1);

    await Promise.resolve(); // flush signChallenge promise

    // Second send: handshake message
    expect(mockPeer.send).toHaveBeenCalledTimes(2);

    // Verify the handshake message contains MESSAGE_TYPE_HANDSHAKE (44)
    const handshakeBytes: Uint8Array = mockPeer.send.mock.calls[1][0];
    const decoder = decoding.createDecoder(handshakeBytes);
    expect(decoding.readVarUint(decoder)).toBe(44);
  });

  test('should clean up resources on destroy', () => {
    provider.destroy();

    expect(mockClose).toHaveBeenCalled();
    expect(provider['_messageListener']).toBeNull();
    expect(provider['_leaveListener']).toBeNull();
    expect(provider['_cleanupInterval']).toBeNull();
  });

  test('should clean up old processed messages', () => {
    vi.useFakeTimers();
    const message = { id: 'test-123', content: 'test' };

    provider['_processedMessages'].set(message.id, Date.now());
    vi.advanceTimersByTime(11000);
    provider['_cleanupProcessedMessages']();

    expect(provider['_processedMessages'].has(message.id)).toBe(false);
    vi.useRealTimers();
  });

  describe('Sync-layer revert filter', () => {
    test('drops doc updates with REVERT_INVALID_ORIGIN, forwards everything else', () => {
      provider.destroy();

      const localDoc = new Y.Doc();
      const localProvider = new EdrysWebrtcProvider('revert-room', localDoc, {
        signaling: ['wss://example.local'],
        userid: 'rev-user',
      });

      const wrapped = (localProvider as any)._docUpdateHandler as (u: Uint8Array, o: any) => any;
      localDoc.off('update', wrapped);
      const seenByWrap: any[] = [];
      let baseCalls = 0;
      const baseSpy = vi.fn((_u: Uint8Array, _o: any) => { baseCalls++ });
      const inspectorWrap = (update: Uint8Array, origin: any) => {
        seenByWrap.push(origin);
        if (origin === 'revert-invalid') return;
        baseSpy(update, origin);
      };
      localDoc.on('update', inspectorWrap);

      const m = localDoc.getMap('users');
      localDoc.transact(() => m.set('alice', 'lobby'), 'normal');
      localDoc.transact(() => m.set('alice', 'rolled-back'), 'revert-invalid');
      localDoc.transact(() => m.set('bob', 'room1'), 'another-normal');

      expect(seenByWrap).toEqual(['normal', 'revert-invalid', 'another-normal']);
      expect(baseCalls).toBe(2);

      localProvider.destroy();
    });

    test('wrap replaces the base provider\'s _docUpdateHandler', () => {
      const handler = (provider as any)._docUpdateHandler;
      expect(typeof handler).toBe('function');
      expect((handler as any).mock).toBeUndefined();
    });
  });

  describe('Signaling re-announce (stale subscription recovery)', () => {
    let signalingConn: { connected: boolean; send: ReturnType<typeof vi.fn> };
    let localProvider: EdrysWebrtcProvider;

    beforeEach(() => {
      // Construct a fresh provider here under fake timers so the re-announce interval is faked.
      vi.useFakeTimers();
      localProvider = new EdrysWebrtcProvider('test-room', doc, {
        signaling: ['wss://example.local'],
        password: 'test-password',
        userid: 'test-user-456',
      });
      signalingConn = { connected: true, send: vi.fn() };
      (localProvider as any).room = {
        name: 'test-room',
        peerId: 'webrtc-peer-id-abc',
        key: null,
        webrtcConns: new Map(),
      };
      (localProvider as any).signalingConns = [signalingConn];
    });

    afterEach(() => {
      localProvider.destroy();
      vi.useRealTimers();
    });

    test('re-sends subscribe and announce to connected signaling conns periodically', async () => {
      // Advance to first re-announce tick
      await vi.advanceTimersByTimeAsync(60000);

      const subscribeCall = signalingConn.send.mock.calls.find(
        ([msg]) => msg?.type === 'subscribe'
      );
      const publishCall = signalingConn.send.mock.calls.find(
        ([msg]) => msg?.type === 'publish'
      );

      expect(subscribeCall, 'expected a subscribe message after 60s').toBeDefined();
      expect(subscribeCall![0]).toEqual({
        type: 'subscribe',
        topics: ['test-room'],
      });

      expect(publishCall, 'expected a publish (announce) message after 60s').toBeDefined();
      expect(publishCall![0]).toMatchObject({
        type: 'publish',
        topic: 'test-room',
        data: { type: 'announce', from: 'webrtc-peer-id-abc' },
      });
    });

    test('skips signaling conns that are not connected', async () => {
      signalingConn.connected = false;

      await vi.advanceTimersByTimeAsync(60000);

      expect(signalingConn.send).not.toHaveBeenCalled();
    });

    test('does not throw when room is not yet initialized', async () => {
      (localProvider as any).room = null;

      await expect(vi.advanceTimersByTimeAsync(30000)).resolves.not.toThrow();
      expect(signalingConn.send).not.toHaveBeenCalled();
    });

    test('clears the re-announce interval on destroy', () => {
      expect((localProvider as any)._reAnnounceInterval).not.toBeNull();
      localProvider.destroy();
      expect((localProvider as any)._reAnnounceInterval).toBeNull();
    });
  });
});
