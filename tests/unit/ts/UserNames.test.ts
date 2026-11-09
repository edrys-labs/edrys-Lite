import { describe, expect, test } from 'vitest';
import { MAX_USERNAME_LENGTH, validUsername } from '../../../src/ts/UserNames';

describe('validUsername', () => {
  test('keeps a normal name, trimmed and with single spaces', () => {
    expect(validUsername('  Ada   Lovelace\t')).toBe('Ada Lovelace');
  });

  test.each([undefined, null, 42, {}, ['Ada']])('has no name for the non-string %j', (value) => {
    expect(validUsername(value)).toBeNull();
  });

  test.each(['', '   ', '\u202E', '‍‌'])('has no name for the blank %j', (value) => {
    expect(validUsername(value)).toBeNull();
  });

  test.each(['ㅤ', '⠀', '️', ' ㅤ ⠀ '])('has no name for the invisible %j', (value) => {
    expect(validUsername(value)).toBeNull();
  });

  test('keeps emoji variation selectors', () => {
    expect(validUsername('❤️')).toBe('❤️');
  });

  test('strips control characters and bidi overrides', () => {
    expect(validUsername('Ad\u0007a')).toBe('Ada');
    expect(validUsername('\u202EAda\u202C')).toBe('Ada');
  });

  test('keeps the joiners that emoji and some scripts need', () => {
    expect(validUsername('👩‍💻')).toBe('👩‍💻');
    expect(validUsername('می‌خواهم')).toBe('می‌خواهم');
  });

  test('counts characters, so emoji are not penalized', () => {
    expect(validUsername('😀'.repeat(MAX_USERNAME_LENGTH))).toBe('😀'.repeat(MAX_USERNAME_LENGTH));
  });

  test('rejects a name over the limit rather than cutting it', () => {
    expect(validUsername('a'.repeat(MAX_USERNAME_LENGTH))).toBe('a'.repeat(MAX_USERNAME_LENGTH));
    expect(validUsername('a'.repeat(MAX_USERNAME_LENGTH + 1))).toBeNull();
  });
});
