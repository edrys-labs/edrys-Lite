import { describe, test, expect, vi, beforeEach } from 'vitest'

// Fake pubsub: captures publish/publishTo calls and lets the test simulate
// an incoming message via the same subscribe() callback the adapter wires up.
class FakePubSub {
  handlers: Array<(msg: any, topic: string) => void> = []
  publishCalls: Array<{ topic: string; message: any }> = []
  publishToCalls: Array<{ target: string; topic: string; message: any }> = []

  publish(topic: string, message: any) {
    this.publishCalls.push({ topic, message })
  }
  publishTo(target: string, topic: string, message: any) {
    this.publishToCalls.push({ target, topic, message })
  }
  subscribe(topic: string, cb: (msg: any, topic: string) => void) {
    this.handlers.push(cb)
    return () => {
      this.handlers = this.handlers.filter((h) => h !== cb)
    }
  }
  emit(topic: string, msg: any) {
    this.handlers.forEach((h) => h(msg, topic))
  }
}

let fakePubSub: FakePubSub

vi.mock('@edryslabs/genericprovider', () => {
  return {
    GenericProvider: vi.fn().mockImplementation(() => {
      return {
        pubsub: fakePubSub,
        on: vi.fn(),
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn(),
        destroy: vi.fn(),
      }
    }),
  }
})

vi.mock('./../../../src/ts/EdrysSimplePeerTransport', () => {
  return {
    EdrysSimplePeerTransport: vi.fn().mockImplementation(() => {
      return { onLeave: vi.fn() }
    }),
  }
})

vi.mock('simple-peer/simplepeer.min.js', () => ({ default: {} }))

import { GenericWebrtcProviderAdapter } from '../../../src/ts/GenericProviderAdapter'

describe('GenericWebrtcProviderAdapter messaging (E3)', () => {
  beforeEach(() => {
    vi.useRealTimers()
    fakePubSub = new FakePubSub()
  })

  function makeAdapter() {
    return new GenericWebrtcProviderAdapter('room1', {} as any, { userid: 'alice' })
  }

  test('sendMessage stamps id and sender, broadcasts when no target', () => {
    const adapter = makeAdapter()
    const msg: any = { text: 'hi' }
    adapter.sendMessage(msg)

    expect(msg.id).toBeTruthy()
    expect(msg.sender).toBe('alice')
    expect(fakePubSub.publishCalls).toHaveLength(1)
    expect(fakePubSub.publishCalls[0].message).toBe(msg)
    expect(fakePubSub.publishToCalls).toHaveLength(0)
  })

  test('sendMessage with target uses publishTo', () => {
    const adapter = makeAdapter()
    adapter.sendMessage({ text: 'hi' }, 'bob')

    expect(fakePubSub.publishToCalls).toHaveLength(1)
    expect(fakePubSub.publishToCalls[0].target).toBe('bob')
    expect(fakePubSub.publishCalls).toHaveLength(0)
  })

  test('onMessage delivers a fresh incoming message once', () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((msg) => received.push(msg))

    fakePubSub.emit('edrys', { id: 'm1', sender: 'bob', text: 'hey' })
    expect(received).toHaveLength(1)
  })

  test('onMessage drops a duplicate id delivered twice', () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((msg) => received.push(msg))

    const msg = { id: 'm1', sender: 'bob', text: 'hey' }
    fakePubSub.emit('edrys', msg)
    fakePubSub.emit('edrys', msg)
    expect(received).toHaveLength(1)
  })

  test('onMessage does not re-deliver our own sent message id if echoed back', () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((msg) => received.push(msg))

    const msg: any = { text: 'hi' }
    adapter.sendMessage(msg)
    // Simulate an echo of our own message coming back through pubsub.
    fakePubSub.emit('edrys', msg)

    expect(received).toHaveLength(0)
  })
})
