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
});
