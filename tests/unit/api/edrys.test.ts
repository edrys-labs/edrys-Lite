import { describe, test, expect, vi, beforeEach } from 'vitest';
import * as Y from 'yjs';

// edrys.ts registers its 'message' listener and side effects at import time,
// and keeps its state in module-scope closures (not exported) — so it can
// only be driven end-to-end, the same way the real parent frame drives it:
// via window.postMessage, asserting on window['Edrys'] and outbound postMessage calls.

vi.mock('../../../src/api/streamHandler', () => ({
  StreamServer: vi.fn(),
  StreamClient: vi.fn(),
  WebSocketStreamServer: vi.fn(),
  WebSocketStreamClient: vi.fn(),
}));

vi.mock('../../../src/api/debugHandler', () => ({
  debug: { api: { general: vi.fn() } },
  enableDebug: vi.fn(),
  disableDebug: vi.fn(),
  disableSpecificDebug: vi.fn(),
}));

const ORIGIN = 'http://parent.example';

function buildLiveClassUpdate(build: (doc: Y.Doc) => void): Uint8Array {
  const doc = new Y.Doc();
  build(doc);
  return Y.encodeStateAsUpdate(doc);
}

function sendFromParent(data: any, origin = ORIGIN) {
  window.dispatchEvent(new MessageEvent('message', { data, origin }));
}

function sendInitialUpdate(overrides: any = {}) {
  const liveClass = buildLiveClassUpdate((doc) => {
    const users = doc.getMap('users');
    users.set('alice', { room: 'Room A' });
    const rooms = doc.getMap('rooms');
    rooms.set('Room A', new Y.Map());
  });

  sendFromParent({
    event: 'update',
    role: 'student',
    username: 'alice',
    module: {
      url: 'https://module.example/index.html',
      name: 'Test Module',
      config: '{}',
      studentConfig: '{}',
      teacherConfig: '{}',
      stationConfig: '{}',
    },
    class_id: 'class-1',
    liveClass,
    ...overrides,
  });
}

describe('edrys.ts (module API bridge)', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete (window as any).Edrys;
    delete (window as any).Y;
    await import('../../../src/api/edrys');
  });

  test('locks trusted origin to the first message received', () => {
    sendFromParent({ event: 'echo' }, ORIGIN);
    sendInitialUpdate();

    expect(window['Edrys'].origin).toBe(ORIGIN);
    expect(window['Edrys'].username).toBe('alice');
  });

  test('rejects messages from an origin other than the first-trusted one', () => {
    sendFromParent({ event: 'echo' }, ORIGIN);
    sendInitialUpdate();

    sendFromParent(
      {
        event: 'update',
        role: 'student',
        username: 'mallory',
        module: { url: 'x', config: '{}', studentConfig: '{}', teacherConfig: '{}', stationConfig: '{}' },
        class_id: 'class-1',
      },
      'http://evil.example'
    );

    expect(window['Edrys'].username).toBe('alice');
  });

  test('applies the initial liveClass Yjs update and populates liveUser/liveRoom', async () => {
    sendInitialUpdate();

    // update() runs synchronously inside doc.on('update'); onReady/onUpdate
    // dispatch is scheduled behind a 1s timeout, but liveClass/liveUser are set immediately.
    expect(window['Edrys'].liveUser).toEqual({ room: 'Room A', name: 'alice' });
    expect(window['Edrys'].liveRoom).toEqual({});
  });

  test('sendMessage encodes the body and posts to the trusted parent origin', () => {
    sendInitialUpdate();
    const postSpy = vi.spyOn(window.parent, 'postMessage');

    window['Edrys'].sendMessage('greet', { hello: 'world' });

    expect(postSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'message',
        subject: 'greet',
        module: 'https://module.example/index.html',
      }),
      ORIGIN
    );
  });

  test('onMessage decodes and delivers messages scoped to this module URL', () => {
    sendInitialUpdate();
    const handler = vi.fn();
    const unsub = window['Edrys'].onMessage(handler);

    const encoded = (() => {
      // Round-trip through the real sendMessage encoder by capturing the post call.
      const spy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});
      window['Edrys'].sendMessage('subj', { x: 1 });
      const [msg] = spy.mock.calls[0];
      spy.mockRestore();
      return msg.body;
    })();

    dispatchEvent(
      new CustomEvent('$Edrys.message', {
        detail: {
          module: 'https://module.example/index.html',
          subject: 'subj',
          body: encoded,
        },
      })
    );

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].body).toEqual({ x: 1 });
    unsub();
  });

  test('getState throws a clear error for Awareness before the module is ready', () => {
    sendFromParent({ event: 'echo' }, ORIGIN); // sets origin, but doc not yet created
    expect(() => window['Edrys'].getState('cursors', 'Awareness')).toThrow(
      /from within onReady/
    );
  });

  test('inbound "state" event applies a remote Yjs update without echoing it back out', () => {
    sendInitialUpdate();
    const postSpy = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => {});

    const remoteDoc = new Y.Doc();
    remoteDoc.getMap('rooms').set('Room B', { extra: true });
    const remoteUpdate = Array.from(Y.encodeStateAsUpdate(remoteDoc));

    sendFromParent({ event: 'state', data: remoteUpdate });

    // No outbound 'state' postMessage for an EXTERN-applied update.
    expect(
      postSpy.mock.calls.some(([msg]: any) => msg.event === 'state')
    ).toBe(false);
  });
});
