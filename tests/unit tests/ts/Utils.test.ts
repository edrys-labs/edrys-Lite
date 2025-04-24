import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { 
  validateUrl, 
  infoHash, 
  deepEqual, 
  hashJsonObject, 
  removeKeysStartingWithSecret, 
  getPeerID, 
  copyToClipboard, 
  download, 
  compareCommunicationConfig, 
  extractCommunicationConfigFromUrl, 
  updateUrlWithCommConfig,
  cleanUrlAfterCommConfigExtraction,
  encodeCommConfig,
  decodeCommConfig
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

  describe('validateUrl', () => {
    test('should return true for a valid URL', () => {
      expect(validateUrl('https://example.com')).toBe(true);
      expect(validateUrl('http://localhost:3000')).toBe(true);
    });

    test('should return false for an invalid URL', () => {
      expect(validateUrl('invalid-url')).toBe(false);
      expect(validateUrl('')).toBe(false);
    });
  });

  describe('infoHash', () => {
    test('should generate a string of the specified length', () => {
      const length = 20;
      const result = infoHash(length);
      expect(result).toHaveLength(length);
      expect(typeof result).toBe('string');
    });

    test('should generate unique strings', () => {
      const hashes = new Set();
      for (let i = 0; i < 100; i++) {
        hashes.add(infoHash());
      }
      expect(hashes.size).toBe(100);
    });

    test('should use provided length', () => {
      [5, 10, 15, 20].forEach(length => {
        expect(infoHash(length)).toHaveLength(length);
      });
    });
  });

  describe('deepEqual', () => {
    test('should return true for deeply equal objects', () => {
      const testCases = [
        [{ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } }],
        [{ a: [1, 2, 3] }, { a: [1, 2, 3] }],
        [{ a: null }, { a: null }],
      ];

      testCases.forEach(([obj1, obj2]) => {
        expect(deepEqual(obj1, obj2)).toBe(true);
      });
    });

    test('should return false for different objects', () => {
      const testCases = [
        [{ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }],
        [{ a: [1, 2, 3] }, { a: [1, 2, 4] }],
        [{ a: 1 }, { b: 1 }],
      ];

      testCases.forEach(([obj1, obj2]) => {
        expect(deepEqual(obj1, obj2)).toBe(false);
      });
    });
  });

  describe('hashJsonObject', () => {
    test('should hash objects consistently', async () => {
      const obj = { key: 'value', nested: { arr: [1, 2, 3] } };
      const hash1 = await hashJsonObject(obj);
      const hash2 = await hashJsonObject({ ...obj });
      expect(hash1).toBe(hash2);
    });

    test('should generate different hashes for different objects', async () => {
      const obj1 = { key: 'value1' };
      const obj2 = { key: 'value2' };
      const hash1 = await hashJsonObject(obj1);
      const hash2 = await hashJsonObject(obj2);
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('removeKeysStartingWithSecret', () => {
    test('should remove secret keys at all levels', () => {
      const obj = {
        normal: 'value',
        secretKey: 'hidden',
        nested: {
          secretNested: 'hidden',
          normal: 'visible'
        },
        arr: [{ secretArr: 'hidden' }]
      };

      removeKeysStartingWithSecret(obj);
      
      expect(obj).toEqual({
        normal: 'value',
        nested: {
          normal: 'visible'
        },
        arr: [{}]
      });
    });

    test('should handle empty objects', () => {
      const obj = {};
      removeKeysStartingWithSecret(obj);
      expect(obj).toEqual({});
    });
  });

  describe('getPeerID', () => {
    test('should generate consistent length IDs', () => {
      const withSession = getPeerID();
      const withoutSession = getPeerID(false);

      expect(withSession).toHaveLength(19);
      expect(withoutSession).toHaveLength(12);
    });

    test('should generate unique IDs', () => {
      const ids = new Set();
      for (let i = 0; i < 100; i++) {
        ids.add(getPeerID());
      }
      expect(ids.size).toBe(100);
    });
  });

  describe('clipboard operations', () => {
    test('should copy to clipboard', () => {
      const mockClipboard = {
        writeText: vi.fn().mockResolvedValue(undefined)
      };
      Object.assign(navigator, {
        clipboard: mockClipboard
      });

      const text = 'Test text';
      copyToClipboard(text);
      
      expect(mockClipboard.writeText).toHaveBeenCalledWith(text);
    });
  });

  describe('download', () => {
    test('should create and trigger download link', () => {
      const clickSpy = vi.fn();
      const createElement = document.createElement.bind(document);
      
      vi.spyOn(document, 'createElement').mockImplementation((tag) => {
        const element = createElement(tag);
        if (tag === 'a') {
          element.click = clickSpy;
        }
        return element;
      });

      const fileName = 'test.txt';
      const content = 'Hello, world!';
      
      download(fileName, content);

      expect(clickSpy).toHaveBeenCalled();
    });
  });

  describe('Communication Configuration', () => {
    describe('compareCommunicationConfig', () => {
      test('should handle null or undefined configs', () => {
        expect(compareCommunicationConfig(null, null)).toBe(true);
        expect(compareCommunicationConfig(undefined, undefined)).toBe(true);
        expect(compareCommunicationConfig(null, {})).toBe(false);
        expect(compareCommunicationConfig({}, null)).toBe(false);
      });

      test('should compare WebSocket configurations', () => {
        const config1 = {
          communicationMethod: 'Websocket',
          websocketUrl: 'wss://test1.com'
        };
        const config2 = {
          communicationMethod: 'Websocket',
          websocketUrl: 'wss://test2.com'
        };

        expect(compareCommunicationConfig(config1, config1)).toBe(true);
        expect(compareCommunicationConfig(config1, config2)).toBe(false);
      });

      test('should compare WebRTC configurations', () => {
        const config1 = {
          communicationMethod: 'WebRTC',
          signalingServer: ['wss://signal1.com'],
          webrtcConfig: { iceServers: [{ urls: 'stun:stun1.com' }] }
        };
        const config2 = {
          communicationMethod: 'WebRTC',
          signalingServer: ['wss://signal1.com'],
          webrtcConfig: { iceServers: [{ urls: 'stun:stun2.com' }] }
        };

        expect(compareCommunicationConfig(config1, config1)).toBe(true);
        expect(compareCommunicationConfig(config1, config2)).toBe(false);
      });

      test('should handle string WebRTC configs', () => {
        const config1 = {
          communicationMethod: 'WebRTC',
          signalingServer: ['wss://signal.com'],
          webrtcConfig: JSON.stringify({ iceServers: [{ urls: 'stun:stun1.com' }] })
        };
        const config2 = {
          communicationMethod: 'WebRTC',
          signalingServer: ['wss://signal.com'],
          webrtcConfig: { iceServers: [{ urls: 'stun:stun1.com' }] }
        };

        expect(compareCommunicationConfig(config1, config2)).toBe(true);
      });
    });

    describe('extractCommunicationConfigFromUrl', () => {
      const mockConfig = {
        communicationMethod: 'WebRTC',
        signalingServer: ['wss://test.com'],
        webrtcConfig: { iceServers: [{ urls: 'stun:test.com' }] }
      };
      const encodedConfig = btoa(encodeURIComponent(JSON.stringify(mockConfig)));

      test('should extract config from query parameter', () => {
        Object.defineProperty(window, 'location', {
          value: {
            search: `?comm=${encodedConfig}`
          },
          writable: true
        });

        const result = extractCommunicationConfigFromUrl();
        expect(result).toEqual(mockConfig);
      });

      test('should extract config from hash fragment', () => {
        Object.defineProperty(window, 'location', {
          value: {
            search: '',
            hash: `#comm=${encodedConfig}`
          },
          writable: true
        });

        const result = extractCommunicationConfigFromUrl();
        expect(result).toEqual(mockConfig);
      });

      test('should extract config from embedded query parameter', () => {
        Object.defineProperty(window, 'location', {
          value: {
            pathname: '/classroom/test',
            search: `?/classroom/test?comm=${encodedConfig}`,
            hash: '',
            href: `http://localhost/classroom/test?/classroom/test?comm=${encodedConfig}`
          },
          writable: true,
          configurable: true
        });

        const result = extractCommunicationConfigFromUrl();
        expect(result).toEqual(mockConfig);
      });

      test('should return null for invalid config', () => {
        Object.defineProperty(window, 'location', {
          value: {
            search: '?comm=invalid-config'
          },
          writable: true
        });

        const result = extractCommunicationConfigFromUrl();
        expect(result).toBeNull();
      });
    });

    describe('updateUrlWithCommConfig', () => {
      test('should update URL hash with encoded config', () => {
        const config = {
          communicationMethod: 'WebRTC',
          signalingServer: ['wss://test.com']
        };

        const mockReplaceState = vi.fn();
        Object.defineProperty(window, 'history', {
          value: { replaceState: mockReplaceState },
          writable: true
        });

        Object.defineProperty(window, 'location', {
          value: {
            href: 'http://localhost/test',
            origin: 'http://localhost',
            pathname: '/test'
          },
          writable: true
        });

        updateUrlWithCommConfig(config);

        expect(mockReplaceState).toHaveBeenCalledWith(
          null,
          '',
          expect.stringContaining('#comm=')
        );

        const url = mockReplaceState.mock.calls[0][2];
        const hash = new URL(url).hash;
        const extractedConfig = JSON.parse(
          decodeURIComponent(atob(hash.split('=')[1]))
        );
        expect(extractedConfig).toEqual(config);
      });

      test('should handle config encoding errors gracefully', () => {
        const consoleSpy = vi.spyOn(console, 'error');
        const circularConfig = { self: {} };
        circularConfig.self = circularConfig;

        updateUrlWithCommConfig(circularConfig);

        expect(consoleSpy).toHaveBeenCalledWith(
          'Error updating URL with comm config:',
          expect.any(Error)
        );

        consoleSpy.mockRestore();
      });
    });

    describe('cleanUrlAfterCommConfigExtraction', () => {
      test('should remove comm parameter from URL hash', () => {
        // Mock window.location and history
        const mockReplaceState = vi.fn();
        
        // Save originals
        const originalLocation = window.location;
        const originalHistory = window.history;
        
        // Define URL with comm parameter in hash
        Object.defineProperty(window, 'location', {
          value: {
            href: 'http://localhost/classroom/123#comm=abc123',
            hash: '#comm=abc123',
            pathname: '/classroom/123',
            search: ''
          },
          writable: true,
          configurable: true
        });
        
        // Mock history.replaceState
        Object.defineProperty(window, 'history', {
          value: { replaceState: mockReplaceState },
          writable: true,
          configurable: true
        });
        
        cleanUrlAfterCommConfigExtraction();
        
        // Check that replaceState was called with correct URL
        expect(mockReplaceState).toHaveBeenCalledWith(
          {},
          document.title,
          '/classroom/123'
        );
        
        // Restore original values
        Object.defineProperty(window, 'location', {
          value: originalLocation,
          writable: true,
          configurable: true
        });
        
        Object.defineProperty(window, 'history', {
          value: originalHistory,
          writable: true,
          configurable: true
        });
      });
    });

    describe('encodeCommConfig & decodeCommConfig', () => {
      test('encodes and decodes communication config correctly', () => {
        const originalConfig = {
          communicationMethod: 'WebRTC',
          signalingServer: ['wss://test.server'],
          webrtcConfig: { iceServers: [{ urls: 'stun:test.stun' }] }
        };
        
        const encoded = encodeCommConfig(originalConfig);
        
        expect(typeof encoded).toBe('string');
        expect(encoded.length).toBeGreaterThan(0);
        
        const decoded = decodeCommConfig(encoded as string);
        
        expect(decoded).toEqual(originalConfig);
      });
      
      test('encodeCommConfig handles null/undefined input', () => {
        expect(encodeCommConfig(null)).toBeNull();
        expect(encodeCommConfig(undefined)).toBeNull();
      });
      
      test('decodeCommConfig handles invalid input', () => {
        expect(decodeCommConfig('invalid-base64!')).toBeNull();
        
        expect(decodeCommConfig('')).toBeNull();
        
        expect(decodeCommConfig(null as unknown as string)).toBeNull();
      });
      
      test('handles complex configurations correctly', () => {
        const complexConfig = {
          communicationMethod: 'WebRTC',
          signalingServer: ['wss://primary.signal', 'wss://backup.signal'],
          webrtcConfig: {
            iceServers: [
              { urls: 'stun:stun1.example.com' },
              { urls: 'stun:stun2.example.com' },
              { urls: 'turn:turn.example.com', username: 'test', credential: 'test123' }
            ],
            iceTransportPolicy: 'all',
            bundlePolicy: 'max-bundle'
          },
          additionalInfo: {
            description: 'Test configuration',
            isCustom: true,
            timestamp: Date.now()
          }
        };
        
        const encoded = encodeCommConfig(complexConfig);
        const decoded = decodeCommConfig(encoded as string);
        
        expect(decoded).toEqual(complexConfig);
      });
    });
  });
});
