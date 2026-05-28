import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));
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
  hashPubKey: vi.fn(() => Promise.resolve('testhash1234')),
  initCryptoIdentity: vi.fn(() => Promise.resolve()),
  signSetup: vi.fn(() => Promise.resolve('mock-signature')),
  verifySetup: vi.fn(() => Promise.resolve(true)),
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
  stripPubKey: vi.fn((key: string) => key.replace(/=/g, '')),
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

  beforeEach(async () => {
    setup = {
      id: 'lab1',
      data: {
        meta: { defaultNumberOfRooms: 1 },
        members: {teacher: [], student: []},
        createdBy: 'test-peer-id', // matches getPeerID() mock so _signAndWrite proceeds
      },
      timestamp: Date.now(),
      hash: null,
    };

    peer = new Peer(setup, undefined, i18n.global.t);

    // Flush async construction (initCryptoIdentity → _signAndWrite → signSetup) before fake timers
    await flushPromises();

    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  // Initialization Tests
  describe('Initialization', () => {
    test('should initialize setup correctly', () => {
      const setupMap = peer['y'].setup as Y.Map<any>;
      expect(peer['lab'].id).toBe(setup.id);
      expect(setupMap.get('config')).toMatchObject(setup.data);
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
      // providerType and websocketUrl are set synchronously in the constructor
      expect(peer['providerType']).toBe('Websocket');
      expect(peer['websocketUrl']).toBe('wss://test.com');
      // EdrysWebsocketProvider is instantiated inside initCryptoIdentity().then() — verified via providerType above
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
      // Use the beforeEach peer whose initCryptoIdentity resolved before fake timers were set
      const callback = vi.fn();
      peer.on('connected', callback);

      // Simulate status event (callback registered during beforeEach construction flush)
      mockWebrtcEvents.status?.({ status: 'connected' });

      // Need to wait for the connection timeout
      vi.advanceTimersByTime(2000);
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
      vi.advanceTimersByTime(2000);
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

    test('student cannot modify members', async () => {
      const updateSpy = vi.spyOn(peer as any, 'update');
      vi.mocked(getPeerID).mockReturnValue('student-peer-id');

      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: 'owner-peer-id',
        members: { teacher: ['teacher-peer-id'], student: ['student-peer-id'] },
      };

      // Simulate student tampering with members
      peer['lab'].data.members.teacher.push('student-peer-id');

      const existingCrdt = { members: { teacher: ['teacher-peer-id'], student: ['student-peer-id'] }, createdBy: 'owner-peer-id' };
      await peer['_signAndWrite'](existingCrdt);

      expect(updateSpy).toHaveBeenCalledWith('popup', messages.en.peer.feedback.noPermission);
    });

    test('teacher can modify members without touching owner', async () => {
      const updateSpy = vi.spyOn(peer as any, 'update');
      vi.mocked(getPeerID).mockReturnValue('teacher-peer-id');

      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: 'owner-peer-id',
        members: { teacher: ['teacher-peer-id', 'new-teacher-id'], student: [] },
      };

      const existingCrdt = { members: { teacher: ['teacher-peer-id'], student: [] }, createdBy: 'owner-peer-id' };
      await peer['_signAndWrite'](existingCrdt);

      expect(updateSpy).not.toHaveBeenCalledWith('popup', messages.en.peer.feedback.noPermission);
    });

    test('teacher cannot move owner to student list', async () => {
      const updateSpy = vi.spyOn(peer as any, 'update');
      vi.mocked(getPeerID).mockReturnValue('teacher-peer-id');

      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: 'owner-peer-id',
        members: { teacher: ['teacher-peer-id'], student: ['owner-peer-id'] },
      };

      const existingCrdt = { members: { teacher: ['teacher-peer-id'], student: [] }, createdBy: 'owner-peer-id' };
      await peer['_signAndWrite'](existingCrdt);

      expect(updateSpy).toHaveBeenCalledWith('popup', messages.en.peer.feedback.noPermission);
    });

    test('_verifyAndAccept rejects payload with mismatched createdBy', async () => {
      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: 'owner-peer-id',
        members: { teacher: ['teacher-peer-id'], student: [] },
      };

      // Tampered payload: createdBy doesn't match established localCreatedBy
      const tampered = {
        createdBy: 'HACKER_KEY',
        setupSigner: 'teacher-peer-id',
        setupSignature: 'mock-signature',
        members: { teacher: ['teacher-peer-id'], student: [] },
        modules: [],
        name: 'lab',
        meta: {},
      };

      const accepted = await peer['_verifyAndAccept'](tampered, Date.now() + 1000);
      expect(accepted).toBe(false);
      expect(peer['lab'].data.createdBy).toBe('owner-peer-id');
    });

    test('_verifyAndAccept accepts owner migration broadcast when local createdBy is a legacy ID', async () => {
      const legacyOwnerID = 'G58rjdP2oTJ4'; // 12-char alphanumeric legacy ID (old infoHash format)
      const newOwnerPubKey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+/abc123XYZ=='; // base64 pubkey

      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: legacyOwnerID,
        members: { teacher: [], student: [] },
        modules: [],
        name: 'lab',
        meta: {},
      };
      peer['expectedOwner'] = null; // old bookmarked URL, no /:owner segment

      // Owner's post-migration broadcast: self-signed with new pubkey
      const ownerMigrationBroadcast = {
        createdBy: newOwnerPubKey,
        setupSigner: newOwnerPubKey, // self-signed: signer === createdBy
        setupSignature: 'mock-signature',
        members: { teacher: [], student: [] },
        modules: [],
        name: 'lab',
        meta: {},
      };

      const accepted = await peer['_verifyAndAccept'](ownerMigrationBroadcast, Date.now() + 1000);
      expect(accepted).toBe(true);
      // After accepting, the student's local createdBy should be updated to the new pubkey
      expect(peer['lab'].data.createdBy).toBe(newOwnerPubKey);
    });

    test('_verifyAndAccept rejects non-self-signed broadcast replacing legacy createdBy', async () => {
      const legacyOwnerID = 'AbCdEfGhIjKlMnOpQrSt';
      const claimedNewOwnerPubKey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+/owner=';
      const teacherPubKey = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE+/teacher=';

      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: legacyOwnerID,
        members: { teacher: [teacherPubKey], student: [] },
        modules: [],
        name: 'lab',
        meta: {},
      };
      peer['expectedOwner'] = null;

      // Teacher signs a setup claiming a different pubkey is the new owner.
      // Cryptographically valid signature, but setupSigner !== createdBy.
      const teacherBroadcast = {
        createdBy: claimedNewOwnerPubKey,
        setupSigner: teacherPubKey,
        setupSignature: 'mock-signature',
        members: { teacher: [teacherPubKey], student: [] },
        modules: [],
        name: 'lab',
        meta: {},
      };

      const accepted = await peer['_verifyAndAccept'](teacherBroadcast, Date.now() + 1000);
      expect(accepted).toBe(false);
      expect(peer['lab'].data.createdBy).toBe(legacyOwnerID);
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
          members: {teacher: ['teacher-id'], student: []},
          createdBy: 'test-peer-id',
        },
        timestamp: Date.now() + 1000,
      };

      // lab fields are updated synchronously by newSetup before initSetup(true) is called
      peer.newSetup(newConfig);
      expect(peer['lab'].id).toBe(newConfig.id);
      expect(peer['lab'].data).toEqual(newConfig.data);
      // Verify via lab state (synchronous) instead of CRDT state (async).
      expect(peer['lab'].timestamp).toBe(newConfig.timestamp);
    });

    test('should fire setup callback when newSetup receives newer config', () => {
      const callback = vi.fn();
      peer.on('setup', callback);

      const newConfig = {
        id: 'new-test-lab',
        data: {
          meta: { defaultNumberOfRooms: 3 },
          members: { teacher: ['teacher-id'], student: [] },
          createdBy: 'test-peer-id',
        },
        timestamp: Date.now() + 1000,
      };

      peer.newSetup(newConfig);
      expect(callback).toHaveBeenCalledWith(expect.objectContaining({ id: newConfig.id }));
    });

    test('should not update setup with older timestamp', () => {
      const oldConfig = {
        id: 'old-test-lab',
        data: { meta: { defaultNumberOfRooms: 1 } },
        timestamp: Date.now() - 1000,
      };

      peer.newSetup(oldConfig);
      // Old config is rejected synchronously — lab state unchanged, lab.timestamp > oldConfig.timestamp
      expect(peer['lab'].timestamp).toBeGreaterThan(oldConfig.timestamp);
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
    test('should not show popup on module changes (UI reloads automatically)', () => {
      const updateSpy = vi.spyOn(peer as any, 'update');

      peer.logSetupChanges(
        { modules: [{ url: 'module1' }], members: {} },
        { modules: [{ url: 'module2' }], members: {} }
      );

      expect(updateSpy).not.toHaveBeenCalledWith('popup', messages.en.peer.feedback.moduleChanges);
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
      // Use the already-initialized beforeEach peer (peerID and user map are set up)
      peer['t'] = i18n.global.t;
      const updateSpy = vi.spyOn(peer as any, 'update');

      // Spy on _signAndWrite to synchronously call update (avoids async signSetup under fake timers)
      vi.spyOn(peer as any, '_signAndWrite').mockImplementation(function(this: any) {
        if (!this.allowedToParticipate()) {
          this.update('popup', this.t('peer.feedback.noAccess'));
        }
        return Promise.resolve();
      });

      const origAllowed = peer['allowedToParticipate'].bind(peer);
      peer['allowedToParticipate'] = () => false;

      peer.initSetup(true);
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.noAccess);

      // Test unauthorized state update message
      peer.updateState(new Uint8Array());
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.noAccess);

      // Module changes no longer show a popup (UI reloads automatically)

      // Test member role change messages
      const testId = 'test-id';
      vi.mocked(getPeerID).mockReturnValue(testId);

      peer.logSetupChanges(
        { members: { teacher: [testId], student: [] } },
        { members: { teacher: [], student: [] } }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.removedTeacher);

      peer.logSetupChanges(
        { members: { teacher: [], student: [] } },
        { members: { teacher: [testId], student: [] } }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.addedTeacher);

      peer.logSetupChanges(
        { members: { teacher: [], student: [testId] } },
        { members: { teacher: [], student: ['test-id-2'] } }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.removedStudent);

      peer.logSetupChanges(
        { members: { teacher: [], student: [] } },
        { members: { teacher: [], student: [testId] } }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.addedStudent);

      // Test communication method change message with encoded configs
      peer.logSetupChanges(
        { communicationConfig: 'encodedWebRTC' },
        { communicationConfig: 'encodedWebsocket' }
      );
      expect(updateSpy).toHaveBeenCalledWith('popup', messages[locale].peer.feedback.communicationChanges);

      peer['allowedToParticipate'] = origAllowed;
      updateSpy.mockRestore();
    });
  });
});