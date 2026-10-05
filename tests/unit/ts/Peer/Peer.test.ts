import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));
import Peer from '../../../../src/ts/Peer';
import * as Y from 'yjs';
import { GenericWebrtcProviderAdapter } from '../../../../src/ts/GenericProviderAdapter';
import { GenericWebsocketProviderAdapter } from '../../../../src/ts/GenericWebsocketProviderAdapter';
import { getPeerID, getShortPeerID, decodeCommConfig, updateUrlWithCommConfig, verifySetup } from '../../../../src/ts/Utils';
import { i18n, messages } from '../../../setup';

// Mock debug system
vi.mock('../../../../src/api/debugHandler', () => {
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

vi.mock('../../../../src/ts/GenericProviderAdapter', () => ({
  GenericWebrtcProviderAdapter: vi.fn().mockImplementation(() => ({
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

vi.mock('../../../../src/ts/GenericWebsocketProviderAdapter', () => ({
  GenericWebsocketProviderAdapter: vi.fn().mockImplementation(() => ({
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

vi.mock('../../../../src/ts/Utils', () => ({
  getPeerID: vi.fn(() => 'test-peer-id'),
  getShortPeerID: vi.fn(() => 'test-user'),
  getBasePeerID: vi.fn((id: string) => {
    const sep = id.lastIndexOf('_');
    return sep > 0 ? id.slice(0, sep) : id;
  }),
  hashJsonObject: vi.fn().mockResolvedValue('test-hash'),
  hashPubKey: vi.fn(() => Promise.resolve('testhash1234')),
  initCryptoIdentity: vi.fn(() => Promise.resolve()),
  signSetup: vi.fn(() => Promise.resolve('mock-signature')),
  verifySetup: vi.fn(() => Promise.resolve(true)),
  signEntry: vi.fn(() => Promise.resolve({ signer: 'test-peer-id', nonce: Date.now(), signature: 'mock-sig' })),
  verifyEntry: vi.fn(() => Promise.resolve(true)),
  REVERT_INVALID_ORIGIN: 'revert-invalid',
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
    // Tests below reassign getPeerID; clearAllMocks doesn't undo that.
    vi.mocked(getPeerID).mockReturnValue('test-peer-id');
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
      expect(GenericWebrtcProviderAdapter).toHaveBeenCalledWith(
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
      expect(GenericWebrtcProviderAdapter).toHaveBeenCalled();
      expect(GenericWebsocketProviderAdapter).not.toHaveBeenCalled();
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
      // GenericWebsocketProviderAdapter is instantiated inside initCryptoIdentity().then() — verified via providerType above
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
      expect(GenericWebrtcProviderAdapter).toHaveBeenCalled();
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

    test('a setup change is handled once, however many status/synced events arrived', () => {
      // Status repeats on every reconnect; each must not add another observer.
      mockWebrtcEvents.status?.({ status: 'connected' });
      mockWebrtcEvents.status?.({ status: 'connected' });
      mockWebrtcEvents.synced?.({ synced: true });
      const initSetup = vi.spyOn(peer, 'initSetup').mockImplementation(() => {});

      peer['y'].doc.transact(() => {
        peer['y'].setup.set('timestamp', setup.timestamp + 1000);
      });

      expect(initSetup).toHaveBeenCalledTimes(1);
    });

    test('synced reports connected once and seeds an empty y.setup from local data', async () => {
      // A fresh room: nothing in y.setup yet.
      peer['y'].doc.transact(() => {
        peer['y'].setup.delete('config');
        peer['y'].setup.delete('timestamp');
      });
      const callback = vi.fn();
      peer.on('connected', callback);

      mockWebrtcEvents.synced?.({ synced: true });
      mockWebrtcEvents.synced?.({ synced: true });
      await vi.advanceTimersByTimeAsync(0);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback).toHaveBeenCalledWith(true);
      expect(peer['y'].setup.get('timestamp')).toBe(setup.timestamp);
      expect(peer['y'].setup.get('config')).toMatchObject({
        createdBy: 'test-peer-id',
        setupSigner: 'test-peer-id',
      });
    });
  });

  // Room Management Tests
  describe('Room Management', () => {
    // Rooms are seeded on join(), once connected — not at construction.
    beforeEach(async () => {
      peer.initRooms();
      await vi.advanceTimersByTimeAsync(0);
    });

    test('should add default rooms', () => {
      const roomMap = peer['y'].rooms as Y.Map<any>;
      expect(roomMap.size).toEqual(2);
    });

    test('should handle room deletions and move users to lobby', async () => {
      const roomMap = peer['y'].rooms as Y.Map<any>;
      const userMap = peer['y'].users as Y.Map<any>;

      peer.addRoom('Room1');
      await vi.advanceTimersByTimeAsync(0);
      peer['y'].doc.transact(() => {
        userMap.get(peer['peerID']).set('room', 'Room1');
      });

      expect(userMap.get(peer['peerID']).get('room')).toBe('Room1');

      // Local-origin delete: the room observer recognises it as legitimate
      // and moves the affected user back to Lobby.
      peer['_deleteAndUnsignRoom']('Room1', 'checkForDeadStations');
      await vi.advanceTimersByTimeAsync(0);

      expect(roomMap.has('Room1')).toBe(false);
      expect(userMap.get(peer['peerID']).get('room')).toBe('Lobby');
    });

    test('provider.onLeave(station) must NOT evict the student or delete the room (regression)', async () => {
      const roomMap = peer['y'].rooms as Y.Map<any>;
      const userMap = peer['y'].users as Y.Map<any>;
      const stationID = 'Station stn1';

      // Add a station user, move the student into the station room.
      peer.addRoom(stationID);
      await vi.advanceTimersByTimeAsync(0);
      peer['y'].doc.transact(() => {
        const stationUser = new Y.Map();
        stationUser.set('displayName', stationID);
        stationUser.set('room', stationID);
        stationUser.set('role', 'station');
        stationUser.set('dateJoined', Date.now());
        stationUser.set('logicalClock', 1);
        stationUser.set('handRaised', false);
        stationUser.set('connections', [{ id: '', target: {} }]);
        userMap.set(stationID, stationUser);
        userMap.get(peer['peerID']).set('room', stationID);
      });

      expect(userMap.get(peer['peerID']).get('room')).toBe(stationID);
      expect(roomMap.has(stationID)).toBe(true);

      const onLeaveCallback = (peer['provider'] as any).onLeave.mock.calls[0][0];
      onLeaveCallback(stationID);
      // The next heartbeat tick would call checkForDeadStations.
      peer['checkForDeadStations']();
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);

      // A single peer-connection drop must NOT propagate a global eviction.
      expect(userMap.has(stationID)).toBe(true);
      expect(roomMap.has(stationID)).toBe(true);
      expect(userMap.get(peer['peerID']).get('room')).toBe(stationID);
    });

    test('a station room survives one missing heartbeat check and is removed after two', async () => {
      const roomMap = peer['y'].rooms as Y.Map<any>;
      const userMap = peer['y'].users as Y.Map<any>;
      const stationID = 'Station stn1';

      peer.addRoom(stationID);
      await vi.advanceTimersByTimeAsync(0);
      peer['y'].doc.transact(() => {
        const stationUser = new Y.Map();
        stationUser.set('room', stationID);
        userMap.set(stationID, stationUser);
      });

      // A forged delete of the station's user: it has one tick to heal itself.
      peer['y'].doc.transact(() => userMap.delete(stationID));
      peer['checkForDeadStations']();
      await vi.advanceTimersByTimeAsync(0);
      expect(roomMap.has(stationID)).toBe(true);

      peer['checkForDeadStations']();
      await vi.advanceTimersByTimeAsync(0);
      expect(roomMap.has(stationID)).toBe(false);
    });

    test('a station that reappears resets its missing-check count', async () => {
      const roomMap = peer['y'].rooms as Y.Map<any>;
      const userMap = peer['y'].users as Y.Map<any>;
      const stationID = 'Station stn1';
      const setStationUser = () => peer['y'].doc.transact(() => {
        const stationUser = new Y.Map();
        stationUser.set('room', stationID);
        userMap.set(stationID, stationUser);
      });

      peer.addRoom(stationID);
      await vi.advanceTimersByTimeAsync(0);
      setStationUser();

      peer['y'].doc.transact(() => userMap.delete(stationID));
      peer['checkForDeadStations'](); // missing 1
      setStationUser();
      peer['checkForDeadStations'](); // present → reset
      peer['y'].doc.transact(() => userMap.delete(stationID));
      peer['checkForDeadStations'](); // missing 1 again
      await vi.advanceTimersByTimeAsync(0);

      expect(roomMap.has(stationID)).toBe(true);
    });

    test('non-owner student cannot create rooms via addRoom', async () => {
      // Create a peer whose peerID does NOT match createdBy — a genuine student.
      const studentPeer = new Peer({
        id: 'lab1',
        data: { meta: { defaultNumberOfRooms: 0 }, members: { teacher: [], student: [] }, createdBy: 'some-other-owner' },
        timestamp: Date.now(),
        hash: null,
      }, undefined, i18n.global.t);
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();

      studentPeer.addRoom('Sneaky');
      await vi.advanceTimersByTimeAsync(0);
      expect(studentPeer['y'].rooms.has('Sneaky')).toBe(false);
      studentPeer.stop();
    });
  });

  // Peer Management Tests
  describe('Peer Management', () => {
    test('should remove a departed peer via removePeers', () => {
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

      expect(userMap.has(stalePeerID)).toBe(true);
      peer['removePeers']([stalePeerID]);
      expect(userMap.has(stalePeerID)).toBe(false);
      expect(userMap.has(peer['peerID'])).toBe(true);
    });

    test('provider onLeave removes the departed peer and its signature', () => {
      const userMap = peer['y'].users as Y.Map<any>;
      const sigMap = peer['y'].userSigs as Y.Map<any>;
      const leaverID = 'leaverPubKey_s1';

      peer['y'].doc.transact(() => {
        const leaver = new Y.Map();
        leaver.set('room', 'Lobby');
        userMap.set(leaverID, leaver);
        sigMap.set(leaverID, { signer: 'leaverPubKey', nonce: 1, signature: 'sig' });
      });

      const onLeaveCallback = (peer['provider'] as any).onLeave.mock.calls[0][0];
      onLeaveCallback(leaverID);

      expect(userMap.has(leaverID)).toBe(false);
      expect(sigMap.has(leaverID)).toBe(false);
      expect(userMap.has(peer['peerID'])).toBe(true);
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
      const { debug } = await import('../../../../src/api/debugHandler');
      const mockDebugPeer = vi.mocked(debug.ts.peer);
      
      const originalAllowedToParticipate = peer['allowedToParticipate'];
      peer['allowedToParticipate'] = () => false;
      peer['connected'] = true;
      const localEcho = vi.fn();
      peer.on('message' as any, localEcho);
      peer['y'].doc.transact(() => {
        const other = new Y.Map();
        other.set('room', 'Lobby');
        peer['y'].users.set('other_s1', other);
      });

      peer.broadcast('Lobby', { data: 'test' });
      peer.broadcast('Lobby', { data: 'test', user: 'other_s1' });

      expect(peer['provider'].sendMessage).not.toHaveBeenCalled();
      expect(localEcho).not.toHaveBeenCalled();
      expect(mockDebugPeer).toHaveBeenCalledWith(
        messages.en.peer.feedback.unauthorized
      );

      peer['allowedToParticipate'] = originalAllowedToParticipate;
    });

    test('should prevent unauthorized state updates', () => {
      const originalAllowedToParticipate = peer['allowedToParticipate'];
      peer['allowedToParticipate'] = () => false;

      const moduleDoc = new Y.Doc();
      moduleDoc.getMap('rooms').set('Injected', new Y.Map());
      peer.updateState(Y.encodeStateAsUpdate(moduleDoc));

      expect(peer['y'].rooms.has('Injected')).toBe(false);

      peer['allowedToParticipate'] = originalAllowedToParticipate;
    });

    test('student cannot modify members', async () => {
      const ySetupSetSpy = vi.spyOn(peer['y'].setup, 'set');
      vi.mocked(getPeerID).mockReturnValue('student-peer-id');

      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: 'owner-peer-id',
        members: { teacher: ['teacher-peer-id'], student: ['student-peer-id'] },
      };

      // Simulate student tampering with members
      peer['lab'].data.members.teacher.push('student-peer-id');

      const existingCrdt = { members: { teacher: ['teacher-peer-id'], student: ['student-peer-id'] }, createdBy: 'owner-peer-id' };
      ySetupSetSpy.mockClear();
      await peer['_signAndWrite'](existingCrdt);

      // The write must not land in the CRDT. (Silent block — no popup, since
      // this same guard fires on benign refresh paths and the popup would spam.)
      const configWrites = ySetupSetSpy.mock.calls.filter(([key]) => key === 'config');
      expect(configWrites).toHaveLength(0);
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
      expect(peer['y'].setup.get('config')).toMatchObject({
        createdBy: 'owner-peer-id',
        setupSigner: 'teacher-peer-id',
        members: { teacher: ['teacher-peer-id', 'new-teacher-id'], student: [] },
      });
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

    test('demoted teacher cannot _signAndWrite', async () => {
      const updateSpy = vi.spyOn(peer as any, 'update');
      const ySetupSetSpy = vi.spyOn(peer['y'].setup, 'set');

      // The peer is a demoted teacher: their pubkey is NOT in members.teacher
      // anymore (owner removed them and the demotion has synced to this tab).
      vi.mocked(getPeerID).mockReturnValue('demoted-teacher-id');

      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: 'owner-peer-id',
        members: { teacher: [], student: [] }, // demoted-teacher is no longer in teacher list
        modules: [{ url: 'https://example.com/mod-v2' }], // local change to a module
      };

      // existingCrdt mirrors what's currently in y.setup — same demoted state, older modules
      const existingCrdt = {
        members: { teacher: [], student: [] },
        createdBy: 'owner-peer-id',
        modules: [{ url: 'https://example.com/mod-v1' }],
      };

      ySetupSetSpy.mockClear();
      updateSpy.mockClear();
      await peer['_signAndWrite'](existingCrdt);

      expect(updateSpy).not.toHaveBeenCalledWith('popup', messages.en.peer.feedback.noPermission);

      // The CRDT must NOT have been updated with the demoted-teacher's signature.
      const configWrites = ySetupSetSpy.mock.calls.filter(([key]) => key === 'config');
      expect(configWrites, 'demoted teacher must not write to y.setup.config').toHaveLength(0);
    });

    test('owner auto-heals y.setup when CRDT setup is signed by an unauthorized signer', async () => {
      vi.mocked(getPeerID).mockReturnValue('test-peer-id');
      const staleTeacherID = 'stale-teacher-id';

      // Local lab.data reflects the post-demotion state: stale teacher is gone.
      peer['lab'].data = {
        ...peer['lab'].data,
        createdBy: 'test-peer-id', // matches getPeerID mock = owner
        members: { teacher: [], student: ['*'] },
        modules: [],
      };

      // Plant a "poison" setup in y.setup, signed by the demoted teacher.
      const poisonTimestamp = Date.now() + 5000;
      peer['y'].doc.transact(() => {
        peer['y'].setup.set('config', {
          name: 'lab',
          meta: {},
          modules: [],
          members: { teacher: [], student: ['*'] }, // members already show the demotion
          createdBy: 'test-peer-id',
          setupSigner: staleTeacherID, // <-- signed by someone no longer authorized
          setupSignature: 'stale-signature',
        });
        peer['y'].setup.set('timestamp', poisonTimestamp);
      });

      const ySetupSetSpy = vi.spyOn(peer['y'].setup, 'set');
      ySetupSetSpy.mockClear();

      await (peer as any)._ownerAutoHealStaleSigner();

      // After heal, the latest y.setup.config must be signed by the owner.
      const newConfig: any = peer['y'].setup.get('config');
      expect(newConfig).toBeDefined();
      expect(newConfig.setupSigner).toBe('test-peer-id');
      // And the createdBy must remain the owner.
      expect(newConfig.createdBy).toBe('test-peer-id');
    });

    describe('_verifyAndAccept (incoming setup)', () => {
      // Real pubkeys are long; keys under 40 chars take the legacy-ID path.
      const OWNER = 'O'.repeat(44);
      const TEACHER = 'T'.repeat(44);
      const STUDENT = 'S'.repeat(44);

      const incoming = (overrides: any = {}) => ({
        name: 'renamed',
        meta: {},
        modules: [],
        members: { teacher: [TEACHER], student: [] },
        createdBy: OWNER,
        setupSigner: OWNER,
        setupSignature: 'mock-signature',
        ...overrides,
      });

      beforeEach(() => {
        peer['lab'].data = {
          ...peer['lab'].data,
          name: 'lab',
          meta: {},
          modules: [],
          members: { teacher: [TEACHER], student: [] },
          createdBy: OWNER,
        };
        peer['expectedOwner'] = null;
      });

      test('accepts a setup signed by the owner', async () => {
        expect(await peer['_verifyAndAccept'](incoming(), Date.now() + 1000)).toBe(true);
        expect(peer['lab'].data.name).toBe('renamed');
      });

      test('accepts a teacher-signed change that leaves members alone', async () => {
        const data = incoming({ setupSigner: TEACHER });
        expect(await peer['_verifyAndAccept'](data, Date.now() + 1000)).toBe(true);
        expect(peer['lab'].data.name).toBe('renamed');
      });

      test('rejects a teacher-signed setup that claims ownership', async () => {
        // The signer is authorized; only the owner check stops the takeover.
        const data = incoming({ createdBy: TEACHER, setupSigner: TEACHER });
        expect(await peer['_verifyAndAccept'](data, Date.now() + 1000)).toBe(false);
        expect(peer['lab'].data.createdBy).toBe(OWNER);
        expect(peer['lab'].data.name).toBe('lab');
        expect(verifySetup).not.toHaveBeenCalled();
      });

      test('rejects a setup signed by a student', async () => {
        const data = incoming({ setupSigner: STUDENT });
        expect(await peer['_verifyAndAccept'](data, Date.now() + 1000)).toBe(false);
        expect(peer['lab'].data.name).toBe('lab');
        expect(verifySetup).not.toHaveBeenCalled();
      });

      test('rejects a teacher-signed members change that moves the owner to students', async () => {
        const data = incoming({
          setupSigner: TEACHER,
          members: { teacher: [TEACHER], student: [OWNER] },
        });
        expect(await peer['_verifyAndAccept'](data, Date.now() + 1000)).toBe(false);
        expect(peer['lab'].data.members.student).toEqual([]);
      });

      test('rejects a setup whose signature does not verify', async () => {
        vi.mocked(verifySetup).mockResolvedValueOnce(false);
        const setupCallback = vi.fn();
        peer.on('setup', setupCallback);

        expect(await peer['_verifyAndAccept'](incoming(), Date.now() + 1000)).toBe(false);
        expect(peer['lab'].data.name).toBe('lab');
        expect(setupCallback).not.toHaveBeenCalled();
      });

      test('rejects an owner that does not match the owner hash from the URL', async () => {
        // A first-time joiner: no local owner yet, only the link's trust anchor.
        peer['lab'].data.createdBy = '';
        peer['expectedOwner'] = 'hash-of-the-real-owner'; // hashPubKey mock yields 'testhash1234'
        const roomCallback = vi.fn();
        peer.on('room', roomCallback);

        expect(await peer['_verifyAndAccept'](incoming(), Date.now() + 1000)).toBe(false);
        expect(peer['lab'].data.createdBy).toBe('');
        expect(roomCallback).toHaveBeenCalledWith(null);
      });

      test('adopts the owner when it matches the owner hash from the URL', async () => {
        peer['lab'].data.createdBy = '';
        peer['expectedOwner'] = 'testhash1234';

        expect(await peer['_verifyAndAccept'](incoming(), Date.now() + 1000)).toBe(true);
        expect(peer['lab'].data.createdBy).toBe(OWNER);
      });
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
    test('should handle chat messages', async () => {
      const message = 'Test message';
      const timestamp = Date.now();
      vi.spyOn(Date, 'now').mockReturnValue(timestamp);

      await peer.sendMessage(message);

      expect(peer['y'].chat.get(0)).toMatchObject({
        msg: message,
        timestamp,
        user: 'test-user',
        signer: expect.any(String),
        signature: expect.any(String),
      });
    });

    test('room broadcast reaches everyone else in the room, plus a local echo', () => {
      peer['connected'] = true;
      const localEcho = vi.fn();
      peer.on('message' as any, localEcho);
      peer['y'].doc.transact(() => {
        for (const [id, room] of [['inLobby_s1', 'Lobby'], ['elsewhere_s1', 'Room 1']]) {
          const u = new Y.Map();
          u.set('room', room);
          peer['y'].users.set(id, u);
        }
      });
      const msg = { subject: 'hi', body: 'x' };

      peer.broadcast('Lobby', msg);

      const sendMessage = vi.mocked(peer['provider'].sendMessage);
      expect(sendMessage.mock.calls).toEqual([[msg, 'inLobby_s1']]);
      expect(localEcho).toHaveBeenCalledWith(msg);
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
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await peer['awaitTransact'](() => {
        throw new Error('Test error');
      });
      
      expect(consoleSpy).toHaveBeenCalledWith('Error in transaction', expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  // Lifecycle Tests
  describe('Lifecycle', () => {
    test('should properly clean up resources on stop', () => {
      peer.stop();
      expect(peer['provider'].disconnect).toHaveBeenCalled();
      expect(peer['provider'].destroy).toHaveBeenCalled();
      expect(peer['callback']).toEqual({});
      expect(peer['callbackUpdate']).toEqual({});
    });
  });

  // Presence is liveness: anyone may delete a y.users entry, its owner re-adds itself.
  describe('Presence self-heal', () => {
    const OTHER = 'other-pub_s1';

    function addOtherUser() {
      peer['y'].doc.transact(() => {
        const m = new Y.Map();
        m.set('displayName', 'Other');
        m.set('room', 'Lobby');
        peer['y'].users.set(OTHER, m);
        peer['y'].userSigs.set(OTHER, { signer: 'other-pub', nonce: 1, signature: 'sig' });
      }, 'remote');
    }

    function deleteUser(id: string) {
      peer['y'].doc.transact(() => {
        peer['y'].users.delete(id);
        peer['y'].userSigs.delete(id);
      }, 'remote');
    }

    beforeEach(async () => {
      await peer.join('student');
      await vi.advanceTimersByTimeAsync(0);
    });

    test("another user's deleted entry is accepted, not restored", async () => {
      addOtherUser();
      await vi.advanceTimersByTimeAsync(0);
      expect(peer['_lastGoodUser'].has(OTHER)).toBe(true);

      // Unsigned delete, as onLeave → removePeers does it.
      peer.removePeers([OTHER]);
      await vi.advanceTimersByTimeAsync(10000);

      expect(peer['y'].users.has(OTHER)).toBe(false);
      expect(peer['_lastGoodUser'].has(OTHER)).toBe(false);
    });

    test('our own deleted entry is re-written by the heartbeat, keeping room and handRaised', async () => {
      const id = peer['peerID'];
      peer.gotoRoom('Room 1');
      await vi.advanceTimersByTimeAsync(0);
      await peer['_writeAndSignUser'](id, peer['_nextUserPayload'](id, { handRaised: true }), 'raiseHand');
      const joined = peer.user().get('dateJoined');

      deleteUser(id);
      await vi.advanceTimersByTimeAsync(0);
      expect(peer['y'].users.has(id)).toBe(false);

      await vi.advanceTimersByTimeAsync(5000);

      expect(peer.user().toJSON()).toMatchObject({ room: 'Room 1', handRaised: true, dateJoined: joined });
      expect(peer['y'].userSigs.has(id)).toBe(true);
    });

    test('toJSON re-adds our own deleted entry before serializing', async () => {
      const id = peer['peerID'];
      peer.gotoRoom('Room 1');
      await vi.advanceTimersByTimeAsync(0);

      deleteUser(id);
      const json = await peer.toJSON();

      expect(json.users[id]).toMatchObject({ room: 'Room 1' });
    });

    test('a stopped peer does not re-add itself', async () => {
      const id = peer['peerID'];
      peer.stop();
      expect(peer['y'].users.has(id)).toBe(false);

      await peer['_healOwnEntry']();
      await vi.advanceTimersByTimeAsync(10000);

      expect(peer['y'].users.has(id)).toBe(false);
    });

    test('a shut-down station does not re-add itself', async () => {
      const station = new Peer(setup, 'stn1', i18n.global.t);
      await vi.advanceTimersByTimeAsync(0);
      await station.join('station');
      await vi.advanceTimersByTimeAsync(0);
      const id = station['peerID'];
      expect(station['y'].users.has(id)).toBe(true);

      station.stop();
      await vi.advanceTimersByTimeAsync(0);
      expect(station['y'].users.has(id)).toBe(false);

      await station['_healOwnEntry']();
      await vi.advanceTimersByTimeAsync(10000);

      expect(station['y'].users.has(id)).toBe(false);
    });
  });

  test('a transport change tells the user, moves the URL to the new transport and reloads', async () => {
    const realLocation = window.location;
    const reload = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...realLocation, reload }, configurable: true });
    try {
      const updateSpy = vi.spyOn(peer as any, 'update');

      peer.logSetupChanges(
        { communicationConfig: 'encodedWebRTC' },
        { communicationConfig: 'encodedWebsocket' }
      );

      expect(updateSpy).toHaveBeenCalledWith('popup', messages.en.peer.feedback.communicationChanges);
      expect(updateUrlWithCommConfig).toHaveBeenCalledWith({ communicationMethod: 'Websocket', websocketUrl: 'wss://test.com' });
      expect(reload).not.toHaveBeenCalled();
      vi.advanceTimersByTime(3000);
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(window, 'location', { value: realLocation, configurable: true });
    }
  });

  describe('membership changes', () => {
    const ME = 'test-peer-id';
    test.each([
      ['removed as teacher', { teacher: [ME], student: [] }, { teacher: [], student: [] }, 'removedTeacher', 'student'],
      ['added as teacher', { teacher: [], student: [] }, { teacher: [ME], student: [] }, 'addedTeacher', 'teacher'],
      ['added to the student allowlist', { teacher: [], student: ['other'] }, { teacher: [], student: [ME] }, 'addedStudent', null],
      ['allowlist opened to everyone', { teacher: [], student: ['other'] }, { teacher: [], student: ['*'] }, 'addedStudent', null],
      ['removed from the student allowlist', { teacher: [], student: [ME] }, { teacher: [], student: ['other'] }, 'removedStudent', null],
      ['allowlist closed without me', { teacher: [], student: [] }, { teacher: [], student: ['other'] }, 'removedStudent', null],
    ])('%s: tells the user and updates their own role', async (_case, oldMembers, newMembers, popup, role) => {
      i18n.global.locale.value = 'en';
      peer['t'] = i18n.global.t;
      if (role) peer.user().set('role', role === 'student' ? 'teacher' : 'student');
      const updateSpy = vi.spyOn(peer as any, 'update');

      peer.logSetupChanges({ members: oldMembers }, { members: newMembers });
      await vi.advanceTimersByTimeAsync(0);

      const popups = updateSpy.mock.calls.filter(([event]) => event === 'popup');
      expect(popups).toEqual([['popup', messages.en.peer.feedback[popup]]]);
      if (role) expect(peer.user().get('role')).toBe(role);
    });
  });
});