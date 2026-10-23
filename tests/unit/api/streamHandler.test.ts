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

function makeContext(overrides: any = {}) {
  return {
    class_id: 'class1',
    liveUser: { room: 'Room A' },
    username: 'alice',
    module: { stationConfig: {} },
    sendMessage: () => {},
    onMessage: () => () => {},
    ...overrides,
  };
}

const STREAM_REQUEST = '__edrys_stream_request';

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

describe('a viewer asking for a stream', () => {
  beforeEach(() => {
    instances = [];
    vi.useFakeTimers();
  });

  test('names its PeerJS id, and keeps asking until media arrives', () => {
    const sent: any[] = [];
    const context = makeContext({ sendMessage: (subject: string, body: any) => sent.push([subject, body]) });
    const client = new StreamClient(context, () => {}, {}, 'Camera 1');
    const peer = instances[0];
    peer.emit('open');
    expect(sent).toEqual([[STREAM_REQUEST, { streamName: 'Camera 1', peerId: 'auto-id' }]]);

    // Connected, but the station hasn't called back yet
    (peer as any).connect = () => fakeConnection('station');
    client.selectStream('Camera 1');
    vi.advanceTimersByTime(3000);
    expect(sent.length).toBe(2);

    const callHandlers: Record<string, Function> = {};
    peer.emit('call', { answer: () => {}, on: (e: string, cb: Function) => { callHandlers[e] = cb; } });
    callHandlers.stream({});
    vi.advanceTimersByTime(6000);
    expect(sent.length).toBe(2);

    client.stop();
    vi.useRealTimers();
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

  // Edrys messages between one station and its viewers, as the host delivers them.
  function room() {
    const listeners: Function[] = [];
    const context = (overrides: any = {}) =>
      makeContext({
        sendMessage: (subject: string, body: any) => listeners.forEach((l) => l({ subject, body })),
        onMessage: (h: Function) => { listeners.push(h); return () => listeners.splice(listeners.indexOf(h), 1); },
        ...overrides,
      });
    return { context };
  }

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

  test('a station registers under a random room, not one derived from the class', () => {
    const { context } = room();
    new WebSocketStreamServer(context(), camera, options);
    new WebSocketStreamServer(context(), camera, options);
    FakeSocket.all.forEach((s) => s.open());

    const rooms = FakeSocket.all.map((s) => s.sent.find((m) => m.type === 'register-source').roomId);
    for (const id of rooms) expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(rooms[0]).not.toBe(rooms[1]);
  });

  test('a viewer joins only the room the station names, also when it asks late', () => {
    const { context } = room();
    const station = new WebSocketStreamServer(context(), camera, options);
    FakeSocket.all[0].open(); // announced before any viewer listens
    const roomId = FakeSocket.all[0].sent.find((m) => m.type === 'register-source').roomId;

    const viewer = new WebSocketStreamClient(context(), () => {}, options);
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
    listeners.forEach((l) => l({ subject: WS_READY, body: { streamName: 'Camera 2', roomId: 'abc' } }));

    expect(FakeSocket.all[0].sent).toEqual([]);
    viewer.stop();
  });
});

// Regression guard for the peer-ID generator: PeerJS IDs must be
// alphanumeric/dash/underscore only, and are capped at 50 chars.
describe('generated stream peer IDs', () => {
  beforeEach(() => {
    instances = [];
  });

  test('StreamServer sanitizes and truncates the generated peer ID', () => {
    const context = makeContext({
      class_id: 'class/with spaces?',
      liveUser: { room: 'Room A!!' },
    });

    new StreamServer(context, {} as MediaStream, {}, 'my stream #1');

    const peer = instances[0];
    expect(peer.id).toMatch(/^stream_[a-zA-Z0-9_-]+$/);
    expect(peer.id.length).toBeLessThanOrEqual(50);
  });

  test('StreamClient generates the same sanitized peer ID format when connecting', () => {
    const context = makeContext({
      class_id: 'class/with spaces?',
      liveUser: { room: 'Room A!!' },
    });
    const client = new StreamClient(context, () => {}, {}, undefined);
    instances[0].emit('open');

    let connectedId = '';
    instances[0].connect = (peerId: string) => {
      connectedId = peerId;
      return null;
    };

    client.selectStream('my stream #1');

    expect(connectedId).toMatch(/^stream_[a-zA-Z0-9_-]+$/);
    expect(connectedId.length).toBeLessThanOrEqual(50);
    // server and client derive the same ID
    new StreamServer(context, {} as MediaStream, {}, 'my stream #1');
    expect(instances.at(-1)!.id).toBe(connectedId);
  });

  test('streams whose names differ only late get different IDs', () => {
    // with truncation to 50 chars these collided
    const context = makeContext({
      class_id: 'SfqYE9JhJnYpaB5p',
      liveUser: { room: 'Station wxkWGd with a long name' },
    });

    new StreamServer(context, {} as MediaStream, {}, 'Microscope left');
    new StreamServer(context, {} as MediaStream, {}, 'Microscope right');
    new StreamServer(makeContext({ liveUser: { room: 'Room B' } }), {} as MediaStream, {}, 'Microscope left');

    const ids = instances.map((p) => p.id);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^stream_[0-9a-f]{16}$/);
  });
});
