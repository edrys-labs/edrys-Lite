import { describe, test, expect, beforeEach, vi, afterEach } from 'vitest';
import Peer from '../../../src/ts/Peer';
import * as Y from 'yjs';
import { EdrysWebrtcProvider } from '../../../src/ts/EdrysWebrtcProvider';
import { getPeerID, getShortPeerID } from '../../../src/ts/Utils';

// Mock dependencies
vi.mock('../../../src/ts/EdrysWebrtcProvider', () => {
  return {
    EdrysWebrtcProvider: vi.fn().mockImplementation(() => ({
      on: vi.fn(),
      onLeave: vi.fn(),
      onMessage: vi.fn(),
      sendMessage: vi.fn(),
      disconnect: vi.fn(),
      destroy: vi.fn(),
      awareness: {
        on: vi.fn(),
        getStates: vi.fn().mockReturnValue(new Map()),
      },
    })),
  };
});

vi.mock('../../../src/ts/Utils', () => ({
  getPeerID: vi.fn(() => 'peer-12345'),
  getShortPeerID: vi.fn(() => 'peer-short'),
  hashJsonObject: vi.fn().mockResolvedValue('test-hash'),
  deepEqual: vi.fn((obj1, obj2) => {
    return JSON.stringify(obj1) === JSON.stringify(obj2);
  }),
}));

describe('Peer Class', () => {
  let peer: Peer;
  let setup: any;

  beforeEach(() => {
    vi.clearAllMocks();

    setup = {
      id: 'lab1',
      data: { 
        meta: { defaultNumberOfRooms: 1 }, 
        members: {teacher: [], student: []} 
      },
      timestamp: Date.now(),
      hash: null,
    };

    peer = new Peer(setup);
  });

  afterEach(() => {
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
      expect(user.get('displayName')).toBe('peer-short');
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

    test('should prevent unauthorized users from broadcasting', () => {
      const originalAllowedToParticipate = peer['allowedToParticipate'];
      peer['allowedToParticipate'] = () => false;
      peer['connected'] = true;
      
      const consoleSpy = vi.spyOn(console, 'warn');
      peer.broadcast('Lobby', { data: 'test' });
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Unauthorized user trying to broadcast message, contact admin for access'
      );
      
      peer['allowedToParticipate'] = originalAllowedToParticipate;
      consoleSpy.mockRestore();
    });

    test('should prevent unauthorized state updates', () => {
      const originalAllowedToParticipate = peer['allowedToParticipate'];
      peer['allowedToParticipate'] = () => false;
      
      const consoleSpy = vi.spyOn(console, 'warn');
      peer.updateState(new Uint8Array());
      
      expect(consoleSpy).toHaveBeenCalledWith(
        'Your state changes will not be propagated to other users, contact admin for lab access'
      );
      
      peer['allowedToParticipate'] = originalAllowedToParticipate;
      consoleSpy.mockRestore();
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
        user: 'peer-short'
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
});