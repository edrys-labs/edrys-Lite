import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import Peer from '../../../src/ts/Peer';
import * as Y from 'yjs';
import { EdrysWebrtcProvider } from '../../../src/ts/EdrysWebrtcProvider';
import { EdrysWebsocketProvider } from '../../../src/ts/EdrysWebsocketProvider';
import { getPeerID, getShortPeerID, decodeCommConfig, updateUrlWithCommConfig } from '../../../src/ts/Utils';
import { i18n, messages } from '../../setup';

// Mock debug system
vi.mock('../../../src/api/debugHandler', () => {
  return {
    debug: {
      ts: {
        peer: vi.fn()
      }
    }
  }
});

// Mock dependencies
const mockWebsocketEvents = {
  status: null,
  synced: null,
};

const mockWebrtcEvents = {
  status: null,
  synced: null,
};

vi.mock('../../../src/ts/EdrysWebrtcProvider', () => ({
  EdrysWebrtcProvider: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockImplementation((event, callback) => {
      if (event === 'status') mockWebrtcEvents.status = callback;
      if (event === 'synced') mockWebrtcEvents.synced = callback;
    }),
    onLeave: vi.fn(),
    onMessage: vi.fn(),
    sendMessage: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock('../../../src/ts/EdrysWebsocketProvider', () => ({
  EdrysWebsocketProvider: vi.fn().mockImplementation(() => ({
    on: vi.fn().mockImplementation((event, callback) => {
      if (event === 'status') mockWebsocketEvents.status = callback;
      if (event === 'synced') mockWebsocketEvents.synced = callback;
    }),
    onLeave: vi.fn(),
    onMessage: vi.fn(),
    sendMessage: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  })),
}));

vi.mock('../../../src/ts/Utils', () => ({
  getPeerID: vi.fn(() => 'test-peer-id'),
  getShortPeerID: vi.fn(() => 'test-user'),
  hashJsonObject: vi.fn().mockResolvedValue('test-hash'),
  deepEqual: vi.fn((obj1, obj2) => {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }),
  throttle: vi.fn().mockImplementation((fn) => {
    return function(...args) {
      return fn.apply(this, args);
    };
  }),
  compareCommunicationConfig: vi.fn((oldConfig, newConfig) => {
    if (!oldConfig && !newConfig) return true;
    if (!oldConfig || !newConfig) return false;
    return JSON.stringify(oldConfig) === JSON.stringify(newConfig);
  }),
  updateUrlWithCommConfig: vi.fn(),
  decodeCommConfig: vi.fn((encodedConfig) => {
    if (!encodedConfig) return null;
    if (encodedConfig === 'encodedWebRTC') {
      return { communicationMethod: 'WebRTC', signalingServer: ['wss://test.com'] };
    } else if (encodedConfig === 'encodedWebsocket') {
      return { communicationMethod: 'Websocket', websocketUrl: 'wss://test.com' };
    } else if (typeof encodedConfig === 'object') {
      return encodedConfig;
    }
    return null;
  }),
}));

describe('Peer Class', () => {
  let peer: Peer;
  let setup: any;

  beforeEach(() => {
    vi.useFakeTimers();

    setup = {
      id: 'lab1',
      data: { 
        meta: { defaultNumberOfRooms: 1 }, 
        members: {teacher: [], student: []} 
      },
      timestamp: Date.now(),
      hash: null,
    };

    peer = new Peer(setup, undefined, i18n.global.t);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.clearAllMocks();
  });

  // Initialization Tests
  describe('Initialization', () => {
    test('should initialize setup correctly', () => {
      const setupMap = peer['y'].setup as Y.Map<any>;
      expect(peer['lab'].id).toBe(setup.id);
      expect(setupMap.get('config')).toEqual(setup.data);
      expect(setupMap.get('timestamp')).toBe(setup.timestamp);
      expect(peer.user().get('logicalClock')).toBe(0); 
    });

    test('should initialize user with correct default values', () => {
      const user = peer.user();
      expect(user.get('displayName')).toBe('test-user');
      expect(user.get('room')).toBe('Lobby');
      expect(user.get('role')).toBe('student');
      expect(user.get('dateJoined')).toBeDefined();
      expect(user.get('logicalClock')).toBe(0);
      expect(user.get('handRaised')).toBe(false);
      expect(user.get('connections')).toEqual([{ id: '', target: {} }]);
    });

    test('should initialize as station when stationID is provided', () => {
      const stationPeer = new Peer(setup, 'station1');
      expect(stationPeer.isStation()).toBeTruthy();
      expect(stationPeer['role']).toBe('station');
    });

    test('should call connectProvider on instantiation', () => {
      expect(EdrysWebrtcProvider).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.objectContaining({
          signaling: expect.any(Array),
          password: 'password',
          userid: peer['peerID'],
          peerOpts: expect.any(Object),
        })
      );
    });
  });

  // Communication Provider Management Tests
  describe('Communication Provider Management', () => {
    test('initializes with WebRTC provider by default', () => {
      const peer = new Peer(setup);
      expect(EdrysWebrtcProvider).toHaveBeenCalled();
      expect(EdrysWebsocketProvider).not.toHaveBeenCalled();
      expect(peer['providerType']).toBe('WebRTC');
    });

    test('initializes with WebSocket provider from encoded config', () => {
      const wsConfig = {
        ...setup,
        data: {
          ...setup.data,
          communicationConfig: 'encodedWebsocket'
        }
      };
      
      const peer = new Peer(wsConfig);
      expect(EdrysWebsocketProvider).toHaveBeenCalled();
      expect(peer['providerType']).toBe('Websocket');
      expect(peer['websocketUrl']).toBe('wss://test.com');
    });

    test('initializes with WebRTC provider from encoded config', () => {
      const rtcConfig = {
        ...setup,
        data: {
          ...setup.data,
          communicationConfig: 'encodedWebRTC'
        }
      };
      
      const peer = new Peer(rtcConfig);
      expect(EdrysWebrtcProvider).toHaveBeenCalled();
      expect(peer['providerType']).toBe('WebRTC');
      expect(peer['signalingServer']).toContain('wss://test.com');
    });

    test('switches provider at runtime', async () => {
      const peer = new Peer(setup);
      expect(peer['providerType']).toBe('WebRTC');
      
      // Mock providers
      const mockDisconnect = vi.fn();
      peer['provider'] = {
        disconnect: mockDisconnect,
        destroy: vi.fn(),
      } as any;
      
      await peer.switchProvider({
        communicationMethod: 'Websocket',
        websocketUrl: 'wss://new.websocket'
      });
      
      expect(mockDisconnect).toHaveBeenCalled();
      expect(peer['providerType']).toBe('Websocket');
      expect(peer['websocketUrl']).toBe('wss://new.websocket');
    });

    test('handles WebRTC configuration changes', async () => {
      const peer = new Peer(setup);
      const newConfig = { iceServers: [{ urls: 'stun:new.stun' }] };
      
      // Mock provider methods
      const mockDisconnect = vi.fn();
      peer['provider'] = {
        disconnect: mockDisconnect,
        destroy: vi.fn(),
      } as any;
      
      await peer.switchProvider({
        communicationMethod: 'WebRTC',
        webrtcConfig: newConfig
      });
      
      expect(mockDisconnect).toHaveBeenCalled();
      expect(peer['webrtcConfig']).toEqual(newConfig);
    });
  });

  // Provider Event Handling Tests
  describe('Provider Event Handling', () => {
    test('handles WebRTC provider events', async () => {
      const peer = new Peer(setup);
      const callback = vi.fn();
      peer.on('connected', callback);
      
      // Simulate status event
      mockWebrtcEvents.status?.({ status: 'connected' });
      
      // Need to wait for the connection timeout
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      
      expect(callback).toHaveBeenCalledWith(true);
    });

    test('handles WebSocket provider events', async () => {
      // Create setup with basic member structure
      const wsSetup = {
        ...setup,
        data: {
          ...setup.data,
          members: { student: ['*'], teacher: [] },
          communicationConfig: {
            communicationMethod: 'Websocket',
            websocketUrl: 'wss://test.com'
          }
        }
      };
      
      const peer = new Peer(wsSetup);
      const callback = vi.fn();
      peer.on('connected', callback);
      
      // Mock provider status event
      peer['provider'] = {
        on: vi.fn(),
        disconnect: vi.fn(),
        destroy: vi.fn(),
      } as any;
      
      // Simulate connected status
      peer['handleStatus']({ status: 'connected' });
      
      // Wait for connection timeout
      vi.advanceTimersByTime(5000);
      await Promise.resolve();
      
      expect(callback).toHaveBeenCalledWith(true);
    });
  });

  // Room Management Tests
  describe('Room Management', () => {
    test('should add default rooms', () => {
      const roomMap = peer['y'].rooms as Y.Map<any>;
      expect(roomMap.size).toEqual(2);
    });

    test('should manage room operations', () => {
      peer.addRoom('TestRoom');
      expect(peer['y'].rooms.has('TestRoom')).toBe(true);

      peer.gotoRoom('TestRoom');
      expect(peer.user().get('room')).toBe('TestRoom');

      peer['y'].doc.transact(() => {
        peer['y'].rooms.delete('TestRoom');
      });
      expect(peer.user().get('room')).toBe('Lobby');
    });

    test('should handle room deletions and move users to lobby', () => {
      const roomMap = peer['y'].rooms as Y.Map<any>;
      const userMap = peer['y'].users as Y.Map<any>;

      peer['y'].doc.transact(() => {
        roomMap.set('Room1', new Y.Map());
        userMap.get(peer['peerID']).set('room', 'Room1');
      });

      expect(userMap.get(peer['peerID']).get('room')).toBe('Room1');

      peer['y'].doc.transact(() => {
        roomMap.delete('Room1');
      });

      expect(userMap.get(peer['peerID']).get('room')).toBe('Lobby');
    });
  });

  // Peer Management Tests
  describe('Peer Management', () => {
    test('should remove stale peers using logical clocks', () => {
      const userMap = peer['y'].users as Y.Map<any>;
      const stalePeerID = 'stalePeer';
      
      peer['y'].doc.transact(() => {
        const staleUser = new Y.Map();
        staleUser.set('displayName', 'Stale User');
        staleUser.set('room', 'Lobby');
        staleUser.set('role', 'student');
        staleUser.set('dateJoined', Date.now());
        staleUser.set('logicalClock', 1);
        userMap.set(stalePeerID, staleUser);
      });

      peer['logicalClocks'][stalePeerID] = {
        clock: 1,
        lastModified: Date.now() - 16000
      };

      expect(userMap.has(stalePeerID)).toBe(true);
      peer['checkLogicalClocks']();
      expect(userMap.has(stalePeerID)).toBe(false);
      expect(peer['logicalClocks'][stalePeerID]).toBeUndefined();
      expect(userMap.has(peer['peerID'])).toBe(true);
    });

    test('should update logicalClock during heartbeat', () => {
      const user = peer.user();
      const initialClock = user.get('logicalClock');
      peer['ticktack']();
      expect(user.get('logicalClock')).toBe(initialClock + 1);
    });
  });

  // Authorization Tests
  describe('Authorization', () => {
    test('should properly check participation authorization', () => {
      setup.data.members = {
        teacher: ['teacher-id'],
        student: ['student-id']
      };
      
      const testPeer = new Peer(setup);
      
      vi.mocked(getPeerID).mockReturnValue('unauthorized-id');
      expect(testPeer['allowedToParticipate']()).toBe(false);
      
      vi.mocked(getPeerID).mockReturnValue('student-id');
      expect(testPeer['allowedToParticipate']()).toBe(true);
    });

    test('should prevent unauthorized users from broadcasting', async () => {
      const { debug } = await import('../../../src/api/debugHandler');
      const mockDebugPeer = vi.mocked(debug.ts.peer);
      
      const originalAllowedToParticipate = peer['allowedToParticipate'];
      peer['allowedToParticipate'] = () => false;
      peer['connected'] = true;
      
      mockDebugPeer.mockClear();
      peer.broadcast('Lobby', { data: 'test' });
      
      expect(mockDebugPeer).toHaveBeenCalledWith(
        messages.en.peer.feedback.unauthorized
      );
      
      peer['allowedToParticipate'] = originalAllowedToParticipate;
    });

    test('should prevent unauthorized state updates', async () => {
      const { debug } = await import('../../../src/api/debugHandler');
      const mockDebugPeer = vi.mocked(debug.ts.peer);
      
      const originalAllowedToParticipate = peer['allowedToParticipate'];
      peer['allowedToParticipate'] = () => false;
      
      mockDebugPeer.mockClear();
      peer.updateState(new Uint8Array());
      
      expect(mockDebugPeer).toHaveBeenCalledWith(
        messages.en.peer.feedback.notPropagated
      );
      
      peer['allowedToParticipate'] = originalAllowedToParticipate;
    });
  });

  // Communication Tests
  describe('Communication', () => {
    test('should handle chat messages', () => {
      const message = 'Test message';
      const timestamp = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(timestamp);

      peer.sendMessage(message);

      expect(peer['y'].chat.get(0)).toEqual({
        msg: message,
        timestamp,
        user: 'test-user'
      });
    });

    test('should handle message broadcasting', () => {
      peer['connected'] = true;
      const message = { user: 'peer2', data: 'message' };
      
      peer.broadcast('Lobby', message);
      
      expect(peer['provider'].sendMessage).toHaveBeenCalledWith(
        message,
        message.user,
      );
    });
  });

  // Setup Management Tests
  describe('Setup Management', () => {
    test('should handle new setup configuration', () => {
      const newConfig = {
        id: 'new-test-lab',
        data: { 
          meta: { defaultNumberOfRooms: 3 }, 
          members: {teacher: ['teacher-id'], student: []} 
        },
        timestamp: Date.now() + 1000,
      };

      peer.newSetup(newConfig);
      expect(peer['lab'].id).toBe(newConfig.id);
      expect(peer['lab'].data).toEqual(newConfig.data);
      expect(peer['y'].setup.get('config')).toBe(newConfig.data);
      expect(peer['y'].setup.get('timestamp')).toBe(newConfig.timestamp);
    });

    test('should not update setup with older timestamp', () => {
      const oldConfig = {
        id: 'old-test-lab',
        data: { meta: { defaultNumberOfRooms: 1 } },
        timestamp: Date.now() - 1000,
      };

      peer.newSetup(oldConfig);
      expect(peer['y'].setup.get('timestamp')).toBeGreaterThan(oldConfig.timestamp);
      expect(peer['lab'].id).toBe(setup.id);
    });

    test('should handle communication config changes in setup', () => {
      // Spy on utils and peer methods
      const updateSpy = vi.spyOn(peer as any, 'update');
      const updateUrlSpy = vi.mocked(updateUrlWithCommConfig);
      
      // Test communication config changes
      peer.logSetupChanges(
        { communicationConfig: 'encodedWebRTC' },
        { communicationConfig: 'encodedWebsocket' }
      );
      
      expect(updateSpy).toHaveBeenCalledWith('popup', messages.en.peer.feedback.communicationChanges);
      expect(updateUrlSpy).toHaveBeenCalled();
    });
  });

  // Transaction Tests
  describe('Transactions', () => {
    test('should handle async transactions correctly', async () => {
      const testValue = 'test';
      await peer['awaitTransact'](() => {
        peer.user().set('displayName', testValue);
      });
      
      expect(peer.user().get('displayName')).toBe(testValue);
    });

    test('should handle transaction errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error');
      
      await peer['awaitTransact'](() => {
        throw new Error('Test error');
      });
      
      expect(consoleSpy).toHaveBeenCalledWith('Error in transaction', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  // Lifecycle Tests
  describe('Lifecycle', () => {
    test('should manage peer lifecycle', async () => {
      await peer.join('student');
      expect(peer['role']).toBe('student');

      const callback = vi.fn();
      peer.on('connected', callback);
      peer.update('connected');
      expect(callback).toHaveBeenCalled();

      peer.stop();
      expect(peer['provider'].disconnect).toHaveBeenCalled();
      expect(peer['provider'].destroy).toHaveBeenCalled();
    });

    test('should properly clean up resources on stop', () => {
      peer.stop();
      expect(peer['provider'].disconnect).toHaveBeenCalled();
      expect(peer['provider'].destroy).toHaveBeenCalled();
      expect(peer['callback']).toEqual({});
      expect(peer['callbackUpdate']).toEqual({});
    });
  });

  // Module Change Tests
  describe('Module Change Detection', () => {
    test('should detect module changes correctly', () => {
      const updateSpy = vi.spyOn(peer as any, 'update');

      peer.logSetupChanges(
        { modules: [{ url: 'module1' }], members: {} },
        { modules: [{ url: 'module2' }], members: {} }
      );

      expect(updateSpy).toHaveBeenCalledWith('popup', messages.en.peer.feedback.moduleChanges);
    });

    test('should not show module changes for initial setup', () => {
      const updateSpy = vi.spyOn(peer as any, 'update');

      peer.logSetupChanges(
        { members: {} }, // No modules property (initial setup)
        { modules: [{ url: 'module1' }], members: {} }
      );

      // Should not call update with module changes message
      expect(updateSpy).not.toHaveBeenCalledWith('popup', messages.en.peer.feedback.moduleChanges);
    });
  });

  describe('translations', () => {
    test.each(['en', 'de', 'uk', 'ar', 'es'])('displays correct translations for %s locale', (locale)  => {      
      i18n.global.locale.value = locale;      
      const testPeer = new Peer(setup, undefined, i18n.global.t);
      const updateSpy = vi.spyOn(testPeer as any, 'update');
      
      // Test noAccess translation
      testPeer['allowedToParticipate'] = () => false;
      
      // Test unauthorized setup state
      testPeer.initSetup(true);
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.noAccess);
      
      // Test unauthorized state update message
      testPeer.updateState(new Uint8Array());
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.noAccess);
      
      // Test module changes message
      testPeer.logSetupChanges(
        { modules: [1], members: {} },
        { modules: [2], members: {} }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.moduleChanges);
      
      // Test member role change messages
      const testId = 'test-id';
      vi.mocked(getPeerID).mockReturnValue(testId);
      
      testPeer.logSetupChanges(
        { members: { teacher: [testId], student: [] } },
        { members: { teacher: [], student: [] } }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.removedTeacher);
      
      testPeer.logSetupChanges(
        { members: { teacher: [], student: [] } },
        { members: { teacher: [testId], student: [] } }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.addedTeacher);
      
      testPeer.logSetupChanges(
        { members: { teacher: [], student: [testId] } },
        { members: { teacher: [], student: ['test-id-2'] } }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.removedStudent);
      
      testPeer.logSetupChanges(
        { members: { teacher: [], student: [] } },
        { members: { teacher: [], student: [testId] } }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.addedStudent);

      // Test communication method change message with encoded configs
      testPeer.logSetupChanges(
        { communicationConfig: 'encodedWebRTC' },
        { communicationConfig: 'encodedWebsocket' }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.communicationChanges);
      
      updateSpy.mockRestore();
    });
  });
});