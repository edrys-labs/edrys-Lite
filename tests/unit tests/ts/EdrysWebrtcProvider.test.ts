import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { EdrysWebrtcProvider } from '../../../src/ts/EdrysWebrtcProvider';
import * as Y from 'yjs';
import { encoding, decoding } from 'lib0';
import { WebrtcProvider } from 'y-webrtc'; 

// Partially mock y-webrtc so we don't lose the real WebrtcProvider class
vi.mock('y-webrtc', async () => {
  const originalModule = await vi.importActual<typeof import('y-webrtc')>('y-webrtc');
  return {
    ...originalModule
  };
});

// Mock BroadcastChannel
const mockPostMessage = vi.fn();
const mockAddEventListener = vi.fn();
const mockClose = vi.fn();

global.BroadcastChannel = vi.fn().mockImplementation(() => ({
  postMessage: mockPostMessage,
  addEventListener: mockAddEventListener,
  removeEventListener: mockAddEventListener,
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
    
    // Mock the peer map
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

    // Get the listener and bind it to the provider
    const listener = mockAddEventListener.mock.calls[0][1].bind(provider);

    // Call the bound listener
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

    // Mock a real Map for webrtcConns
    (provider as any).room = { webrtcConns: new Map() };
    (provider as any).room.webrtcConns.set(peerId, mockConn);

    provider['_setupPeerListeners'](peerId);

    // Verify peer event listeners were set up
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

    // Mock a real Map for webrtcConns
    (provider as any).room = { webrtcConns: new Map() };
    (provider as any).room.webrtcConns.set(peerId, mockConn);
    
    provider['_setupPeerListeners'](peerId);

    provider['_peerUserIds'].set(peerId, userId);
    provider.onLeave(leaveCallback);

    // Simulate peer disconnection
    const closeHandler = mockPeer.on.mock.calls.find(([evt]) => evt === 'close')?.[1];
    closeHandler && closeHandler();

    expect(leaveCallback).toHaveBeenCalledWith(userId);
    expect(provider['_peerUserIds'].has(peerId)).toBe(false);
    expect(provider['_userIdToPeer'].has(userId)).toBe(false);
  });

  test('should handle incoming data messages', () => {
    const mockCallback = vi.fn();
    provider.onMessage(mockCallback);

    const message = { type: 'test', content: 'hello', id: 'msg-123' };
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 42); // MESSAGE_TYPE_CUSTOM
    encoding.writeVarString(encoder, JSON.stringify(message));
    const encodedMessage = encoding.toUint8Array(encoder);

    // Simulate incoming data
    provider['_handleIncomingData'](encodedMessage, 'sender-123', mockPeer);

    expect(mockCallback).toHaveBeenCalledWith(message);
  });

  test('should prevent duplicate messages', () => {
    const mockCallback = vi.fn();
    provider.onMessage(mockCallback);

    const message = { id: 'duplicate-123', content: 'test' };

    // Send the same message twice
    provider['_handleIncomingData'](
      (() => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 42); // MESSAGE_TYPE_CUSTOM
        encoding.writeVarString(encoder, JSON.stringify(message));
        return encoding.toUint8Array(encoder);
      })(),
      'sender-123',
      mockPeer
    );
    provider['_handleIncomingData'](
      (() => {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 42); // MESSAGE_TYPE_CUSTOM
        encoding.writeVarString(encoder, JSON.stringify(message));
        return encoding.toUint8Array(encoder);
      })(),
      'sender-123',
      mockPeer
    );

    expect(mockCallback).toHaveBeenCalledTimes(1);
  });

  test('should clean up resources on destroy', () => {
    provider.destroy();

    expect(mockClose).toHaveBeenCalled();
    expect(provider['_messageListener']).toBeNull();
    expect(provider['_leaveListener']).toBeNull();
    expect(provider['_cleanupInterval']).toBeNull();
  });

  test('should handle peer ID exchange', () => {
    const remoteUserId = 'remote-user-123';
    const peerId = 'peer-456';

    // Create encoded ID message
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 43); // MESSAGE_TYPE_ID
    encoding.writeVarString(encoder, remoteUserId);
    const encodedMessage = encoding.toUint8Array(encoder);

    // Simulate receiving ID message
    provider['_handleIncomingData'](encodedMessage, peerId, mockPeer);

    expect(provider['_peerUserIds'].get(peerId)).toBe(remoteUserId);
    expect(provider['_userIdToPeer'].get(remoteUserId)).toBe(mockPeer);
  });

  test('should clean up old processed messages', () => {
    vi.useFakeTimers();
    const message = { id: 'test-123', content: 'test' };
    
    // Add a message
    provider['_processedMessages'].set(message.id, Date.now());
    
    // Advance time by 11 seconds
    vi.advanceTimersByTime(11000);
    
    // Trigger cleanup
    provider['_cleanupProcessedMessages']();
    
    expect(provider['_processedMessages'].has(message.id)).toBe(false);
    
    vi.useRealTimers();
  });
});
