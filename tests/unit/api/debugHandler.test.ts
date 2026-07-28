import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('debug', () => {
  const fn: any = vi.fn((namespace: string) => {
    const logger: any = (..._args: any[]) => {};
    logger.namespace = namespace;
    return logger;
  });
  fn.enable = vi.fn();
  fn.disable = vi.fn();
  fn.enabled = () => false;
  return { default: fn };
});

import createDebug from 'debug';
import {
  enableDebug,
  disableDebug,
  disableSpecificDebug,
} from '../../../src/api/debugHandler';

describe('debugHandler', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('enableDebug calls createDebug.enable and persists to localStorage', () => {
    enableDebug('ts:peer,ts:database');

    expect(createDebug.enable).toHaveBeenCalledWith('ts:peer,ts:database');
    expect(localStorage.debug).toBe('ts:peer,ts:database');
  });

  test('disableDebug calls createDebug.disable and clears localStorage', () => {
    localStorage.debug = 'ts:peer';

    disableDebug();

    expect(createDebug.disable).toHaveBeenCalled();
    expect(localStorage.getItem('debug')).toBeNull();
  });

  test('disableSpecificDebug removes only the named namespace', () => {
    enableDebug('ts:peer,ts:database,components:chat');

    disableSpecificDebug('ts:database');

    expect(localStorage.debug).toBe('ts:peer,components:chat');
  });

  test('disableSpecificDebug supports wildcard prefixes', () => {
    enableDebug('ts:peer,ts:database,components:chat');

    disableSpecificDebug('ts:*');

    expect(localStorage.debug).toBe('components:chat');
  });

  test('disableSpecificDebug disables entirely when the last namespace is removed', () => {
    enableDebug('ts:peer');

    disableSpecificDebug('ts:peer');

    expect(createDebug.disable).toHaveBeenCalled();
    expect(localStorage.getItem('debug')).toBeNull();
  });

  test('disableSpecificDebug is a no-op when nothing is currently enabled', () => {
    disableSpecificDebug('ts:peer');

    expect(localStorage.getItem('debug')).toBeNull();
  });
});
