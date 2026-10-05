import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { SimplePeerTransport } from '@edryslabs/genericprovider/providers/simple-peer'
import { WebSocketTransport } from '@edryslabs/genericprovider/providers/websocket'

// Half-open socket model: stays OPEN, delivers nothing, and close() never
// fires onclose (the dead-TCP case browsers can take many minutes to notice).
class FakeWS {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 3
  static instances: FakeWS[] = []
  readyState = FakeWS.CONNECTING
  binaryType = ''
  sent: any[] = []
  onopen: ((e?: any) => void) | null = null
  onmessage: ((e: any) => void) | null = null
  onerror: ((e: any) => void) | null = null
  onclose: ((e: any) => void) | null = null
  constructor(public url: string) {
    FakeWS.instances.push(this)
  }
  open() {
    this.readyState = FakeWS.OPEN
    this.onopen?.()
  }
  receive(data: any) {
    this.onmessage?.({ data })
  }
  send(data: any) {
    this.sent.push(typeof data === 'string' ? JSON.parse(data) : data)
  }
  close() {
    this.readyState = FakeWS.CLOSED
  }
  // Server unreachable: the browser reports the failed connect.
  fail() {
    this.readyState = FakeWS.CLOSED
    this.onerror?.({})
    this.onclose?.({ code: 1006 })
  }
}

const latest = () => FakeWS.instances[FakeWS.instances.length - 1]

beforeEach(() => {
  FakeWS.instances = []
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', FakeWS)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SimplePeerTransport signaling liveness', () => {
  async function connected() {
    const t = new SimplePeerTransport({ peer: class {} as any, signaling: ['wss://sig'] })
    const p = t.connect({ room: 'room' })
    latest().open()
    await p
    return t
  }

  test('pings a quiet socket, then reconnects it after 30s of silence', async () => {
    const t = await connected()
    const dead = latest()

    await vi.advanceTimersByTimeAsync(18000)
    expect(dead.sent.some((m) => m.type === 'ping')).toBe(true)
    expect(FakeWS.instances).toHaveLength(1)

    // Dropped at the first check past 30s, reconnected after ~360ms backoff.
    await vi.advanceTimersByTimeAsync(16000)
    expect(FakeWS.instances).toHaveLength(2)
    expect(t.signalingHealth.open).toBe(0)

    // Replacement opens and re-subscribes to the room.
    latest().open()
    expect(latest().sent.some((m) => m.type === 'subscribe')).toBe(true)
    expect(t.signalingHealth.open).toBe(1)
    t.disconnect()
  })

  test('a socket that keeps receiving messages is never dropped', async () => {
    const t = await connected()
    const ws = latest()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(5000)
      // A healthy server echoes our own re-announce back.
      ws.receive(JSON.stringify({ type: 'publish', topic: 'room', from: (t as any).peerId }))
    }
    expect(FakeWS.instances).toHaveLength(1)
    expect(t.signalingHealth.open).toBe(1)
    t.disconnect()
  })

  test('retries when the first signaling connect fails', async () => {
    const t = new SimplePeerTransport({ peer: class {} as any, signaling: ['wss://sig'] })
    const p = t.connect({ room: 'room' })
    latest().fail()
    await p

    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWS.instances).toHaveLength(2)
    latest().open()
    expect(t.signalingHealth.open).toBe(1)
    expect(latest().sent.some((m) => m.type === 'subscribe')).toBe(true)
    t.disconnect()
  })

  test('retries when the first signaling connect hangs', async () => {
    const t = new SimplePeerTransport({ peer: class {} as any, signaling: ['wss://sig'] })
    const p = t.connect({ room: 'room' })
    const hung = latest()
    await vi.advanceTimersByTimeAsync(10000) // connect timeout
    await p

    await vi.advanceTimersByTimeAsync(2000)
    expect(FakeWS.instances).toHaveLength(2)
    latest().open()
    // The abandoned socket opening late must not become a second connection.
    hung.open()
    expect(t.signalingHealth.open).toBe(1)
    t.disconnect()
  })

  test('disconnect() stops the check', async () => {
    const t = await connected()
    t.disconnect()
    await vi.advanceTimersByTimeAsync(120000)
    expect(FakeWS.instances).toHaveLength(1)
  })
})

describe('WebSocketTransport liveness', () => {
  async function connected(extra: Record<string, any> = {}) {
    const t = new WebSocketTransport()
    const p = t.connect({ room: 'room', serverUrl: 'wss://relay', ...extra } as any)
    latest().open()
    await p
    return t
  }

  test('reconnects after 30s without a message', async () => {
    const t = await connected()
    await vi.advanceTimersByTimeAsync(29000)
    expect(t.isConnected).toBe(true)

    await vi.advanceTimersByTimeAsync(4000)
    expect(t.isConnected).toBe(false)

    await vi.advanceTimersByTimeAsync(2000) // default reconnectDelay
    expect(FakeWS.instances).toHaveLength(2)
    expect(latest().url).toBe('wss://relay/room')
    latest().open()
    expect(t.isConnected).toBe(true)
    t.disconnect()
  })

  test('steady traffic keeps the socket', async () => {
    const t = await connected()
    const ws = latest()
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(5000)
      ws.receive(new Uint8Array([0, 1, 0]).buffer)
    }
    expect(FakeWS.instances).toHaveLength(1)
    expect(t.isConnected).toBe(true)
    t.disconnect()
  })

})
