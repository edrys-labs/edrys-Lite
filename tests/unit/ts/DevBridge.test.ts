import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isDevEntry,
  devClassId,
  fetchLab,
  openDevLab,
  startDevBridge,
  classState,
  reportClass,
} from '../../../src/ts/DevBridge';

vi.mock('../../../src/ts/Database', () => ({ Database: vi.fn() }));

vi.mock('../../../src/ts/Utils', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  infoHash: vi.fn(() => 'new-class-id'),
  getPeerID: vi.fn(() => 'owner-key'),
  hashPubKey: vi.fn(async (key: string) => `hash-of-${key}`),
}));

const LAB = JSON.stringify({
  id: 'id-from-file',
  createdBy: 'someone-else',
  name: 'Dev Lab',
  modules: [{ url: 'https://example.com/module.html' }],
});

function serveLab(lab: any = { path: '/labs/lab.yml', text: LAB }) {
  const fetchMock = vi.fn(async (url: string) =>
    url === '/edrys-dev/lab'
      ? { ok: true, json: async () => lab }
      : { ok: true, json: async () => ({}) }
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function fakeDatabase(existing: string[] = []) {
  return {
    exists: vi.fn(async (id: string) => existing.includes(id)),
    put: vi.fn(async () => {}),
  } as any;
}

describe('DevBridge', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, '', '/');
  });

  describe('isDevEntry', () => {
    test('only `?dev` on a local host', () => {
      history.replaceState(null, '', '/?dev');
      expect(isDevEntry()).toBe(true);

      history.replaceState(null, '', '/?/classroom/abc');
      expect(isDevEntry()).toBe(false);
    });

    test('never on the hosted site', () => {
      vi.stubGlobal('location', { search: '?dev', hostname: 'edrys-labs.github.io' });
      expect(isDevEntry()).toBe(false);
    });
  });

  describe('fetchLab', () => {
    test('drops id and createdBy from the file', async () => {
      serveLab();
      const { path, data } = await fetchLab();

      expect(path).toBe('/labs/lab.yml');
      expect(data.name).toBe('Dev Lab');
      expect(data.id).toBeUndefined();
      expect(data.createdBy).toBeUndefined();
      expect(data.members).toEqual({ teacher: [], student: [] });
    });

    test('uses the communication config edrys-dev hands over', async () => {
      serveLab({
        path: '/labs/lab.yml',
        text: LAB,
        communication: { communicationMethod: 'Websocket', websocketUrl: 'ws://localhost:3210' },
      });
      const { data } = await fetchLab();

      expect(data.communicationConfig).toBeTruthy();
      expect(data.communicationConfig).not.toBe('ws');
    });

    test('rejects a file that is not a classroom', async () => {
      serveLab({ path: '/labs/lab.yml', text: '42' });
      await expect(fetchLab()).rejects.toThrow('not a classroom');
    });
  });

  describe('openDevLab', () => {
    test('imports the lab once, owned by this browser', async () => {
      serveLab();
      const database = fakeDatabase();

      const route = await openDevLab(database);

      expect(route).toBe('?/classroom/new-class-id/hash-of-owner-key');
      expect(database.put).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-class-id',
          data: expect.objectContaining({ id: 'new-class-id', createdBy: 'owner-key' }),
        })
      );
      expect(localStorage.getItem('edrys-dev:/labs/lab.yml')).toBe('new-class-id');
      expect(devClassId()).toBe('new-class-id');
    });

    test('reopens the same class after a restart', async () => {
      serveLab();
      localStorage.setItem('edrys-dev:/labs/lab.yml', 'known-id');
      const database = fakeDatabase(['known-id']);

      const route = await openDevLab(database);

      expect(route).toBe('?/classroom/known-id/hash-of-owner-key');
      expect(database.put).not.toHaveBeenCalled();
      expect(devClassId()).toBe('known-id');
    });

    test('imports again when the remembered class was deleted', async () => {
      serveLab();
      localStorage.setItem('edrys-dev:/labs/lab.yml', 'deleted-id');
      const database = fakeDatabase();

      expect(await openDevLab(database)).toBe('?/classroom/new-class-id/hash-of-owner-key');
      expect(database.put).toHaveBeenCalled();
    });
  });

  describe('startDevBridge', () => {
    let source: any;

    beforeEach(() => {
      source = null;
      vi.stubGlobal(
        'EventSource',
        vi.fn(function (this: any, url: string) {
          source = this;
          this.url = url;
          this.listeners = {};
          this.addEventListener = (type: string, fn: () => void) => (this.listeners[type] = fn);
          this.close = vi.fn();
        })
      );
    });

    test('applies the lab on connect and on every reload-lab', async () => {
      const fetchMock = serveLab();
      const apply = vi.fn();

      const stop = startDevBridge(apply);
      expect(source.url).toBe('/edrys-dev/events');

      source.onopen();
      await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      expect(apply.mock.calls[0][0].name).toBe('Dev Lab');
      expect(fetchMock).toHaveBeenCalledWith(
        '/edrys-dev/bridge',
        expect.objectContaining({ body: expect.stringContaining('"type":"open"') })
      );

      source.listeners['reload-lab']();
      await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(2));

      stop();
      expect(source.close).toHaveBeenCalled();
    });

    test('reports a share link that carries the sync server', async () => {
      const fetchMock = serveLab({
        path: '/labs/lab.yml',
        text: LAB,
        communication: { communicationMethod: 'Websocket', websocketUrl: 'ws://localhost:3210' },
      });
      history.replaceState(null, '', '/?/classroom/abc/owner');

      startDevBridge(vi.fn());
      source.onopen();

      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/edrys-dev/bridge', expect.anything()));
      const body = JSON.parse(
        (fetchMock.mock.calls as any[]).find(([url]) => url === '/edrys-dev/bridge')[1].body
      );
      const link = new URL(body.url);
      expect(link.search).toBe('?/classroom/abc/owner');
      expect(link.hash).toMatch(/^#comm=./);
    });

    test('confirms every lab it applied, changed or not', async () => {
      const fetchMock = serveLab();
      const apply = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false);
      const bodies = () =>
        (fetchMock.mock.calls as any[])
          .filter(([url]) => url === '/edrys-dev/bridge')
          .map(([, init]) => JSON.parse(init.body))
          .filter((body) => body.type === 'applied');

      startDevBridge(apply);
      source.listeners['reload-lab']();
      await vi.waitFor(() => expect(bodies()).toHaveLength(1));
      source.listeners['reload-lab']();
      await vi.waitFor(() => expect(bodies()).toHaveLength(2));

      expect(bodies()).toEqual([
        { type: 'applied', changed: true },
        { type: 'applied', changed: false },
      ]);
    });

    test('passes goto and reload-module commands on', () => {
      serveLab();
      const goto = vi.fn();
      const reloadModule = vi.fn();
      startDevBridge(vi.fn(), { goto, reloadModule });

      source.listeners['goto']({ data: JSON.stringify({ room: 'Room 1' }) });
      expect(goto).toHaveBeenCalledWith({ room: 'Room 1' });
      source.listeners['reload-module']({ data: JSON.stringify({ url: 'http://localhost:3211/term/' }) });
      expect(reloadModule).toHaveBeenCalledWith({ url: 'http://localhost:3211/term/' });
    });

    test('reports a lab that does not parse instead of applying it', async () => {
      const fetchMock = serveLab({ path: '/labs/lab.yml', text: '42' });
      const apply = vi.fn();
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      startDevBridge(apply);
      source.listeners['reload-lab']();

      await vi.waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          '/edrys-dev/bridge',
          expect.objectContaining({ body: expect.stringContaining('"type":"error"') })
        )
      );
      expect(apply).not.toHaveBeenCalled();
    });
  });
});

