import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0));
import Peer from '../../../../src/ts/Peer';
import { ABSENT_GRACE } from '../../../../src/ts/Presence';
import * as Y from 'yjs';
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
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
    getPresenceAwareness: vi.fn(() => new Awareness(new Y.Doc())),
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
    getPresenceAwareness: vi.fn(() => new Awareness(new Y.Doc())),
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
  canonicalize: vi.fn((v) => JSON.stringify(v)),
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
  let nextClientID = 9000;

  /** A remote peer's signed presence arriving over awareness; returns its client id. */
  async function addRemote(id: string, payload: any, signer = id.split('_')[0], target: any = peer) {
    const clientID = nextClientID++;
    const state = { presence: { id, payload, envelope: { signer, nonce: Date.now(), signature: 'sig' } } };
    const update = encodeAwarenessUpdate(
      { states: new Map([[clientID, state]]), meta: new Map([[clientID, { clock: 1, lastUpdated: Date.now() }]]) } as any,
      [clientID]
    );
    applyAwarenessUpdate(target['presence']['awareness'], update, 'remote');
    await vi.advanceTimersByTimeAsync(0);
    return clientID;
  }

  // Gone for good: removed from awareness and past the absence grace.
  async function removeRemote(clientID: number) {
    removeAwarenessStates(peer['presence']['awareness'], [clientID], 'remote');
    await vi.advanceTimersByTimeAsync(ABSENT_GRACE);
  }

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
    });

    test('should initialize user with correct default values', async () => {
      expect(peer.user()).toEqual({
        room: 'Lobby',
        dateJoined: expect.any(Number),
        handRaised: false,
        connections: [{ id: '', target: {} }],
      });
      // Name and role are derived for the view, not published.
      const { users } = await peer.toJSON();
      expect(users[peer['peerID']]).toMatchObject({ displayName: 'test-user', role: 'teacher', room: 'Lobby' });
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
        getPresenceAwareness: vi.fn(() => new Awareness(new Y.Doc())),
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
        getPresenceAwareness: vi.fn(() => new Awareness(new Y.Doc())),
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

    test('moves to the Lobby as soon as its room drops out of the view', async () => {
      const stationID = 'Station stn1';
      peer['connected'] = true;
      const station = await addRemote(stationID, { room: stationID }, 'test-peer-id');
      peer.gotoRoom(stationID);
      await vi.advanceTimersByTimeAsync(0);

      removeAwarenessStates(peer['presence']['awareness'], [station], 'remote');
      await vi.advanceTimersByTimeAsync(ABSENT_GRACE - 100);
      expect(peer.user().room).toBe(stationID);
      await vi.advanceTimersByTimeAsync(100);
      expect(stationID in (await peer.toJSON()).rooms).toBe(false);
      expect(peer.user().room).toBe('Lobby');
    });

    test('a room not seen since connecting takes two heartbeat checks', async () => {
      const stationID = 'Station stn1';
      peer['connected'] = true;
      peer.gotoRoom(stationID);
      await vi.advanceTimersByTimeAsync(0);

      peer['_leaveMissingRoom']();
      expect(peer.user().room).toBe(stationID);
      // The station shows up in between: we stay.
      const station = await addRemote(stationID, { room: stationID }, 'test-peer-id');
      peer['_leaveMissingRoom']();
      expect(peer.user().room).toBe(stationID);
      await removeRemote(station);
      expect(peer.user().room).toBe('Lobby');
    });

    test('a new connection forgets that our room was seen', async () => {
      const stationID = 'Station stn1';
      peer['connected'] = true;
      await addRemote(stationID, { room: stationID }, 'test-peer-id');
      peer.gotoRoom(stationID);
      await vi.advanceTimersByTimeAsync(0);

      // Reconnect and re-enter the station before its presence is back.
      peer['_connectProviderWithIdentity']('lab1');
      peer.initUser('student');
      peer.gotoRoom(stationID);
      await vi.advanceTimersByTimeAsync(0);
      expect(stationID in (await peer.toJSON()).rooms).toBe(false);
      expect(peer.user().room).toBe(stationID);
    });

    test('provider.onLeave(station) must NOT hide the station or move its visitors (regression)', async () => {
      const stationID = 'Station stn1';
      peer['connected'] = true;
      await addRemote(stationID, { room: stationID }, 'test-peer-id');
      peer.gotoRoom(stationID);

      const onLeaveCallback = (peer['provider'] as any).onLeave.mock.calls[0][0];
      onLeaveCallback(stationID);
      peer['_leaveMissingRoom']();
      peer['_leaveMissingRoom']();

      const view = await peer.toJSON();
      expect(view.users[stationID]).toBeDefined();
      expect(stationID in view.rooms).toBe(true);
      expect(peer.user().room).toBe(stationID);
    });

    test('a station room shows only while a station signed by the owner or a teacher is present', async () => {
      await addRemote('Station fake', { room: 'Station fake' }, 'some-student');
      // A leftover station Y.Map in the doc does not make a room on its own.
      peer.addRoom('Station gone');
      await vi.advanceTimersByTimeAsync(0);

      const { rooms, users } = await peer.toJSON();
      expect(Object.keys(rooms).filter((r) => r.startsWith('Station'))).toEqual([]);
      expect(users['Station fake']).toBeUndefined();
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
    test('should hide a departed peer via removePeers', async () => {
      await addRemote('stalePeer_s1', { room: 'Lobby' });
      expect(peer['presence'].has('stalePeer_s1')).toBe(true);

      peer['removePeers'](['stalePeer_s1']);
      expect(peer['presence'].has('stalePeer_s1')).toBe(false);
      expect(peer['presence'].has(peer['peerID'])).toBe(true);
    });

    test('provider onLeave hides the departed peer until it publishes again', async () => {
      await addRemote('leaverPubKey_s1', { room: 'Lobby' });
      const onLeaveCallback = (peer['provider'] as any).onLeave.mock.calls[0][0];
      onLeaveCallback('leaverPubKey_s1');
      expect(peer['presence'].has('leaverPubKey_s1')).toBe(false);

      vi.advanceTimersByTime(1);
      await addRemote('leaverPubKey_s1', { room: 'Lobby' });
      expect(peer['presence'].has('leaverPubKey_s1')).toBe(true);
    });

    test('an entry signed by someone else than its id is not shown', async () => {
      await addRemote('victimPub_s1', { room: 'Lobby' }, 'attackerPub');
      expect((await peer.toJSON()).users['victimPub_s1']).toBeUndefined();
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
      await addRemote('other_s1', { room: 'Lobby' });

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

    describe('y.setup is verified on read', () => {
      const plain = (v: any) => JSON.parse(JSON.stringify(v));
      const docSetup = () => ({
        config: plain(peer['y'].setup.get('config')),
        timestamp: peer['y'].setup.get('timestamp'),
      });
      const forge = (config: any, timestamp: number) =>
        peer['y'].doc.transact(() => {
          peer['y'].setup.set('config', config);
          peer['y'].setup.set('timestamp', timestamp);
        });
      // The constructor published the owner's setup; that is the good record.
      let published: { config: any; timestamp: number };
      beforeEach(async () => {
        // y.setup is observed from the first status/synced event on.
        mockWebrtcEvents.synced?.({ synced: true });
        await vi.advanceTimersByTimeAsync(0);
        published = docSetup();
        expect(published.config.setupSigner).toBe('test-peer-id');
      });

      test('the owner republishes its record verbatim over a forgery with the same timestamp', async () => {
        vi.mocked(verifySetup).mockResolvedValueOnce(false);
        forge({ ...published.config, name: 'PWNED' }, published.timestamp);
        await vi.advanceTimersByTimeAsync(0);

        expect(docSetup()).toEqual(published);
        expect(peer['lab'].data.name).toBeUndefined();
      });

      test('the owner republishes over a newer setup signed by someone no longer a teacher', async () => {
        forge({ ...published.config, name: 'stale', setupSigner: 'demoted-teacher-id' }, published.timestamp + 5000);
        await vi.advanceTimersByTimeAsync(0);

        expect(docSetup()).toEqual(published);
        expect(peer['lab'].timestamp).toBe(published.timestamp);
      });

      test('the owner republishes over a replayed older setup', async () => {
        forge({ ...published.config, name: 'old' }, published.timestamp - 5000);
        await vi.advanceTimersByTimeAsync(0);

        expect(docSetup()).toEqual(published);
      });

      test('a newer valid setup is adopted and left in place', async () => {
        const newer = { ...published.config, name: 'renamed', setupSignature: 'other-sig' };
        forge(newer, published.timestamp + 1000);
        await vi.advanceTimersByTimeAsync(0);

        expect(peer['lab'].data.name).toBe('renamed');
        expect(peer['lab'].timestamp).toBe(published.timestamp + 1000);
        expect(docSetup()).toEqual({ config: newer, timestamp: published.timestamp + 1000 });
      });

      test('a student never writes y.setup, whatever it holds', async () => {
        vi.mocked(getPeerID).mockReturnValue('student-peer-id');
        peer['lab'].data.members = { teacher: [], student: ['student-peer-id'] };
        const set = vi.spyOn(peer['y'].setup, 'set');

        vi.mocked(verifySetup).mockResolvedValueOnce(false);
        forge({ ...published.config, name: 'PWNED' }, published.timestamp + 1000);
        await vi.advanceTimersByTimeAsync(0);
        expect(verifySetup).toHaveBeenCalled();
        forge({ ...published.config, name: 'old' }, published.timestamp - 1000);
        await vi.advanceTimersByTimeAsync(0);
        peer['y'].doc.transact(() => peer['y'].setup.delete('config'));
        await vi.advanceTimersByTimeAsync(0);

        expect(peer['lab'].data.name).toBeUndefined();
        expect(peer['lab'].timestamp).toBe(published.timestamp);
        // Only the test's two forgeries (config + timestamp each) wrote.
        expect(set).toHaveBeenCalledTimes(4);
        expect(peer['y'].setup.get('config')).toBeUndefined();
      });
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

    test('room broadcast reaches everyone else in the room, plus a local echo', async () => {
      peer['connected'] = true;
      const localEcho = vi.fn();
      peer.on('message' as any, localEcho);
      await addRemote('inLobby_s1', { room: 'Lobby' });
      await addRemote('elsewhere_s1', { room: 'Room 1' });
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

    test('a protected classroom ignores local setup changes', () => {
      peer['lab'].hash = 'pinned-config-hash';
      const before = JSON.parse(JSON.stringify(peer['y'].setup.get('config')));

      peer.newSetup({
        id: 'lab1',
        data: { ...setup.data, name: 'edited' },
        timestamp: Date.now() + 1000,
      });

      expect(peer['lab'].timestamp).toBe(setup.timestamp);
      expect(peer['lab'].data.name).toBeUndefined();
      expect(peer['y'].setup.get('config')).toEqual(before);
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
      await peer['awaitTransact'](() => {
        peer['y'].rooms.set('Async', new Y.Map());
      });

      expect(peer['y'].rooms.has('Async')).toBe(true);
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

  describe('Presence view', () => {
    test('roles come from the setup, not from the peer', async () => {
      await addRemote('teacherPub_s1', { room: 'Lobby', role: 'student' });
      await addRemote('studentPub_s1', { room: 'Lobby', role: 'teacher', displayName: 'Admin' });
      peer['lab'].data.members.teacher = ['teacherPub'];

      const { users } = await peer.toJSON();
      expect(users['teacherPub_s1'].role).toBe('teacher');
      expect(users['studentPub_s1'].role).toBe('student');
      expect(users['studentPub_s1'].displayName).toBe('test-user');
    });

    test('a member excluded from the allowlist is hidden', async () => {
      await addRemote('other-pub_s1', { room: 'Lobby' });
      expect(peer['presence'].has('other-pub_s1')).toBe(true);

      peer['lab'].data.members.student = ['someone-else'];
      peer['_reverifyAfterSetup']();

      expect(peer['presence'].has('other-pub_s1')).toBe(false);
    });

    test('a stopped peer replaces its presence with its signed leave', () => {
      const aw = peer['presence']['awareness'];
      expect(aw.getLocalState().presence.payload.left).toBeUndefined();
      peer.stop();
      expect(aw.getLocalState().presence.payload).toEqual({ left: true });
    });

    test('a role change keeps the room', async () => {
      peer.gotoRoom('Room 1');
      await peer.join('teacher');
      expect(peer.user().room).toBe('Room 1');
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
      ['removed as teacher', { teacher: [ME], student: [] }, { teacher: [], student: [] }, 'removedTeacher'],
      ['added as teacher', { teacher: [], student: [] }, { teacher: [ME], student: [] }, 'addedTeacher'],
      ['added to the student allowlist', { teacher: [], student: ['other'] }, { teacher: [], student: [ME] }, 'addedStudent'],
      ['allowlist opened to everyone', { teacher: [], student: ['other'] }, { teacher: [], student: ['*'] }, 'addedStudent'],
      ['removed from the student allowlist', { teacher: [], student: [ME] }, { teacher: [], student: ['other'] }, 'removedStudent'],
      ['allowlist closed without me', { teacher: [], student: [] }, { teacher: [], student: ['other'] }, 'removedStudent'],
    ])('%s: tells the user', async (_case, oldMembers, newMembers, popup) => {
      i18n.global.locale.value = 'en';
      peer['t'] = i18n.global.t;
      const updateSpy = vi.spyOn(peer as any, 'update');

      peer.logSetupChanges({ members: oldMembers }, { members: newMembers });
      await vi.advanceTimersByTimeAsync(0);

      const popups = updateSpy.mock.calls.filter(([event]) => event === 'popup');
      expect(popups).toEqual([['popup', messages.en.peer.feedback[popup]]]);
    });
  });
});