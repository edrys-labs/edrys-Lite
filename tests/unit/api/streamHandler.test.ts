import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('./debugHandler', () => ({
  debug: { api: { general: vi.fn() } },
}));

class FakePeerInstance {
  id: string;
  options: any;
  open = false;
  handlers: Record<string, Function[]> = {};

  constructor(id: string, options?: any) {
    // PeerJS supports new Peer(options) with an auto id, or new Peer(id, options).
    if (typeof id === 'object') {
      this.options = id;
      this.id = 'auto-id';
    } else {
      this.id = id;
      this.options = options;
    }
    instances.push(this);
  }

  on(event: string, cb: Function) {
    this.handlers[event] = this.handlers[event] || [];
    this.handlers[event].push(cb);
  }

  once(event: string, cb: Function) {
    this.on(event, cb);
  }

  emit(event: string, ...args: any[]) {
    if (event === 'open') this.open = true;
    (this.handlers[event] || []).forEach((cb) => cb(...args));
  }

  connect(_peerId: string) {
    return null;
  }

  destroy() {}
}

let instances: FakePeerInstance[] = [];

vi.mock('peerjs', () => ({
  Peer: vi.fn().mockImplementation((...args: any[]) => new (FakePeerInstance as any)(...args)),
}));

import {
  StreamServer,
  StreamClient,
  WebSocketStreamServer,
  WebSocketStreamClient,
} from '../../../src/api/streamHandler';

// Roles as edrys builds them from the signed presence and setup.
const USERS = {
  station: { role: 'station' },
  teacher: { role: 'teacher' },
  student: { role: 'student' },
};

function makeContext(overrides: any = {}) {
  return {
    liveUser: { room: 'Room A' },
    liveClass: { users: USERS },
    username: 'alice',
    module: { stationConfig: {} },
    sendMessage: () => {},
    onMessage: () => () => {},
    ...overrides,
  };
}

const STREAM_REQUEST = '__edrys_stream_request';
const STREAM_READY = '__edrys_stream_ready';

// A DataConnection from `peer` that the test can close.
function fakeConnection(peer: string) {
  const handlers: Record<string, Function> = {};
  return { peer, on: (event: string, cb: Function) => { handlers[event] = cb; }, close: () => handlers.close?.() };
}

describe('who a station streams to', () => {
  let onMessage: Function;
  let called: string[];

  beforeEach(() => {
    instances = [];
    called = [];
    const context = makeContext({ onMessage: (h: Function) => { onMessage = h; return () => {}; } });
    new StreamServer(context, {} as MediaStream, {}, 'Camera 1');
    (instances[0] as any).call = (peerId: string) => {
      called.push(peerId);
      return { on: () => {}, close: () => {} };
    };
  });

  const request = (peerId: string, streamName = 'Camera 1') =>
    onMessage({ subject: STREAM_REQUEST, body: { streamName, peerId } });

  test('not to a peer that connects without asking through edrys', () => {
    instances[0].emit('connection', fakeConnection('outsider'));
    expect(called).toEqual([]);
  });

  test('to a peer that asked for this stream, before or after connecting', () => {
    request('early');
    instances[0].emit('connection', fakeConnection('early'));

    instances[0].emit('connection', fakeConnection('late'));
    request('late');

    expect(called).toEqual(['early', 'late']);
  });

  test('not to a peer that asked for another stream', () => {
    request('viewer', 'Camera 2');
    instances[0].emit('connection', fakeConnection('viewer'));
    expect(called).toEqual([]);
  });

  test('a closed connection has to ask again', () => {
    request('viewer');
    const conn = fakeConnection('viewer');
    instances[0].emit('connection', conn);
    conn.close();
    instances[0].emit('connection', fakeConnection('viewer'));

    expect(called).toEqual(['viewer']);
  });
});

// A media call from `peer`: whether it was answered or closed, and its handlers.
function fakeCall(peer: string) {
  const call = {
    peer,
    answered: false,
    closed: false,
    handlers: {} as Record<string, Function>,
    answer() { call.answered = true; },
    close() { call.closed = true; },
    on(e: string, cb: Function) { call.handlers[e] = cb; },
  };
  return call;
}

