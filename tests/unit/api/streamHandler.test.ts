import { describe, test, expect, beforeEach, vi } from 'vitest';

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

import { StreamServer, StreamClient } from '../../../src/api/streamHandler';

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
