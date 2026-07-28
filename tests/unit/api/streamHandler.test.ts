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
  });
});