describe('a viewer asking for a stream', () => {
  let onMessage: Function;
  let sent: any[];
  let connected: string[];
  let streams: any[];
  let client: StreamClient;

  beforeEach(() => {
    instances = [];
    sent = [];
    connected = [];
    streams = [];
    vi.useFakeTimers();
    const context = makeContext({
      sendMessage: (subject: string, body: any) => sent.push([subject, body]),
      onMessage: (h: Function) => { onMessage = h; return () => {}; },
    });
    client = new StreamClient(context, (s) => streams.push(s), {}, 'Camera 1');
    (instances[0] as any).connect = (id: string) => { connected.push(id); return fakeConnection(id); };
    instances[0].emit('open');
  });

  afterEach(() => {
    client.stop();
    vi.useRealTimers();
  });

  const ready = (from: string, peerId: string, streamName = 'Camera 1') =>
    onMessage({ from, subject: STREAM_READY, body: { streamName, peerId } });

  test('names its PeerJS id, and keeps asking until media arrives', () => {
    expect(sent).toEqual([[STREAM_REQUEST, { streamName: 'Camera 1', peerId: 'auto-id' }]]);

    // Connected, but the station hasn't called back yet
    ready('station', 'stream_abc');
    vi.advanceTimersByTime(3000);
    expect(sent.length).toBe(2);

    const call = fakeCall('stream_abc');
    instances[0].emit('call', call);
    call.handlers.stream({});
    vi.advanceTimersByTime(6000);
    expect(sent.length).toBe(2);
  });

  test('connects to the id a station or teacher announces', () => {
    ready('station', 'stream_station');
    ready('teacher', 'stream_teacher');
    expect(connected).toEqual(['stream_station', 'stream_teacher']);
  });

  test('ignores an announcement from a student, an unknown sender, or without an id', () => {
    ready('student', 'stream_student');
    ready('nobody', 'stream_nobody');
    onMessage({ from: 'station', subject: STREAM_READY, body: { streamName: 'Camera 1' } });
    ready('station', 'stream_other', 'Camera 2');
    expect(connected).toEqual([]);
  });

  test('answers only calls from the station it connected to', () => {
    const before = fakeCall('stream_abc');
    instances[0].emit('call', before);
    expect(before.closed).toBe(true);

    ready('station', 'stream_abc');
    const rogue = fakeCall('someone-else');
    instances[0].emit('call', rogue);
    expect(rogue.answered).toBe(false);
    expect(rogue.closed).toBe(true);

    const station = fakeCall('stream_abc');
    instances[0].emit('call', station);
    expect(station.answered).toBe(true);
    station.handlers.stream('media');
    expect(streams).toEqual(['media']);
  });

  test('follows a restarted station to its new id', () => {
    ready('station', 'stream_old');
    ready('station', 'stream_old');
    ready('station', 'stream_new');
    expect(connected).toEqual(['stream_old', 'stream_new']);

    const old = fakeCall('stream_old');
    instances[0].emit('call', old);
    expect(old.answered).toBe(false);
  });
});

