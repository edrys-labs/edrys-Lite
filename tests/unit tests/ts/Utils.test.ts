import { describe, test, expect, vi, beforeEach } from 'vitest';
import {
  validateUrl,
  infoHash,
  deepEqual,
  compareCommunicationConfig,
  extractCommunicationConfigFromUrl,
  updateUrlWithCommConfig,
  cleanUrlAfterCommConfigExtraction,
  encodeCommConfig,
  decodeCommConfig,
  stripPubKey,
} from '../../../src/ts/Utils';

vi.mock('js-yaml', () => ({
  load: vi.fn(),
  dump: vi.fn(),
}));

vi.mock('secure-ls', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      get: vi.fn(),
      set: vi.fn(),
    }))
  };
});

describe('Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Basic Utilities', () => {
    test('stripPubKey removes padding characters', () => {
      expect(stripPubKey('ABCdef==')).toBe('ABCdef')
      expect(stripPubKey('ABCdef=')).toBe('ABCdef')
      expect(stripPubKey('ABCdef')).toBe('ABCdef')
      expect(stripPubKey('AB+C/def=')).toBe('AB+C/def')
    });

    test('validateUrl should work for valid and invalid URLs', () => {
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('invalid-url')).toBe(false);
    });

    test('infoHash should generate unique strings of specified length', () => {
      const hash = infoHash(20);
      expect(hash).toHaveLength(20);
      expect(typeof hash).toBe('string');
      
      // Test uniqueness
      const hashes = new Set();
      for (let i = 0; i < 10; i++) {
        hashes.add(infoHash());
      }
      expect(hashes.size).toBe(10);
    });

    test('deepEqual should correctly compare objects', () => {
      expect(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
      expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    });
  });

    describe('Communication Configuration', () => {
    describe('compareCommunicationConfig', () => {
      test('should compare different communication configs correctly', () => {
        expect(compareCommunicationConfig(null, null)).toBe(true);
        expect(compareCommunicationConfig(null, {})).toBe(false);
        
        const wsConfig = { communicationMethod: 'Websocket', websocketUrl: 'wss://test.com' };
        const rtcConfig = { communicationMethod: 'WebRTC', signalingServer: ['wss://signal.com'] };
        
        expect(compareCommunicationConfig(wsConfig, wsConfig)).toBe(true);
        expect(compareCommunicationConfig(wsConfig, rtcConfig)).toBe(false);
      });
    });

    describe('extractCommunicationConfigFromUrl', () => {
      test('should extract config from URL hash and query parameters', () => {
        const mockConfig = { communicationMethod: 'WebRTC', signalingServer: ['wss://test.com'] };
        const encodedConfig = encodeCommConfig(mockConfig);

        Object.defineProperty(window, 'location', {
          value: { search: `?comm=${encodedConfig}`, hash: '' },
          writable: true
        });
        expect(extractCommunicationConfigFromUrl()).toEqual(mockConfig);

        Object.defineProperty(window, 'location', {
          value: { search: '', hash: `#comm=${encodedConfig}` },
          writable: true
        });
        expect(extractCommunicationConfigFromUrl()).toEqual(mockConfig);
      });

      test('should handle "ws" shorthand', () => {
        Object.defineProperty(window, 'location', {
          value: { search: '?comm=ws', hash: '' },
          writable: true
        });
        
        expect(extractCommunicationConfigFromUrl()).toEqual({
          communicationMethod: 'Websocket'
        });
      });
    });

    describe('URL Management', () => {
      test('updateUrlWithCommConfig should update URL with encoded config', () => {
        const config = { communicationMethod: 'WebRTC', signalingServer: ['wss://custom.com'] };
        const mockReplaceState = vi.fn();
        
        Object.defineProperty(window, 'history', {
          value: { replaceState: mockReplaceState },
          writable: true
        });
        Object.defineProperty(window, 'location', {
          value: { href: 'http://localhost/test', origin: 'http://localhost', pathname: '/test', search: '' },
          writable: true
        });

        updateUrlWithCommConfig(config);
        expect(mockReplaceState).toHaveBeenCalledWith(null, '', expect.stringContaining('#comm='));
      });

      test('cleanUrlAfterCommConfigExtraction should clean URL when shouldClean is true', () => {
        const mockReplaceState = vi.fn();
        
        Object.defineProperty(window, 'location', {
          value: { href: 'http://localhost/test#comm=abc', hash: '#comm=abc', pathname: '/test', search: '' },
          writable: true, configurable: true
        });
        Object.defineProperty(window, 'history', {
          value: { replaceState: mockReplaceState },
          writable: true, configurable: true
        });
        
        cleanUrlAfterCommConfigExtraction(true);
        expect(mockReplaceState).toHaveBeenCalledWith({}, document.title, '/test');
        
        vi.clearAllMocks();
        cleanUrlAfterCommConfigExtraction(false);
        expect(mockReplaceState).not.toHaveBeenCalled();
      });
    });

    describe('Config Encoding/Decoding', () => {
      test('should encode and decode communication configs correctly', () => {
        const config = {
          communicationMethod: 'WebRTC',
          signalingServer: ['wss://test.server'],
          webrtcConfig: { iceServers: [{ urls: 'stun:test.stun' }] }
        };
        
        const encoded = encodeCommConfig(config);
        const decoded = decodeCommConfig(encoded as string);
        expect(decoded).toEqual(config);
      });
      
      test('should handle null/undefined and invalid inputs', () => {
        expect(encodeCommConfig(null)).toBeNull();
        expect(decodeCommConfig('invalid-base64!')).toBeNull();
        expect(decodeCommConfig('')).toBeNull();
      });

      test('should use shorthand encoding for default configs', () => {
        // Default WebSocket -> "ws"
        expect(encodeCommConfig({ communicationMethod: 'Websocket' })).toBe('ws');
        expect(encodeCommConfig({ communicationMethod: 'Websocket', websocketUrl: 'wss://demos.yjs.dev' })).toBe('ws');
        
        // Default WebRTC -> null
        expect(encodeCommConfig({ communicationMethod: 'WebRTC' })).toBeNull();
        expect(encodeCommConfig({ 
          communicationMethod: 'WebRTC', 
          signalingServer: ['wss://rooms.deno.dev'] 
        })).toBeNull();
      });

      test('should decode "ws" shorthand correctly', () => {
        expect(decodeCommConfig('ws')).toEqual({ communicationMethod: 'Websocket' });
      });

      test('should encode custom configs normally', () => {
        const customWs = { communicationMethod: 'Websocket', websocketUrl: 'wss://custom.com' };
        const customRtc = { communicationMethod: 'WebRTC', signalingServer: ['wss://custom-signal.com'] };
        
        const encodedWs = encodeCommConfig(customWs);
        const encodedRtc = encodeCommConfig(customRtc);
        
        expect(encodedWs).not.toBe('ws');
        expect(encodedRtc).not.toBeNull();
        expect(typeof encodedWs).toBe('string');
        expect(typeof encodedRtc).toBe('string');
        
        expect(decodeCommConfig(encodedWs as string)).toEqual(customWs);
        expect(decodeCommConfig(encodedRtc as string)).toEqual(customRtc);
      });
    });
  });
});