describe('classState', () => {
  const live = {
    rooms: { Lobby: {}, 'Room 1': {}, 'Station abc': {} },
    users: {
      'owner-key-s1': { displayName: 'owner', role: 'teacher', room: 'Room 1' },
      'student-key-s2': { displayName: 'stud', role: 'student', room: 'Lobby' },
      'Station abc': { displayName: 'Station abc', role: 'station', room: 'Station abc' },
    },
  };

  test('own room, who is in which room, the modules', () => {
    const state = classState(live, 'owner-key-s1', {
      modules: [{ name: 'Terminal', url: 'https://t' }, { url: 'https://editor' }],
    });

    expect(state).toEqual({
      room: 'Room 1',
      rooms: {
        Lobby: [{ name: 'stud', role: 'student' }],
        'Room 1': [{ name: 'owner', role: 'teacher', me: true }],
        'Station abc': [{ name: 'Station abc', role: 'station' }],
      },
      modules: ['Terminal', 'https://editor'],
    });
  });

  test('empty before the class is live', () => {
    expect(classState(null, 'x', null)).toEqual({ room: null, rooms: {}, modules: [] });
  });
});

describe('reportClass', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test('sends only changes, at most every 500 ms', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    const state = (room: string) => ({ room, rooms: {}, modules: [] });

    reportClass(state('Lobby'));
    reportClass(state('Room 1'));
    await vi.advanceTimersByTimeAsync(500);
    reportClass(state('Room 1'));
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse((fetchMock.mock.calls as any[])[0][1].body)).toEqual({
      type: 'class',
      ...state('Room 1'),
    });
  });
});
