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

let fakeAwareness: FakeAwareness

vi.mock('genericprovider', () => ({
  GenericProvider: vi.fn().mockImplementation(() => ({
    awareness: fakeAwareness,
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  })),
}))

vi.mock('genericprovider/providers/websocket', () => ({
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

  // --- messaging (awareness, WS-specific) ---

  test('sendMessage stamps id/sender and writes the message into awareness', () => {
    const adapter = makeAdapter()
    const msg: any = { text: 'hi' }
    adapter.sendMessage(msg)

    expect(msg.id).toBeTruthy()
    expect(msg.sender).toBe('alice')
    expect(fakeAwareness.getLocalState().customMessage).toBe(msg)
    adapter.destroy()
  })

  test('a message from a verified peer is delivered once', async () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((m) => received.push(m))

    await seatVerified('bobkey', 'bob', 2)
    // A subsequent awareness update carrying the message.
    fakeAwareness.seat(
      2,
      { user: { id: 'bob', publicKey: 'bobkey', signature: 'sig' }, customMessage: { id: 'm1', text: 'hey' } },
      'updated'
    )
    await Promise.resolve()

    expect(received).toEqual([{ id: 'm1', text: 'hey' }])
    adapter.destroy()
  })

  test('the same message id is not delivered twice', async () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((m) => received.push(m))

    await seatVerified('bobkey', 'bob', 2)
    const state = {
      user: { id: 'bob', publicKey: 'bobkey', signature: 'sig' },
      customMessage: { id: 'm1', text: 'hey' },
    }
    fakeAwareness.seat(2, state, 'updated')
    fakeAwareness.seat(2, state, 'updated')
    await Promise.resolve()

    expect(received).toHaveLength(1)
    adapter.destroy()
  })

  test('a message from an UNverified peer is not delivered', async () => {
    const adapter = makeAdapter()
    const received: any[] = []
    adapter.onMessage((m) => received.push(m))

    // malkey is never whitelisted -> peer stays unverified.
    fakeAwareness.seat(
      3,
      { user: { id: 'mallory', publicKey: 'malkey', signature: 'sig' }, customMessage: { id: 'x', text: 'spoof' } },
      'added'
    )
    await Promise.resolve()

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
