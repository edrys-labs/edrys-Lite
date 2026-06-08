import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { EdrysWebsocketProvider } from '../../../src/ts/EdrysWebsocketProvider';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

vi.mock('../../../src/ts/Utils', () => ({
  getPeerID: vi.fn(() => 'test-pubkey'),
  signChallenge: vi.fn(() => Promise.resolve('mock-signature')),
  verifyChallenge: vi.fn(() => Promise.resolve(true)),
  REVERT_INVALID_ORIGIN: 'revert-invalid',
}));

vi.mock('y-websocket', () => {
  return {
    WebsocketProvider: vi.fn().mockImplementation(() => {
      const mockAwareness = {
        setLocalState: vi.fn(),
        getLocalState: vi.fn().mockReturnValue({}),
        on: vi.fn(),
        getStates: vi.fn().mockReturnValue(new Map())
      };
      
      return {
        on: vi.fn(),
        destroy: vi.fn(),
        disconnect: vi.fn(),
        connect: vi.fn(),
        awareness: mockAwareness
      };
    })
  };
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

describe('EdrysWebsocketProvider', () => {
  let provider: EdrysWebsocketProvider;
  let doc: Y.Doc;

  beforeEach(() => {
    vi.clearAllMocks();
    doc = new Y.Doc();
    
    provider = new EdrysWebsocketProvider('test-room', doc, {
      serverUrl: 'wss://test.server',
      userid: 'test-user-123'
    });
  });

  afterEach(() => {
    provider.destroy();
    vi.clearAllMocks();
  });

  test('should initialize with correct parameters', () => {
    expect(provider.userid).toBe('test-user-123');
    expect(WebsocketProvider).toHaveBeenCalledWith(
      'wss://test.server',
      'test-room',
      expect.anything(),
      expect.objectContaining({
        connect: true,
        params: { userid: 'test-user-123' }
      })
    );
    expect(BroadcastChannel).toHaveBeenCalledWith('custom-ws-provider-test-room');
  });

  test('should handle message sending', () => {
    // Mock Date.now for consistent ID generation
    const mockNow = 12345678;
    vi.spyOn(Date, 'now').mockReturnValue(mockNow);
    
    const message = { type: 'test', content: 'hello' };
    provider.sendMessage(message);

    // Check that the message was added to history and sent via BroadcastChannel
    expect(mockPostMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'test',
      content: 'hello',
      id: expect.stringContaining(mockNow.toString())
    }));
    
    // Check that the awareness state was updated with the message
    expect(provider['provider'].awareness.setLocalState).toHaveBeenCalledWith(
      expect.objectContaining({
        customMessage: expect.objectContaining({
          type: 'test',
          content: 'hello'
        })
      })
    );
  });

  test('should register message listeners', () => {
    const mockCallback = vi.fn();
    provider.onMessage(mockCallback);

    const message = { type: 'test', content: 'hello', id: 'msg-123' };
    const event = { data: message };

    // Get the listener and call it directly
    const listener = mockAddEventListener.mock.calls[0][1];
    listener(event);

    expect(mockCallback).toHaveBeenCalledWith(message);
  });

  test('should prevent duplicate messages', () => {
    const mockCallback = vi.fn();
    provider.onMessage(mockCallback);

    const message = { id: 'duplicate-msg', content: 'test' };
    const event = { data: message };

    // Call the listener twice with the same message
    const listener = mockAddEventListener.mock.calls[0][1];
    listener(event);
    listener(event);

    // Callback should only be called once because the second message is a duplicate
    expect(mockCallback).toHaveBeenCalledTimes(1);
  });

  test('should register leave listeners', () => {
    const leaveCallback = vi.fn();
    provider.onLeave(leaveCallback);

    expect(provider['_leaveListener']).toBe(leaveCallback);
  });

  test('should handle awareness updates', () => {
    const awarenessCallback = vi.mocked(provider['provider'].awareness.on).mock.calls.find(
      call => call[0] === 'update'
    )?.[1];

    expect(awarenessCallback).toBeDefined();

    // Mock user state
    const mockState = new Map();
    mockState.set(1, {
      user: { id: 'other-user', heartbeat: Date.now() }
    });
    
    vi.mocked(provider['provider'].awareness.getStates).mockReturnValue(mockState);

    // Simulate awareness update with a custom message
    awarenessCallback?.({
      added: [],
      updated: [1],
      removed: []
    });

    // Pre-verify the user so custom messages from them are accepted
    provider['_verifiedUsers'].add('other-user');

    // Mock retrieving a state with a custom message
    mockState.set(1, {
      user: { id: 'other-user', heartbeat: Date.now() },
      customMessage: { type: 'test', content: 'via awareness', id: 'msg-via-awareness' }
    });

    // Simulate another update that includes a custom message
    const mockMessageCallback = vi.fn();
    provider.onMessage(mockMessageCallback);

    awarenessCallback?.({
      added: [],
      updated: [1],
      removed: []
    });

    // Should process the custom message from awareness
    expect(mockMessageCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'test',
        content: 'via awareness'
      })
    );
  });

  test('should handle user disconnections through heartbeat checks', () => {
    const leaveCallback = vi.fn();
    provider.onLeave(leaveCallback);

    // Add a user to track
    provider['_lastHeartbeats'].set('disconnected-user', Date.now() - 20000); // Older than PEER_TIMEOUT
    provider['_connectedUsers'].add('disconnected-user');

    // Run the heartbeat check
    provider['_checkHeartbeats']();

    // Should have notified about disconnection
    expect(leaveCallback).toHaveBeenCalledWith('disconnected-user');
    
    // Should have removed from tracking
    expect(provider['_lastHeartbeats'].has('disconnected-user')).toBe(false);
    expect(provider['_connectedUsers'].has('disconnected-user')).toBe(false);
  });

  test('should handle heartbeat sending', async () => {
    const mockTime = 12345678;
    vi.spyOn(Date, 'now').mockReturnValue(mockTime);

    vi.mocked(provider['provider'].awareness.getLocalState).mockReturnValue({
      user: { id: 'test-user-123' }
    });

    provider['_sendHeartbeat']();
    await Promise.resolve();

    expect(provider['provider'].awareness.setLocalState).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({
          id: 'test-user-123',
          heartbeat: mockTime,
          publicKey: 'test-pubkey',
          signature: 'mock-signature',
        })
      })
    );
  });

  describe('Peer signature verification via awareness', () => {
    let awarenessCallback: Function;
    let mockState: Map<number, any>;

    beforeEach(() => {
      awarenessCallback = vi.mocked(provider['provider'].awareness.on).mock.calls.find(
        call => call[0] === 'update'
      )![1];

      mockState = new Map();
      vi.mocked(provider['provider'].awareness.getStates).mockReturnValue(mockState);
    });

    test('calls verifyChallenge when peer provides publicKey and signature', async () => {
      const { verifyChallenge } = await import('../../../src/ts/Utils');

      mockState.set(2, {
        user: { id: 'remote-user', publicKey: 'their-pubkey', signature: 'their-sig' }
      });

      awarenessCallback({ added: [], updated: [2], removed: [] });
      await Promise.resolve();

      expect(verifyChallenge).toHaveBeenCalledWith('test-room', 'their-pubkey', 'their-sig');
    });

    test('adds peer to _verifiedUsers after successful signature verification', async () => {
      mockState.set(2, {
        user: { id: 'remote-user', publicKey: 'their-pubkey', signature: 'their-sig' }
      });

      awarenessCallback({ added: [], updated: [2], removed: [] });
      await Promise.resolve();

      expect(provider['_verifiedUsers'].has('remote-user')).toBe(true);
    });

    test('does not add peer to _verifiedUsers when signature verification fails', async () => {
      const { verifyChallenge } = await import('../../../src/ts/Utils');
      vi.mocked(verifyChallenge).mockResolvedValueOnce(false);

      mockState.set(2, {
        user: { id: 'bad-actor', publicKey: 'fake-pubkey', signature: 'fake-sig' }
      });

      awarenessCallback({ added: [], updated: [2], removed: [] });
      await Promise.resolve();

      expect(provider['_verifiedUsers'].has('bad-actor')).toBe(false);
    });

    test('drops custom message from unverified peer', async () => {
      const mockCallback = vi.fn();
      provider.onMessage(mockCallback);

      // peer has no publicKey/signature — stays unverified
      mockState.set(2, {
        user: { id: 'unverified-user' },
        customMessage: { type: 'attack', id: 'evil-msg' }
      });

      awarenessCallback({ added: [], updated: [2], removed: [] });
      await Promise.resolve();

      expect(mockCallback).not.toHaveBeenCalled();
    });

    test('does not re-verify already verified peer', async () => {
      const { verifyChallenge } = await import('../../../src/ts/Utils');
      provider['_verifiedUsers'].add('known-user');

      mockState.set(2, {
        user: { id: 'known-user', publicKey: 'their-pubkey', signature: 'their-sig' }
      });

      awarenessCallback({ added: [], updated: [2], removed: [] });
      await Promise.resolve();

      expect(verifyChallenge).not.toHaveBeenCalled();
    });
  });

  test('should clean up processed messages', () => {
    vi.useFakeTimers();
    
    // Add some messages to the processed list
    provider['_processedMessages'].set('old-msg', Date.now() - 15000); // Older than MESSAGE_EXPIRATION_TIME
    provider['_processedMessages'].set('new-msg', Date.now());

    // Run the cleanup
    provider['_cleanupProcessedMessages']();

    // Old message should be removed, new message should remain
    expect(provider['_processedMessages'].has('old-msg')).toBe(false);
    expect(provider['_processedMessages'].has('new-msg')).toBe(true);

    vi.useRealTimers();
  });

  test('should add messages to history', () => {
    const message = { type: 'test', content: 'hello', id: 'history-test' };
    
    // Add the message to history
    provider['_addMessageToHistory'](message);
    
    // Check that it's in the history
    expect(provider.getMessageHistory()).toContainEqual(message);
    
    // Test history limit
    const MAX_MESSAGES = 50;
    
    // Add more messages than the limit
    for (let i = 0; i < MAX_MESSAGES + 10; i++) {
      provider['_addMessageToHistory']({ id: `msg-${i}` });
    }
    
    // History should be limited to MAX_MESSAGES
    expect(provider.getMessageHistory().length).toBe(MAX_MESSAGES);
    
    // The oldest message (the first one) should have been removed
    expect(provider.getMessageHistory().find(m => m.id === 'history-test')).toBeUndefined();
  });

  test('should clean up resources on destroy', () => {
    // Save references to intervals before they're cleared
    const cleanupInterval = provider['_cleanupInterval'];
    const heartbeatInterval = provider['_heartbeatInterval'];
    
    // Mock clearInterval
    const clearIntervalSpy = vi.spyOn(window, 'clearInterval');
    
    provider.destroy();

    expect(provider['provider'].disconnect).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
    expect(mockRemoveEventListener).toHaveBeenCalled();
    
    // Check that intervals were cleared
    expect(clearIntervalSpy).toHaveBeenCalledWith(cleanupInterval);
    expect(clearIntervalSpy).toHaveBeenCalledWith(heartbeatInterval);
    expect(provider['_cleanupInterval']).toBeNull();
    expect(provider['_heartbeatInterval']).toBeNull();
    
    // Check that data structures were cleared
    expect(provider['_processedMessages'].size).toBe(0);
    expect(provider['_lastHeartbeats'].size).toBe(0);
    expect(provider['_connectedUsers'].size).toBe(0);
  });

  test('should provide connectivity methods', () => {
    provider.connect();
    expect(provider['provider'].connect).toHaveBeenCalled();

    provider.disconnect();
    expect(provider['provider'].disconnect).toHaveBeenCalled();
  });

  describe('Sync-layer revert filter', () => {
    test('replaces base provider\'s _updateHandler with a wrap', () => {
      const baseSpy = vi.fn();
      const localDoc = new Y.Doc();

      const WsCtor = WebsocketProvider as any;
      const previousImpl = WsCtor.getMockImplementation();
      WsCtor.mockImplementationOnce(() => ({
        on: vi.fn(),
        destroy: vi.fn(),
        disconnect: vi.fn(),
        connect: vi.fn(),
        awareness: { setLocalState: vi.fn(), getLocalState: () => ({}), on: vi.fn(), getStates: () => new Map() },
        _updateHandler: baseSpy,
      }));
      localDoc.on('update', baseSpy);

      const p = new EdrysWebsocketProvider('rev-room', localDoc, { serverUrl: 'wss://test', userid: 'u' });

      const wrapped = (p as any).provider._updateHandler;
      expect(typeof wrapped).toBe('function');
      expect(wrapped).not.toBe(baseSpy);

      const m = localDoc.getMap('users');
      localDoc.transact(() => m.set('a', 1), 'normal');
      localDoc.transact(() => m.set('a', 2), 'revert-invalid');

      expect(baseSpy).toHaveBeenCalledTimes(1);
      expect(baseSpy.mock.calls[0][1]).toBe('normal');

      p.destroy();
      if (previousImpl) WsCtor.mockImplementation(previousImpl);
    });
  });
});
