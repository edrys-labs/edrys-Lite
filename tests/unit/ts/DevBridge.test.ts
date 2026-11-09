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
  rescrapeModules,
  withFresh,
  studentLink,
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

// classes by id, each owned by `createdBy` (this browser's key by default)
function fakeDatabase(existing: string[] = [], createdBy = 'owner-key') {
  return {
    get: vi.fn(async (id: string) => (existing.includes(id) ? { id, data: { id, createdBy } } : null)),
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

    test('passes the parser\'s message on, with line and column', async () => {
      serveLab({ path: '/labs/lab.yml', text: 'name: Lab\nmodules:\n  - url: a\n   bad: indent\n' });
      await expect(fetchLab()).rejects.toThrow(/could not parse \/labs\/lab\.yml: .*\(4:\d+\)/);
    });
  });

  describe('studentLink', () => {
    const local = 'http://localhost:3210/?/classroom/class-1/hash#comm=xyz';

    test('moves the dev class\'s link onto the site students join on', async () => {
      // before edrys-dev said anything: as it is
      expect(studentLink(local, 'class-1')).toBe(local);

      serveLab({ path: '/labs/lab.yml', text: LAB, studentSite: 'https://edrys-labs.github.io/' });
      await fetchLab();
      sessionStorage.setItem('edrys-dev', 'class-1');
      expect(studentLink(local, 'class-1')).toBe('https://edrys-labs.github.io/?/classroom/class-1/hash#comm=xyz');
      // another class, or a tab that does not follow the lab: as it is
      expect(studentLink(local, 'class-2')).toBe(local);
      sessionStorage.clear();
      expect(studentLink(local, 'class-1')).toBe(local);
    });

    test('null when students cannot join (--local), also for a site that is no http(s) address', async () => {
      sessionStorage.setItem('edrys-dev', 'class-1');
      for (const studentSite of [null, 'javascript:alert(1)']) {
        serveLab({ path: '/labs/lab.yml', text: LAB, studentSite });
        await fetchLab();
        expect(studentLink(local, 'class-1')).toBeNull();
      }
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

    test('imports again when the remembered class belongs to another key', async () => {
      serveLab();
      localStorage.setItem('edrys-dev:/labs/lab.yml', 'old-identity-id');
      const database = fakeDatabase(['old-identity-id'], 'previous-key');

      expect(await openDevLab(database)).toBe('?/classroom/new-class-id/hash-of-owner-key');
      expect(database.put).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ createdBy: 'owner-key' }) })
      );
      expect(localStorage.getItem('edrys-dev:/labs/lab.yml')).toBe('new-class-id');
    });

    test('keeps a class whose key differs only in base64 padding', async () => {
      serveLab();
      localStorage.setItem('edrys-dev:/labs/lab.yml', 'padded-id');
      const database = fakeDatabase(['padded-id'], 'owner-key==');

      expect(await openDevLab(database)).toBe('?/classroom/padded-id/hash-of-owner-key');
      expect(database.put).not.toHaveBeenCalled();
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
      const urls = ['http://localhost:3211/term/', 'http://127.0.0.1:3211/term/'];
      source.listeners['reload-module']({ data: JSON.stringify({ urls }) });
      expect(reloadModule).toHaveBeenLastCalledWith({ urls });
    });

    test('announces the tutor while edrys-dev offers it, and passes its answers on', async () => {
      serveLab({ path: '/labs/lab.yml', text: LAB, tutor: true });
      const tutor = vi.fn();
      const tutorAnswer = vi.fn();
      startDevBridge(vi.fn(), { tutor, tutorAnswer });

      source.onopen();
      await vi.waitFor(() => expect(tutor).toHaveBeenLastCalledWith(true));
      // edrys-dev gone
      source.onerror();
      expect(tutor).toHaveBeenLastCalledWith(false);

      const answer = { id: 'r1', student: 'key', text: 'Try Ohm' };
      source.listeners['tutor-answer']({ data: JSON.stringify(answer) });
      expect(tutorAnswer).toHaveBeenCalledWith(answer);
    });

    test('applies only the newest lab when an older fetch answers last', async () => {
      const labs: ((lab: any) => void)[] = [];
      const fetchMock = vi.fn((url: string) =>
        url === '/edrys-dev/lab'
          ? new Promise((resolve) => labs.push((lab) => resolve({ ok: true, json: async () => lab })))
          : Promise.resolve({ ok: true })
      );
      vi.stubGlobal('fetch', fetchMock);
      const apply = vi.fn();
      const lab = (name: string) => ({ path: '/labs/lab.yml', text: JSON.stringify({ name, modules: [] }) });
      startDevBridge(apply);

      source.listeners['reload-lab']();
      source.listeners['reload-lab']();
      labs[1](lab('second save'));
      await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
      labs[0](lab('first save'));
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(apply).toHaveBeenCalledTimes(1);
      expect(apply.mock.calls[0][0].name).toBe('second save');
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

    // browsers drop keepalive bodies over 64 KiB without an error
    test('sends a reply over 60 kB without keepalive', async () => {
      const fetchMock = serveLab();
      // 50000 characters, 100000 bytes
      const rooms: Record<string, any> = { 'Room 1': { code: 'é'.repeat(50000) } };
      startDevBridge(vi.fn(), { readState: (room) => rooms[room] });
      const reply = (id: string) =>
        (fetchMock.mock.calls as any[]).find(([, init]) => init?.body?.includes(`"id":"${id}"`))?.[1];

      source.listeners['read-state']({ data: JSON.stringify({ id: 'big', room: 'Room 1', key: 'code' }) });
      source.listeners['read-state']({ data: JSON.stringify({ id: 'small', room: 'Room 1' }) });

      await vi.waitFor(() => expect(reply('big') && reply('small')).toBeTruthy());
      expect(reply('big').keepalive).toBe(false);
      expect(reply('small').keepalive).toBe(true);
    });
  });
});

