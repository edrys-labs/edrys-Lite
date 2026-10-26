import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isDevEntry,
  devClassId,
  fetchLab,
  openDevLab,
  startDevBridge,
  classState,
  reportClass,
  reportMessage,
  runInModule,
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

    test('answers read-state with a reply of the same id', async () => {
      const fetchMock = serveLab();
      const rooms: Record<string, any> = {
        'Room 1': { code: 'x'.repeat(1500), frame: new Uint8Array(4), list: [{ n: 1 }] },
      };
      startDevBridge(vi.fn(), { readState: (room) => rooms[room] });
      const replies = () =>
        (fetchMock.mock.calls as any[])
          .map(([, init]) => JSON.parse(init.body))
          .filter((body) => body.type === 'reply');

      source.listeners['read-state']({ data: JSON.stringify({ id: 'a', room: 'Room 1' }) });
      source.listeners['read-state']({ data: JSON.stringify({ id: 'b', room: 'Room 1', key: 'code' }) });
      source.listeners['read-state']({ data: JSON.stringify({ id: 'c', room: 'Room 1', key: 'nope' }) });
      source.listeners['read-state']({ data: JSON.stringify({ id: 'd', room: 'Room 9' }) });

      await vi.waitFor(() => expect(replies()).toHaveLength(4));
      const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((id) => replies().find((reply) => reply.id === id));
      expect(a).toEqual({
        type: 'reply',
        id: 'a',
        value: {
          room: 'Room 1',
          state: { code: 'x'.repeat(1000) + '…(1500)', frame: { binary: 4 }, list: [{ n: 1 }] },
        },
      });
      expect(b.value).toEqual({ room: 'Room 1', key: 'code', value: 'x'.repeat(1500) });
      expect(c).toEqual({ type: 'reply', id: 'c', error: 'no key nope in Room 1; keys: code, frame, list' });
      expect(d).toEqual({ type: 'reply', id: 'd', error: 'no room Room 9' });
    });
  });
});

describe('runInModule', () => {
  const URL_ = 'http://localhost:3211/term/';

  function frame(url: string, answer?: (data: any) => any) {
    const iframe = document.createElement('iframe');
    iframe.dataset.moduleUrl = url;
    document.body.appendChild(iframe);
    const win = iframe.contentWindow!;
    vi.spyOn(win, 'postMessage').mockImplementation((data: any) => {
      const reply = answer?.(data);
      if (reply) {
        window.dispatchEvent(
          new MessageEvent('message', { data: { event: 'dev-ran', id: data.id, ...reply }, source: win })
        );
      }
    });
    return win;
  }

  afterEach(() => (document.body.innerHTML = ''));

  test('runs the code in every frame of the module and collects the answers', async () => {
    const first = frame(URL_, (data) => ({ value: `ran ${data.code}` }));
    frame(URL_, () => ({ error: 'ReferenceError: x is not defined' }));
    const other = frame('http://localhost:3211/clock/');

    const results = await runInModule({ url: URL_, code: '1 + 1', ms: 1000 });

    expect(results).toEqual([{ value: 'ran 1 + 1' }, { error: 'ReferenceError: x is not defined' }]);
    expect(first.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'dev-run', code: '1 + 1' }),
      '*'
    );
    expect(other.postMessage).not.toHaveBeenCalled();
  });

  test('ignores answers from other frames, and gives up after ms', async () => {
    const silent = frame(URL_);
    const stranger = frame('http://localhost:3211/clock/');
    (silent.postMessage as any).mockImplementation((data: any) =>
      // a forged answer from another frame
      window.dispatchEvent(
        new MessageEvent('message', { data: { event: 'dev-ran', id: data.id, value: 'forged' }, source: stranger })
      )
    );

    expect(await runInModule({ url: URL_, code: 'x', ms: 50 })).toEqual([
      { error: 'no answer within 0.05 s: not loaded yet, or still running' },
    ]);
  });

  test('a module not shown in the room is an error', async () => {
    await expect(runInModule({ url: URL_, code: 'x', ms: 50 })).rejects.toThrow("not shown in this tab's room");
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
      modules: [
        { name: 'Terminal', url: 'https://t' },
        { name: 'https://editor', url: 'https://editor' },
      ],
    });
  });

  test('names modules as loaded, and says which could not be loaded', () => {
    const data = {
      modules: [{ url: 'https://t' }, { url: 'https://gone' }, { url: 'https://later' }],
    };
    const scraped = [
      { url: 'https://t', name: 'Terminal' },
      { url: 'https://gone', name: '<Error: exception scraping module>', description: 'TypeError: Failed to fetch' },
    ];

    expect(classState(live, 'owner-key-s1', data, scraped).modules).toEqual([
      { name: 'Terminal', url: 'https://t' },
      { name: 'https://gone', url: 'https://gone', error: 'TypeError: Failed to fetch' },
      { name: 'https://later', url: 'https://later' },
    ]);
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

describe('reportMessage', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const bodies = (fetchMock: any) =>
    (fetchMock.mock.calls as any[]).map(([, init]) => JSON.parse(init.body));

  test('batches what the ?dev tab sees, leaves out huge bodies, counts what it drops', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('edrys-dev', 'class-1');

    // edrys-dev decodes the (MessagePack) body, so it comes as it is
    reportMessage('class-1', { subject: 'run', body: '3gABpGNvZGU=', module: 'https://t', from: 'Station 1', date: 1 });
    reportMessage('class-1', { subject: 'out', body: 'y'.repeat(30000), module: 'https://t', date: 2 });
    for (let i = 0; i < 60; i++) reportMessage('class-1', { subject: 'tick', body: i, date: 3 });
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [report] = bodies(fetchMock);
    expect(report.type).toBe('messages');
    expect(report.messages).toHaveLength(50);
    expect(report.dropped).toBe(12);
    expect(report.messages[0]).toEqual({ t: 1, subject: 'run', body: '3gABpGNvZGU=', module: 'https://t', from: 'Station 1' });
    expect(report.messages[1].body).toEqual({ tooLarge: 30000 });
  });

  test('names a sender as the class shows it, not by its whole key', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('edrys-dev', 'class-1');
    const key = 'BKo1pJWK0euTpIiBPwvR5iSFR05bzz1wXt3sHbaW/ElsUmolB1+O+zxFSVa/ZMKFwtPO3QzbNB/yq/hvoPxFaeM=';

    reportMessage('class-1', { subject: 'run', body: 1, from: key + '_session' });
    await vi.advanceTimersByTimeAsync(500);

    const from = bodies(fetchMock)[0].messages[0].from;
    expect(from.length).toBeLessThan(20);
    expect(from).not.toContain('_session');
  });

  test('does nothing outside the ?dev tab', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    sessionStorage.setItem('edrys-dev', 'class-1');

    reportMessage('another-class', { subject: 'run', body: 1 });
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
