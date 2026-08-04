import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'

// Fake awareness: local state store + update-listener fan-out, and a states map
// the adapter reads to inspect remote peers.
class FakeAwareness {
  private local: any = {}
  states = new Map<number, any>()
  handlers: Array<(e: any) => void> = []

  getLocalState() {
    return this.local
  }
  setLocalState(s: any) {
    this.local = s
  }
  getStates() {
    return this.states
  }
  on(_ev: string, cb: (e: any) => void) {
    this.handlers.push(cb)
  }
  off(_ev: string, cb: (e: any) => void) {
    this.handlers = this.handlers.filter((h) => h !== cb)
  }
  // Test helper: seat a remote client and fire the update.
  seat(clientId: number, state: any, kind: 'added' | 'updated' = 'added') {
    this.states.set(clientId, state)
    const evt = { added: [] as number[], updated: [] as number[], removed: [] as number[] }
    evt[kind].push(clientId)
    this.handlers.forEach((h) => h(evt))
  }
}

// Fake pubsub: captures publish/publishTo and lets the test simulate an
// incoming message through the same subscribe() callback the adapter wires up.
// Custom messages ride pubsub (not awareness).
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

let fakeAwareness: FakeAwareness
let fakePubSub: FakePubSub

vi.mock('@edryslabs/genericprovider', () => ({
  GenericProvider: vi.fn().mockImplementation(() => ({
    awareness: fakeAwareness,
    appAwareness: fakeAwareness,
    pubsub: fakePubSub,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  })),
}))

vi.mock('@edryslabs/genericprovider/providers/websocket', () => ({
  WebSocketTransport: vi.fn().mockImplementation(() => ({})),
}))

// Deterministic crypto: sign returns a fixed token; verify passes only for a
// pubkey the test whitelists.
const verifiablePubkeys = new Set<string>()
vi.mock('./../../../src/ts/Utils', () => ({
  signChallenge: vi.fn().mockResolvedValue('sig'),
  verifyChallenge: vi.fn((_room: string, publicKey: string) =>
    Promise.resolve(verifiablePubkeys.has(publicKey))
  ),
  getPeerID: vi.fn(() => 'mypubkey'),
  REVERT_INVALID_ORIGIN: 'revert-invalid',
}))

import { GenericWebsocketProviderAdapter } from '../../../src/ts/GenericWebsocketProviderAdapter'

describe('GenericWebsocketProviderAdapter (E2)', () => {
  beforeEach(() => {
    vi.useRealTimers()
    fakeAwareness = new FakeAwareness()
    fakePubSub = new FakePubSub()
    verifiablePubkeys.clear()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function makeAdapter() {
    // options.userid becomes the identity written into awareness.
    return new GenericWebsocketProviderAdapter('room1', {} as any, { userid: 'alice' })
  }

  // Seat a verified remote peer and return its clientId.
  async function seatVerified(pubkey: string, userid: string, clientId: number) {
    verifiablePubkeys.add(pubkey)
    fakeAwareness.seat(clientId, { user: { id: userid, publicKey: pubkey, signature: 'sig' } })
    await Promise.resolve()
  }

  // --- messaging (pubsub; identity/liveness still ride awareness) ---

  test('sendMessage stamps id/sender and publishes on the pubsub topic', () => {
    const adapter = makeAdapter()
    const msg: any = { text: 'hi' }
    adapter.sendMessage(msg)

    expect(msg.id).toBeTruthy()
    expect(msg.sender).toBe('alice')
    expect(fakePubSub.publishCalls).toHaveLength(1)
    expect(fakePubSub.publishCalls[0].message).toBe(msg)
    adapter.destroy()
  })

  test('sendMessage with a target uses publishTo', () => {
    const adapter = makeAdapter()
    adapter.sendMessage({ text: 'psst' }, 'bob')

    expect(fakePubSub.publishCalls).toHaveLength(0)
    expect(fakePubSub.publishToCalls).toHaveLength(1)
    expect(fakePubSub.publishToCalls[0].target).toBe('bob')
    adapter.destroy()
  })

  test('a message from a verified peer is delivered once', async () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((m) => received.push(m))

    // Verification still rides awareness; only the message itself is pubsub.
    await seatVerified('bobkey', 'bob', 2)
    fakePubSub.emit('edrys', { id: 'm1', sender: 'bob', text: 'hey' })

    expect(received).toEqual([{ id: 'm1', sender: 'bob', text: 'hey' }])
    adapter.destroy()
  })

  test('the same message id is not delivered twice', async () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((m) => received.push(m))

    await seatVerified('bobkey', 'bob', 2)
    const msg = { id: 'm1', sender: 'bob', text: 'hey' }
    fakePubSub.emit('edrys', msg)
    fakePubSub.emit('edrys', msg)

    expect(received).toHaveLength(1)
    adapter.destroy()
  })

  test('a message from an UNverified peer is not delivered', async () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((m) => received.push(m))

    // mallory is never verified via awareness -> her pubsub message is dropped.
    fakePubSub.emit('edrys', { id: 'x', sender: 'mallory', text: 'spoof' })

    expect(received).toHaveLength(0)
    adapter.destroy()
  })

  // --- identity gate (awareness) ---

  test('a peer with a valid signed challenge becomes verified', async () => {
    const adapter = makeAdapter()
    await seatVerified('bobkey', 'bob', 2)
    expect((adapter as any)._verifiedUsers.has('bob')).toBe(true)
    adapter.destroy()
  })

  test('a peer whose signature fails verification is not trusted', async () => {
    const adapter = makeAdapter()
    fakeAwareness.seat(3, { user: { id: 'mallory', publicKey: 'malkey', signature: 'sig' } })
    await Promise.resolve()
    expect((adapter as any)._verifiedUsers.has('mallory')).toBe(false)
    adapter.destroy()
  })

  test('heartbeat writes our signed identity into awareness', async () => {
    const adapter = makeAdapter()
    await (adapter as any)._sendHeartbeat()
    await Promise.resolve()

    const local = fakeAwareness.getLocalState()
    expect(local.user.id).toBe('alice')
    expect(local.user.publicKey).toBe('mypubkey')
    expect(local.user.signature).toBe('sig')
    expect(local.user.heartbeat).toBeTruthy()
    adapter.destroy()
  })

  test('a peer whose heartbeat goes stale fires onLeave and drops verification', async () => {
    const adapter = makeAdapter()
    const left: string[] = []
    adapter.onLeave((id) => left.push(id))

    await seatVerified('bobkey', 'bob', 2)
    expect((adapter as any)._verifiedUsers.has('bob')).toBe(true)

    ;(adapter as any)._lastHeartbeats.set('bob', Date.now() - 60000)
    ;(adapter as any)._checkHeartbeats()

    expect(left).toEqual(['bob'])
    expect((adapter as any)._verifiedUsers.has('bob')).toBe(false)
    adapter.destroy()
  })

  test('our own awareness state never marks us as a remote peer', async () => {
    const adapter = makeAdapter()
    fakeAwareness.seat(1, { user: { id: 'alice', publicKey: 'mypubkey', signature: 'sig' } })
    await Promise.resolve()

    expect((adapter as any)._lastHeartbeats.has('alice')).toBe(false)
    adapter.destroy()
  })
})
