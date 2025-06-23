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

  describe('Basic Utilities', () => {
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