// Crypto identity tests use real crypto.subtle and a mocked Database.
// vi.resetModules() per test ensures the module-level _cryptoReady singleton is cleared.
describe('Crypto Identity', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.resetModules();
    mockDb = {
      getPublicKeyRaw: vi.fn().mockResolvedValue(null),
      getPrivateKey: vi.fn().mockResolvedValue(null),
      setPublicKeyRaw: vi.fn().mockResolvedValue(undefined),
      setPrivateKey: vi.fn().mockResolvedValue(undefined),
    };
    vi.doMock('../../../src/ts/Database', () => ({ Database: vi.fn(() => mockDb) }));
  });

  async function freshUtils() {
    return import('../../../src/ts/Utils');
  }

  test('initCryptoIdentity generates a key pair and stores it', async () => {
    const { initCryptoIdentity, getPeerID, getDisplayPeerID } = await freshUtils();
    await initCryptoIdentity();

    expect(mockDb.setPublicKeyRaw).toHaveBeenCalledWith(expect.any(String));
    expect(mockDb.setPrivateKey).toHaveBeenCalledWith(expect.any(Object));

    const id = getPeerID(false);
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(10);

    expect(getDisplayPeerID()).not.toBe('…');
  });

  test('initCryptoIdentity is idempotent — returns the same promise', async () => {
    const { initCryptoIdentity } = await freshUtils();
    const p1 = initCryptoIdentity();
    const p2 = initCryptoIdentity();
    expect(p1).toBe(p2);
  });

  test('initCryptoIdentity reuses stored keys from DB', async () => {
    // Simulate a stored key pair by running a full init first, then re-importing
    const { initCryptoIdentity: init1 } = await freshUtils();
    await init1();
    const storedPub = mockDb.setPublicKeyRaw.mock.calls[0][0];
    const storedPriv = mockDb.setPrivateKey.mock.calls[0][0];

    // Reset module, make DB return the stored values
    vi.resetModules();
    mockDb.getPublicKeyRaw.mockResolvedValue(storedPub);
    mockDb.getPrivateKey.mockResolvedValue(storedPriv);
    vi.doMock('../../../src/ts/Database', () => ({ Database: vi.fn(() => mockDb) }));

    const { initCryptoIdentity: init2, getPeerID: id2 } = await freshUtils();
    await init2();

    // Should not generate new keys
    expect(mockDb.setPublicKeyRaw).toHaveBeenCalledTimes(1); // only from init1
    expect(id2(false)).toBe(storedPub);
  });

  test('getPeerID throws before initCryptoIdentity resolves', async () => {
    const { getPeerID } = await freshUtils();
    expect(() => getPeerID()).toThrow('getPeerID called before initCryptoIdentity resolved');
  });

  test('getDisplayPeerID returns "…" before init and short ID after', async () => {
    const { getDisplayPeerID, initCryptoIdentity } = await freshUtils();
    expect(getDisplayPeerID()).toBe('…');
    await initCryptoIdentity();
    expect(getDisplayPeerID()).not.toBe('…');
    expect(getDisplayPeerID().length).toBeGreaterThan(0);
  });

  test('signChallenge and verifyChallenge round-trip', async () => {
    const { initCryptoIdentity, signChallenge, verifyChallenge, getPeerID } = await freshUtils();
    await initCryptoIdentity();

    const classroomId = 'test-classroom-123';
    const signature = await signChallenge(classroomId);
    const pubKey = getPeerID(false);

    const valid = await verifyChallenge(classroomId, pubKey, signature);
    expect(valid).toBe(true);
  });

  test('verifyChallenge rejects a signature for a different classroom', async () => {
    const { initCryptoIdentity, signChallenge, verifyChallenge, getPeerID } = await freshUtils();
    await initCryptoIdentity();

    const signature = await signChallenge('room-A');
    const pubKey = getPeerID(false);

    const valid = await verifyChallenge('room-B', pubKey, signature);
    expect(valid).toBe(false);
  });

  test('verifyChallenge rejects a tampered signature', async () => {
    const { initCryptoIdentity, signChallenge, verifyChallenge, getPeerID } = await freshUtils();
    await initCryptoIdentity();

    const signature = await signChallenge('room-A');
    const pubKey = getPeerID(false);
    const tampered = signature.slice(0, -4) + 'AAAA';

    const valid = await verifyChallenge('room-A', pubKey, tampered);
    expect(valid).toBe(false);
  });

  test('signSetup and verifySetup round-trip', async () => {
    const { initCryptoIdentity, signSetup, verifySetup, getPeerID } = await freshUtils();
    await initCryptoIdentity();

    const data = {
      name: 'Test Classroom',
      meta: {},
      modules: [{ url: 'https://example.com/mod' }],
      members: { teacher: [], student: [] },
      createdBy: getPeerID(false),
      timestamp: Date.now(),
    };

    const sig = await signSetup(data);
    const valid = await verifySetup(data, sig, getPeerID(false));
    expect(valid).toBe(true);
  });

  test('verifySetup rejects a signature over tampered data', async () => {
    const { initCryptoIdentity, signSetup, verifySetup, getPeerID } = await freshUtils();
    await initCryptoIdentity();

    const data = {
      name: 'Test Classroom',
      meta: {},
      modules: [{ url: 'https://example.com/mod' }],
      members: { teacher: [], student: [] },
      createdBy: getPeerID(false),
      timestamp: Date.now(),
    };

    const sig = await signSetup(data);
    const tampered = { ...data, members: { teacher: ['attacker'], student: [] } };

    const valid = await verifySetup(tampered, sig, getPeerID(false));
    expect(valid).toBe(false);
  });

  test('verifySetup rejects a signature from a different key', async () => {
    const { initCryptoIdentity, signSetup, verifySetup, getPeerID } = await freshUtils();
    await initCryptoIdentity();

    const data = {
      name: 'Test Classroom',
      meta: {},
      modules: [],
      members: { teacher: [], student: [] },
      createdBy: getPeerID(false),
      timestamp: Date.now(),
    };
    const sig = await signSetup(data);

    // Generate a second identity
    vi.resetModules();
    mockDb.getPublicKeyRaw.mockResolvedValue(null);
    mockDb.getPrivateKey.mockResolvedValue(null);
    vi.doMock('../../../src/ts/Database', () => ({ Database: vi.fn(() => mockDb) }));
    const { initCryptoIdentity: init2, getPeerID: id2 } = await freshUtils();
    await init2();
    const otherPubKey = id2(false);

    const valid = await verifySetup(data, sig, otherPubKey);
    expect(valid).toBe(false);
  });

  test('hashPubKey returns a 16-char base64url string', async () => {
    const { initCryptoIdentity, getPeerID, hashPubKey } = await freshUtils();
    await initCryptoIdentity();

    const pubKey = getPeerID(false);
    const hash = await hashPubKey(pubKey);

    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(16);
    // base64url: no +, /, or =
    expect(hash).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test('hashPubKey is deterministic', async () => {
    const { initCryptoIdentity, getPeerID, hashPubKey } = await freshUtils();
    await initCryptoIdentity();
    const pubKey = getPeerID(false);

    const h1 = await hashPubKey(pubKey);
    const h2 = await hashPubKey(pubKey);
    expect(h1).toBe(h2);
  });

  test('hashPubKey produces different hashes for different keys', async () => {
    const { initCryptoIdentity, getPeerID, hashPubKey } = await freshUtils();
    await initCryptoIdentity();
    const pubKey1 = getPeerID(false);
    const hash1 = await hashPubKey(pubKey1);

    vi.resetModules();
    mockDb.getPublicKeyRaw.mockResolvedValue(null);
    mockDb.getPrivateKey.mockResolvedValue(null);
    vi.doMock('../../../src/ts/Database', () => ({ Database: vi.fn(() => mockDb) }));
    const { initCryptoIdentity: init2, getPeerID: id2, hashPubKey: hash2fn } = await freshUtils();
    await init2();
    const hash2 = await hash2fn(id2(false));

    expect(hash1).not.toBe(hash2);
  });

  // Signed live-state primitives

  test('canonicalize sorts keys deterministically', async () => {
    const { canonicalize } = await freshUtils();
    const a = canonicalize({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = canonicalize({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1,"c":{"x":2,"y":1}}');
  });

  test('canonicalize preserves array order and handles primitives', async () => {
    const { canonicalize } = await freshUtils();
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
    expect(canonicalize(null)).toBe('null');
    expect(canonicalize('s')).toBe('"s"');
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize(true)).toBe('true');
  });

  test('signEntry/verifyEntry round-trip on a user payload', async () => {
    const { initCryptoIdentity, signEntry, verifyEntry } = await freshUtils();
    await initCryptoIdentity();

    const payload = { room: 'Lobby', role: 'student', displayName: 'Alice' };
    const env = await signEntry('users', 'pubkey_abc', payload);

    const valid = await verifyEntry('users', 'pubkey_abc', payload, env);
    expect(valid).toBe(true);
  });

  test('verifyEntry rejects tampered payload', async () => {
    const { initCryptoIdentity, signEntry, verifyEntry } = await freshUtils();
    await initCryptoIdentity();

    const env = await signEntry('users', 'pubkey_abc', { room: 'Lobby' });
    const tampered = await verifyEntry('users', 'pubkey_abc', { room: 'Room1' }, env);
    expect(tampered).toBe(false);
  });

  test('verifyEntry rejects cross-container replay (users <-> rooms)', async () => {
    const { initCryptoIdentity, signEntry, verifyEntry } = await freshUtils();
    await initCryptoIdentity();

    const env = await signEntry('users', 'name_x', { foo: 1 });
    const replay = await verifyEntry('rooms', 'name_x', { foo: 1 }, env);
    expect(replay).toBe(false);
  });

  test('verifyEntry rejects cross-key replay', async () => {
    const { initCryptoIdentity, signEntry, verifyEntry } = await freshUtils();
    await initCryptoIdentity();

    const env = await signEntry('users', 'key-A', { foo: 1 });
    const replay = await verifyEntry('users', 'key-B', { foo: 1 }, env);
    expect(replay).toBe(false);
  });

  test('verifyEntry rejects stale nonce outside replay window', async () => {
    const { initCryptoIdentity, signEntry, verifyEntry } = await freshUtils();
    await initCryptoIdentity();

    // Sign with a nonce far in the past.
    const env = await signEntry('users', 'k', { x: 1 }, Date.now() - 5 * 60_000);
    const valid = await verifyEntry('users', 'k', { x: 1 }, env);
    expect(valid).toBe(false);
  });

  test('verifyEntry accepts nonce inside replay window', async () => {
    const { initCryptoIdentity, signEntry, verifyEntry } = await freshUtils();
    await initCryptoIdentity();

    const env = await signEntry('users', 'k', { x: 1 }, Date.now() - 1_000);
    const valid = await verifyEntry('users', 'k', { x: 1 }, env);
    expect(valid).toBe(true);
  });

  test('verifyEntry rejects malformed envelopes', async () => {
    const { verifyEntry } = await freshUtils();
    expect(await verifyEntry('users', 'k', {}, null as any)).toBe(false);
    expect(await verifyEntry('users', 'k', {}, undefined as any)).toBe(false);
    expect(await verifyEntry('users', 'k', {}, { signer: 'a', signature: 'b' } as any)).toBe(false);
    expect(await verifyEntry('users', 'k', {}, { signer: 'a', nonce: NaN, signature: 'b' } as any)).toBe(false);
  });

  test('REVERT_INVALID_ORIGIN is the expected sentinel string', async () => {
    const { REVERT_INVALID_ORIGIN } = await freshUtils();
    expect(REVERT_INVALID_ORIGIN).toBe('revert-invalid');
  });
});

// ---------------------------------------------------------------------------
// y.users authorization rule (isAuthorizedUserSigner)
// ---------------------------------------------------------------------------
describe('isAuthorizedUserSigner', () => {
  // Re-imported per test so the (unused) crypto state doesn't leak; the rule
  // itself is pure.
  async function freshPeerHelpers() {
    vi.resetModules();
    vi.doMock('../../../src/ts/Database', () => ({
      Database: vi.fn(() => ({
        getPublicKeyRaw: vi.fn().mockResolvedValue(null),
        getPrivateKey: vi.fn().mockResolvedValue(null),
        setPublicKeyRaw: vi.fn(),
        setPrivateKey: vi.fn(),
      })),
    }));
    return import('../../../src/ts/Peer');
  }

  test('human peer: signer matching pubkey prefix is authorized', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers();
    const pubkey = 'BGdxv12345abc';
    const id = `${pubkey}_sess001`;
    expect(isAuthorizedUserSigner(id, pubkey, 'owner-pk', [])).toBe(true);
  });

  test('human peer: signer with different pubkey is rejected (spoofing)', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers();
    const id = 'BGdxv12345abc_sess001';
    expect(isAuthorizedUserSigner(id, 'attacker-pk', 'owner-pk', [])).toBe(false);
  });

  test('human peer: base64 padding (=) is ignored when matching', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers();
    const id = 'BGdxv12345abc==_sess001';
    expect(isAuthorizedUserSigner(id, 'BGdxv12345abc', 'owner-pk', [])).toBe(true);
    expect(isAuthorizedUserSigner(id, 'BGdxv12345abc==', 'owner-pk', [])).toBe(true);
  });

  test('human peer: missing session separator is rejected', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers();
    expect(isAuthorizedUserSigner('NoSeparator', 'NoSeparator', 'owner-pk', [])).toBe(false);
  });

  test('station peer: owner signature is authorized', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers();
    const id = 'Station myStn1';
    const owner = 'owner-pk';
    expect(isAuthorizedUserSigner(id, owner, owner, [])).toBe(true);
  });

  test('station peer: teacher signature is authorized', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers();
    const id = 'Station myStn1';
    expect(isAuthorizedUserSigner(id, 'teacher-pk', 'owner-pk', ['teacher-pk'])).toBe(true);
  });

  test('station peer: random participant is rejected', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers();
    const id = 'Station myStn1';
    expect(isAuthorizedUserSigner(id, 'random-pk', 'owner-pk', ['teacher-pk'])).toBe(false);
  });

  test('empty signer is rejected', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers();
    expect(isAuthorizedUserSigner('any_id', '', 'owner', [])).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// y.rooms authorization rule (isAuthorizedRoomSigner)
// ---------------------------------------------------------------------------
describe('isAuthorizedRoomSigner', () => {
  async function freshPeerHelpers() {
    vi.resetModules();
    vi.doMock('../../../src/ts/Database', () => ({
      Database: vi.fn(() => ({
        getPublicKeyRaw: vi.fn().mockResolvedValue(null),
        getPrivateKey: vi.fn().mockResolvedValue(null),
        setPublicKeyRaw: vi.fn(),
        setPrivateKey: vi.fn(),
      })),
    }));
    return import('../../../src/ts/Peer');
  }

  test('default room "Lobby" is creatable by any signer (bootstrap)', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Lobby', 'any-student-pk', 'owner-pk', [])).toBe(true);
  });

  test('"Room N" requires owner or teacher (not any signer)', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Room 1', 'student-pk', 'owner-pk', [])).toBe(false);
    expect(isAuthorizedRoomSigner('Room 42', 'student-pk', 'owner-pk', [])).toBe(false);
    expect(isAuthorizedRoomSigner('Room 1', 'owner-pk', 'owner-pk', [])).toBe(true);
    expect(isAuthorizedRoomSigner('Room 1', 'teacher-pk', 'owner-pk', ['teacher-pk'])).toBe(true);
  });

  test('non-default room: owner is authorized', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Discussion', 'owner-pk', 'owner-pk', [])).toBe(true);
  });

  test('non-default room: teacher is authorized', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Discussion', 'teacher-pk', 'owner-pk', ['teacher-pk'])).toBe(true);
  });

  test('non-default room: random participant is rejected', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Discussion', 'student-pk', 'owner-pk', ['teacher-pk'])).toBe(false);
  });

  test('station room: owner is authorized', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Station myStn', 'owner-pk', 'owner-pk', [])).toBe(true);
  });

  test('station room: teacher is authorized', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Station myStn', 'teacher-pk', 'owner-pk', ['teacher-pk'])).toBe(true);
  });

  test('station room: random participant is rejected', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Station myStn', 'random-pk', 'owner-pk', ['teacher-pk'])).toBe(false);
  });

  test('base64 padding (=) is ignored when matching owner/teacher', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Discussion', 'owner-pk==', 'owner-pk', [])).toBe(true);
    expect(isAuthorizedRoomSigner('Discussion', 'teacher-pk', 'owner-pk', ['teacher-pk=='])).toBe(true);
  });

  test('empty signer is rejected', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Discussion', '', 'owner-pk', ['teacher-pk'])).toBe(false);
  });

  test('room name that looks like default but isn\'t (e.g., "Room foo") requires owner/teacher', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers();
    expect(isAuthorizedRoomSigner('Room foo', 'student-pk', 'owner-pk', [])).toBe(false);
    expect(isAuthorizedRoomSigner('Room foo', 'owner-pk', 'owner-pk', [])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Migration tests
// ---------------------------------------------------------------------------
describe('runMigrationIfNeeded', () => {
  let mockDb: any
  let mockLsGet: ReturnType<typeof vi.fn>
  let mockLsRemove: ReturnType<typeof vi.fn>
  const LEGACY_ID = 'ᕡᠸ䆼ʀ焣⠺怭ĸ'

  const makeClassroom = (id: string, createdBy: string, teachers: string[] = []) => ({
    id,
    timestamp: 1000,
    hash: null,
    data: {
      id,
      createdBy,
      name: 'Test Class',
      meta: { logo: '', description: '', selfAssign: false, defaultNumberOfRooms: 0 },
      members: { teacher: teachers, student: [] },
      modules: [],
    },
  })

  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()

    mockLsGet = vi.fn().mockReturnValue(null)
    mockLsRemove = vi.fn()
    vi.doMock('secure-ls', () => ({
      default: vi.fn().mockImplementation(() => ({
        get: mockLsGet,
        set: vi.fn(),
        remove: mockLsRemove,
      }))
    }))

    mockDb = {
      getPublicKeyRaw: vi.fn().mockResolvedValue(null),
      getPrivateKey: vi.fn().mockResolvedValue(null),
      setPublicKeyRaw: vi.fn().mockResolvedValue(undefined),
      setPrivateKey: vi.fn().mockResolvedValue(undefined),
      getMigrationDone: vi.fn().mockResolvedValue(false),
      setMigrationDone: vi.fn().mockResolvedValue(undefined),
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
    }
    vi.doMock('../../../src/ts/Database', () => ({ Database: vi.fn(() => mockDb) }))
  })

  async function freshUtils() {
    return import('../../../src/ts/Utils')
  }

  test('returns false and marks done when no legacy peerID_ in localStorage', async () => {
    const { initCryptoIdentity, runMigrationIfNeeded } = await freshUtils()
    await initCryptoIdentity()

    const result = await runMigrationIfNeeded()

    expect(result).toBe(false)
    expect(mockDb.getAll).not.toHaveBeenCalled()
    expect(mockDb.setMigrationDone).toHaveBeenCalledOnce()
  })

  test('returns false immediately when migration already done', async () => {
    mockDb.getMigrationDone.mockResolvedValue(true)
    mockLsGet.mockReturnValue(LEGACY_ID)

    const { initCryptoIdentity, runMigrationIfNeeded } = await freshUtils()
    await initCryptoIdentity()

    const result = await runMigrationIfNeeded()

    expect(result).toBe(false)
    expect(mockDb.getAll).not.toHaveBeenCalled()
    expect(mockDb.setMigrationDone).not.toHaveBeenCalled()
  })

  test('migrates own classrooms and returns true', async () => {
    mockLsGet.mockReturnValue(LEGACY_ID)
    mockDb.getAll.mockResolvedValue([
      makeClassroom('class-1', LEGACY_ID, ['some-old-teacher']),
    ])

    const { initCryptoIdentity, runMigrationIfNeeded, getPeerID } = await freshUtils()
    await initCryptoIdentity()
    const myPubKey = getPeerID(false)

    const result = await runMigrationIfNeeded()

    expect(result).toBe(true)
    expect(mockDb.put).toHaveBeenCalledOnce()

    const written = mockDb.put.mock.calls[0][0]
    expect(written.data.createdBy).toBe(myPubKey)
    expect(written.data.members.teacher).toEqual([])
    expect(written.data.setupSigner).toBe(myPubKey)
    expect(typeof written.data.setupSignature).toBe('string')
    expect(written.hash).toBeNull()
  })

  test('does not touch classrooms owned by someone else', async () => {
    mockLsGet.mockReturnValue(LEGACY_ID)
    const othersClassroom = makeClassroom('class-other', 'some-other-user-id')
    mockDb.getAll.mockResolvedValue([othersClassroom])

    const { initCryptoIdentity, runMigrationIfNeeded } = await freshUtils()
    await initCryptoIdentity()

    const result = await runMigrationIfNeeded()

    expect(result).toBe(true) // migration ran (legacy key was present)
    expect(mockDb.put).not.toHaveBeenCalled() // but nothing was rewritten
  })

  test('migrates only own classrooms when mixed with others', async () => {
    mockLsGet.mockReturnValue(LEGACY_ID)
    mockDb.getAll.mockResolvedValue([
      makeClassroom('own-class', LEGACY_ID),
      makeClassroom('other-class', 'foreign-peer-id'),
    ])

    const { initCryptoIdentity, runMigrationIfNeeded, getPeerID } = await freshUtils()
    await initCryptoIdentity()
    const myPubKey = getPeerID(false)

    await runMigrationIfNeeded()

    expect(mockDb.put).toHaveBeenCalledOnce()
    expect(mockDb.put.mock.calls[0][0].id).toBe('own-class')
    expect(mockDb.put.mock.calls[0][0].data.createdBy).toBe(myPubKey)
  })

  test('removes peerID_ from localStorage after migration', async () => {
    mockLsGet.mockReturnValue(LEGACY_ID)
    mockDb.getAll.mockResolvedValue([makeClassroom('c1', LEGACY_ID)])

    const { initCryptoIdentity, runMigrationIfNeeded } = await freshUtils()
    await initCryptoIdentity()
    await runMigrationIfNeeded()

    expect(mockLsRemove).toHaveBeenCalledWith('peerID_')
  })

  test('marks migration done after running', async () => {
    mockLsGet.mockReturnValue(LEGACY_ID)
    mockDb.getAll.mockResolvedValue([])

    const { initCryptoIdentity, runMigrationIfNeeded } = await freshUtils()
    await initCryptoIdentity()
    await runMigrationIfNeeded()

    expect(mockDb.setMigrationDone).toHaveBeenCalledOnce()
  })

  test('migrated classroom has a valid re-signable signature', async () => {
    mockLsGet.mockReturnValue(LEGACY_ID)
    mockDb.getAll.mockResolvedValue([makeClassroom('c1', LEGACY_ID)])

    const { initCryptoIdentity, runMigrationIfNeeded, getPeerID, verifySetup } = await freshUtils()
    await initCryptoIdentity()
    const myPubKey = getPeerID(false)
    await runMigrationIfNeeded()

    const written = mockDb.put.mock.calls[0][0].data
    const valid = await verifySetup(
      {
        name: written.name,
        meta: written.meta,
        modules: written.modules,
        members: written.members,
        createdBy: written.createdBy,
        timestamp: mockDb.put.mock.calls[0][0].timestamp,
        communicationConfig: written.communicationConfig,
      },
      written.setupSignature,
      myPubKey
    )
    expect(valid).toBe(true)
  })
})