describe('websocket streams: the relay room is handed out through edrys', () => {
  const WS_READY = '__edrys_ws_stream_ready';
  const WS_REQUEST = '__edrys_ws_stream_request';

  // Relay sockets: what each one sent, and a way to open it.
  class FakeSocket {
    static OPEN = 1;
    static all: FakeSocket[] = [];
    readyState = 0;
    sent: any[] = [];
    onopen: any; onmessage: any; onerror: any; onclose: any;
    constructor(public url: string) { FakeSocket.all.push(this); }
    send(data: any) { this.sent.push(JSON.parse(data)); }
    close() {}
    open() { this.readyState = 1; this.onopen?.(); }
  }

  class FakeMediaSource { addEventListener() {} static isTypeSupported() { return true; } }

  // Edrys messages in one room, as the host delivers them; `from` names the
  // sender (a key of USERS).
  function room() {
    const listeners: Function[] = [];
    const context = (from = 'station') =>
      makeContext({
        sendMessage: (subject: string, body: any) => listeners.forEach((l) => l({ from, subject, body })),
        onMessage: (h: Function) => { listeners.push(h); return () => listeners.splice(listeners.indexOf(h), 1); },
      });
    return { context };
  }

  // A station connects once its room id is hashed from its key (async).
  const sockets = (n: number) => vi.waitFor(() => expect(FakeSocket.all.length).toBe(n));
  const registration = (s: FakeSocket) => s.sent.find((m) => m.type === 'register-source');

  const camera = { getVideoTracks: () => [{}], getAudioTracks: () => [] } as unknown as MediaStream;

  beforeEach(() => {
    FakeSocket.all = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('MediaSource', FakeMediaSource);
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const options = { websocketUrl: 'wss://relay.example/stream', streamName: 'Camera 1' };

  test('a station registers with a random key, under the room id that is its SHA-256', async () => {
    const { context } = room();
    new WebSocketStreamServer(context(), camera, options);
    new WebSocketStreamServer(context(), camera, options);
    await sockets(2);
    FakeSocket.all.forEach((s) => s.open());

    const regs = FakeSocket.all.map(registration);
    for (const { roomId, sourceKey } of regs) {
      expect(sourceKey).toMatch(/^[0-9a-f]{64}$/);
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sourceKey));
      expect(roomId).toBe(Buffer.from(digest).toString('hex'));
    }
    expect(regs[0].roomId).not.toBe(regs[1].roomId);
  });

  test('a station hands out the room id, never its key', async () => {
    const sent: any[] = [];
    new WebSocketStreamServer(makeContext({ sendMessage: (s: string, b: any) => sent.push([s, b]) }), camera, options);
    await sockets(1);
    FakeSocket.all[0].open();
    const { roomId } = registration(FakeSocket.all[0]);
    expect(sent).toEqual([[WS_READY, { streamName: 'Camera 1', roomId }]]);
  });

  test('a station without crypto.subtle (plain http) warns in the console and never connects', async () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: (a: Uint8Array<ArrayBuffer>) => real.getRandomValues(a) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new WebSocketStreamServer(makeContext(), camera, options);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('https or from localhost'), expect.anything()));
    expect(FakeSocket.all).toEqual([]);
    warn.mockRestore();
  });

  test('a station stopped before its room id is ready never connects', async () => {
    const station = new WebSocketStreamServer(makeContext(), camera, options);
    station.stop();
    await new Promise((r) => setTimeout(r, 100));
    expect(FakeSocket.all).toEqual([]);
  });

  test('a viewer joins only the room the station names, also when it asks late', async () => {
    const { context } = room();
    const station = new WebSocketStreamServer(context(), camera, options);
    await sockets(1);
    FakeSocket.all[0].open(); // announced before any viewer listens
    const roomId = registration(FakeSocket.all[0]).roomId;

    const viewer = new WebSocketStreamClient(context('student'), () => {}, options);
    const socket = FakeSocket.all[1];
    socket.open();

    expect(socket.sent).toEqual([{ type: 'join-room', roomId }]);
    viewer.stop();
    station.stop();
  });

  test('a viewer joins nothing until a station names a room', () => {
    vi.useFakeTimers();
    const sent: any[] = [];
    const viewer = new WebSocketStreamClient(
      makeContext({ sendMessage: (s: string, b: any) => sent.push([s, b]), onMessage: () => () => {} }),
      () => {},
      options
    );
    FakeSocket.all[0].open();
    vi.advanceTimersByTime(3000);

    expect(FakeSocket.all[0].sent).toEqual([]);
    expect(sent).toEqual([
      [WS_REQUEST, { streamName: 'Camera 1' }],
      [WS_REQUEST, { streamName: 'Camera 1' }],
    ]);
    viewer.stop();
    vi.useRealTimers();
  });

  test('a viewer ignores rooms named for another stream', () => {
    const listeners: Function[] = [];
    const viewer = new WebSocketStreamClient(
      makeContext({ onMessage: (h: Function) => { listeners.push(h); return () => {}; } }),
      () => {},
      options
    );
    FakeSocket.all[0].open();
    listeners.forEach((l) => l({ from: 'station', subject: WS_READY, body: { streamName: 'Camera 2', roomId: 'abc' } }));

    expect(FakeSocket.all[0].sent).toEqual([]);
    viewer.stop();
  });

  test('a viewer takes a room only from a station or teacher', () => {
    const listeners: Function[] = [];
    const viewer = new WebSocketStreamClient(
      makeContext({ onMessage: (h: Function) => { listeners.push(h); return () => {}; } }),
      () => {},
      options
    );
    FakeSocket.all[0].open();
    const ready = (from: string, roomId: string) =>
      listeners.forEach((l) => l({ from, subject: WS_READY, body: { streamName: 'Camera 1', roomId } }));

    ready('student', 'from-student');
    ready('nobody', 'from-nobody');
    expect(FakeSocket.all[0].sent).toEqual([]);

    ready('station', 'from-station');
    ready('student', 'from-student');
    ready('teacher', 'from-teacher');
    expect(FakeSocket.all[0].sent).toEqual([
      { type: 'join-room', roomId: 'from-station' },
      { type: 'join-room', roomId: 'from-teacher' },
    ]);
    viewer.stop();
  });
});

describe('a station\'s PeerJS id', () => {
  beforeEach(() => {
    instances = [];
  });

  test('is random, a valid PeerJS id, and not derived from class, room or stream', () => {
    new StreamServer(makeContext(), {} as MediaStream, {}, 'Camera 1');
    new StreamServer(makeContext(), {} as MediaStream, {}, 'Camera 1');

    const ids = instances.map((p) => p.id);
    expect(ids[0]).not.toBe(ids[1]);
    for (const id of ids) {
      // PeerJS ids: alphanumeric/dash/underscore, at most 50 chars
      expect(id).toMatch(/^stream_[0-9a-f]{32}$/);
      expect(id.length).toBeLessThanOrEqual(50);
    }
  });

  test('is announced once registered, also to a viewer that asks', () => {
    const sent: any[] = [];
    let onMessage: Function = () => {};
    new StreamServer(
      makeContext({
        sendMessage: (s: string, b: any) => sent.push([s, b]),
        onMessage: (h: Function) => { onMessage = h; return () => {}; },
      }),
      {} as MediaStream,
      {},
      'Camera 1'
    );
    const peer = instances[0];
    onMessage({ subject: STREAM_REQUEST, body: { streamName: 'Camera 1', peerId: 'viewer' } });
    expect(sent).toEqual([]);

    peer.emit('open');
    onMessage({ subject: STREAM_REQUEST, body: { streamName: 'Camera 1', peerId: 'viewer' } });
    const announced = [STREAM_READY, { streamName: 'Camera 1', peerId: peer.id }];
    expect(sent).toEqual([announced, announced]);
  });
});
