import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateUrl, infoHash, deepEqual, hashJsonObject, removeKeysStartingWithSecret, getPeerID, copyToClipboard, download } from '../../../src/ts/Utils';

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
});