describe('rescrapeModules and withFresh', () => {
  const TERM = ['http://localhost:3211/term/', 'http://127.0.0.1:3211/term/'];
  const CLOCK = ['http://localhost:3211/clock/', 'http://127.0.0.1:3211/clock/'];
  const lab = [
    { url: 'http://localhost:3211/term/index.html' },
    { url: 'https://example.com/editor.html' },
    { url: 'http://127.0.0.1:3211/clock/' },
  ];
  const loaded = lab.map((m) => ({ ...m, name: 'old' }));

  test('scrapes again only the modules under the urls, under either local address', async () => {
    const scrape = vi.fn(async (m: any) => ({ ...m, name: 'new' }));

    const term = await rescrapeModules(lab, TERM, scrape);
    expect([...term.keys()]).toEqual([0]);
    expect(term.get(0)).toEqual({ ...lab[0], name: 'new', devReload: expect.any(Number) });

    expect([...(await rescrapeModules(lab, CLOCK, scrape)).keys()]).toEqual([2]);
    expect((await rescrapeModules(lab, ['http://localhost:3211/gone/'], scrape)).size).toBe(0);
    expect(scrape).toHaveBeenCalledTimes(2);
  });

  test('withFresh swaps in the fresh modules, unless the list changed under them', () => {
    const fresh = new Map([[0, { ...lab[0], name: 'new' }]]);
    expect(withFresh(loaded, fresh).map((m) => m.name)).toEqual(['new', 'old', 'old']);

    const reordered = [loaded[1], loaded[0], loaded[2]];
    expect(withFresh(reordered, fresh)).toEqual(reordered);
  });

  // Classroom's reloadModule, as two saves in a row run it: the second must
  // not throw away the first's fresh module (it once did, with one event per
  // local address, the second matching nothing)
  test('reloads that overlap keep each other\'s modules', async () => {
    let list = loaded;
    const reload = async (urls: string[], scrape: (m: any) => Promise<any>) => {
      const fresh = await rescrapeModules(lab, urls, scrape);
      if (fresh.size) list = withFresh(list, fresh);
    };
    let finishTerm!: () => void;
    const slow = (m: any) => new Promise((resolve) => (finishTerm = () => resolve({ ...m, name: 'term v2' })));
    const fast = async (m: any) => ({ ...m, name: 'clock v2' });

    const term = reload(TERM, slow);
    await reload(CLOCK, fast);
    await reload(['http://localhost:3211/gone/'], fast);
    finishTerm();
    await term;

    expect(list.map((m) => m.name)).toEqual(['term v2', 'old', 'clock v2']);
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

  test('gives a chosen name beside the short ID', () => {
    const users = { 'student-key-s2': { displayName: 'stud', username: 'Ada', role: 'student', room: 'Lobby' } };
    const state = classState({ rooms: { Lobby: {} }, users }, 'owner-key-s1', {});

    expect(state.rooms.Lobby).toEqual([{ name: 'stud', username: 'Ada', role: 'student' }]);
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

  // the room updates of a busy class come about every 500 ms
  test('reports while the class keeps changing', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    for (let i = 0; i < 5; i++) {
      reportClass({ room: `Busy ${i}`, rooms: {}, modules: [] });
      await vi.advanceTimersByTimeAsync(400);
    }
    await vi.advanceTimersByTimeAsync(500);

    const rooms = (fetchMock.mock.calls as any[]).map(([, init]) => JSON.parse(init.body).room);
    expect(rooms).toEqual(['Busy 1', 'Busy 3', 'Busy 4']);
  });

  // edrys-dev keeps the class only in memory, and the tab would not report
  // an unchanged one
  test('sends the last state again when edrys-dev comes back', async () => {
    const fetchMock = serveLab();
    let source: any;
    vi.stubGlobal(
      'EventSource',
      vi.fn(function (this: any) {
        source = this;
        this.addEventListener = () => {};
      })
    );
    const classReports = () =>
      (fetchMock.mock.calls as any[])
        .filter(([url]) => url === '/edrys-dev/bridge')
        .map(([, init]) => JSON.parse(init.body))
        .filter((body) => body.type === 'class');

    reportClass({ room: 'Room 2', rooms: {}, modules: [] });
    await vi.advanceTimersByTimeAsync(500);
    startDevBridge(vi.fn());
    source.onopen();
    await vi.advanceTimersByTimeAsync(0);

    expect(classReports()).toEqual([
      { type: 'class', room: 'Room 2', rooms: {}, modules: [] },
      { type: 'class', room: 'Room 2', rooms: {}, modules: [] },
    ]);
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
