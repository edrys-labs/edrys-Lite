import { describe, test, expect, vi, beforeEach } from 'vitest'
import { encoding } from 'lib0'
import { EdrysSimplePeerTransport } from '../../../src/ts/EdrysSimplePeerTransport'

// verifyChallenge is driven per-test; sign/getPeerID are stubbed but the
// receiver-side gate (the security-critical half) is exercised by injecting
// control frames directly, so it does not depend on announce-time identity.
let verifyImpl: (c: string, pk: string, sig: string) => Promise<boolean> = () =>
  Promise.resolve(true)

vi.mock('../../../src/ts/Utils', async () => {
  const actual = await vi.importActual<any>('../../../src/ts/Utils')
  return {
    ...actual,
    getPeerID: vi.fn((withSession = true) => (withSession ? 'self_s0' : 'self')),
    signChallenge: vi.fn(() => Promise.resolve('self-sig')),
    verifyChallenge: vi.fn((c: string, pk: string, sig: string) => verifyImpl(c, pk, sig)),
  }
})

// Control-frame builders mirroring EdrysSimplePeerTransport's private CTRL_* codes.
const CTRL_ID = 1
const CTRL_HANDSHAKE = 2
function idFrame(userid: string): Uint8Array {
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, CTRL_ID)
  encoding.writeVarString(e, userid)
  return encoding.toUint8Array(e)
}
function hsFrame(pubkey: string, sig: string): Uint8Array {
  const e = encoding.createEncoder()
  encoding.writeVarUint(e, CTRL_HANDSHAKE)
  encoding.writeVarString(e, pubkey)
  encoding.writeVarString(e, sig)
  return encoding.toUint8Array(e)
}

// Fake RTCPeerConnection: `on*` properties plus addEventListener, like the real one.
class FakePC {
  iceConnectionState = 'new'
  connectionState = 'new'
  oniceconnectionstatechange: (() => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  private listeners: Record<string, Function[]> = {}
  addEventListener(event: string, cb: Function) {
    ;(this.listeners[event] ||= []).push(cb)
  }
  // The browser reports a dead remote: ICE and the connection both fail.
  fail() {
    this.iceConnectionState = 'failed'
    this.connectionState = 'failed'
    this.oniceconnectionstatechange?.()
    this.onconnectionstatechange?.()
    for (const ev of ['iceconnectionstatechange', 'connectionstatechange']) {
      ;(this.listeners[ev] || []).forEach((cb) => cb())
    }
  }
}

// Fake simple-peer: minimal event emitter, one instance per createPeerConnection.
class FakePeer {
  private listeners: Record<string, Function[]> = {}
  connected = false
  destroyed = false
  _pc = new FakePC()
  constructor(_opts: any) {
    // Like simple-peer: its own handlers tear the peer down when ICE fails.
    this._pc.oniceconnectionstatechange = () => {
      if (this._pc.iceConnectionState === 'failed') this.destroy()
    }
  }
  on(event: string, cb: Function) {
    ;(this.listeners[event] ||= []).push(cb)
  }
  emit(event: string, arg?: any) {
    ;(this.listeners[event] || []).forEach((cb) => cb(arg))
  }
  send(_data: Uint8Array) {}
  signal(_s: any) {}
  destroy() {
    if (this.destroyed) return
    this.destroyed = true
    this.connected = false
    this.emit('close')
  }
  open() {
    this.connected = true
    this.emit('connect')
  }
}

function makeTransport() {
  return new EdrysSimplePeerTransport({
    peer: FakePeer as any,
    signaling: [],
    classroomId: 'room-1',
  })
}

// Create a connected, opened peer on the transport and return the FakePeer +
// its id, so tests can inject inbound control frames as that peer.
async function attachPeer(t: EdrysSimplePeerTransport, peerId: string) {
  ;(t as any).handlePeerSignal(peerId, { type: 'offer' })
  const peer: FakePeer = (t as any).peers.get(peerId).peer
  peer.open() // fires onPeerConnect -> transport announces itself (harmless)
  await flush()
  return peer
}

// Deliver an inbound control frame to the transport as if `peer` sent it.
function deliverControl(t: EdrysSimplePeerTransport, peerId: string, frame: Uint8Array) {
  for (const cb of (t as any)._controlCallbacks) cb(peerId, frame)
}

describe('EdrysSimplePeerTransport identity gate', () => {
  beforeEach(() => {
    verifyImpl = () => Promise.resolve(true)
  })

  test('a peer with a valid signature is registered under its userid', async () => {
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-1'
    await attachPeer(t, peerId)

    deliverControl(t, peerId, idFrame('pubA_s1'))
    deliverControl(t, peerId, hsFrame('pubA', 'good-sig'))
    await flush()

    expect(t.peerIdForUser('pubA_s1')).toBe(peerId)
  })

  test('onPeerConnect fans out: a later registration fires alongside our own handshake', async () => {
    // Mirrors production, where GenericProvider.connect() registers its own
    // onPeerConnect after our constructor did — both must fire (the base
    // transport supports multiple listeners; a single-callback base would have
    // clobbered our handshake trigger).
    const t = makeTransport()
    await t.connect({ room: 'room-1' })

    const extra: string[] = []
    t.onPeerConnect((peerId) => extra.push(peerId))

    const peerId = 'peer-fanout'
    await attachPeer(t, peerId)

    // The extra listener fired...
    expect(extra).toEqual([peerId])
    // ...and our own handshake still runs (verifies end-to-end).
    deliverControl(t, peerId, idFrame('pubA_s1'))
    deliverControl(t, peerId, hsFrame('pubA', 'good-sig'))
    await flush()
    expect(t.peerIdForUser('pubA_s1')).toBe(peerId)
  })

  test('a spoofed peer (bad signature) is rejected and torn down', async () => {
    verifyImpl = () => Promise.resolve(false)
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-spoof'
    const peer = await attachPeer(t, peerId)

    deliverControl(t, peerId, idFrame('pubS_s9'))
    deliverControl(t, peerId, hsFrame('pubS', 'forged-sig'))
    await flush()

    expect(t.peerIdForUser('pubS_s9')).toBeUndefined()
    expect(peer.destroyed).toBe(true)
  })

  test('userid whose base != handshake pubkey is rejected without calling verify', async () => {
    const verifySpy = vi.fn(() => Promise.resolve(true))
    verifyImpl = verifySpy
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-liar'
    const peer = await attachPeer(t, peerId)

    // Announce userid claiming pubX, but sign the handshake with pubLiar.
    deliverControl(t, peerId, idFrame('pubX_s1'))
    deliverControl(t, peerId, hsFrame('pubLiar', 'sig'))
    await flush()

    expect(t.peerIdForUser('pubX_s1')).toBeUndefined()
    expect(verifySpy).not.toHaveBeenCalled()
    expect(peer.destroyed).toBe(true)
  })

  test('a handshake frame with no prior ID frame is ignored', async () => {
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-x'
    await attachPeer(t, peerId)

    deliverControl(t, peerId, hsFrame('pubA', 'sig'))
    await flush()

    expect(t.peerIdForUser('pubA_s1')).toBeUndefined()
  })

  test('onLeave fires with the userid when a verified peer disconnects', async () => {
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-leave'
    const peer = await attachPeer(t, peerId)

    const left: string[] = []
    t.onLeave((userid) => left.push(userid))

    deliverControl(t, peerId, idFrame('pubA_s1'))
    deliverControl(t, peerId, hsFrame('pubA', 'good-sig'))
    await flush()
    expect(t.peerIdForUser('pubA_s1')).toBe(peerId)

    peer.destroy()
    await flush()

    expect(left).toEqual(['pubA_s1'])
    expect(t.peerIdForUser('pubA_s1')).toBeUndefined()
  })

  test('onLeave fires when a verified peer’s connection fails (no ghost user)', async () => {
    // A remote that dies without closing only shows up as a failed connection.
    // simple-peer's own handlers turn that into a close; the transport must not
    // replace them, or the peer is never reported as gone.
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-dead'
    const peer = await attachPeer(t, peerId)

    const left: string[] = []
    t.onLeave((userid) => left.push(userid))

    deliverControl(t, peerId, idFrame('pubA_s1'))
    deliverControl(t, peerId, hsFrame('pubA', 'good-sig'))
    await flush()

    peer._pc.fail()
    await flush()

    expect(left).toEqual(['pubA_s1'])
  })

  test('a peer that never completes the handshake is dropped; a verified one is kept', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const t = makeTransport()
      await t.connect({ room: 'room-1' })
      const stalled = await attachPeer(t, 'peer-stalled')
      const verified = await attachPeer(t, 'peer-ok')

      deliverControl(t, 'peer-stalled', idFrame('pubS_s1')) // announces, never signs
      deliverControl(t, 'peer-ok', idFrame('pubA_s1'))
      deliverControl(t, 'peer-ok', hsFrame('pubA', 'good-sig'))
      await flush()

      vi.advanceTimersByTime(30000) // first sweep: not expired yet
      expect(stalled.destroyed).toBe(false)

      vi.advanceTimersByTime(30000)
      expect(stalled.destroyed).toBe(true)
      expect(verified.destroyed).toBe(false)
      expect(t.peerIdForUser('pubA_s1')).toBe('peer-ok')
      t.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  test('sendTo(userid) resolves to the verified peer (not treated as a peerId)', async () => {
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-msg'
    const peer = await attachPeer(t, peerId)

    deliverControl(t, peerId, idFrame('pubA_s1'))
    deliverControl(t, peerId, hsFrame('pubA', 'good-sig'))
    await flush()

    const sendSpy = vi.spyOn(peer, 'send')
    t.sendTo('pubA_s1', new Uint8Array([1, 2, 3]))
    expect(sendSpy).toHaveBeenCalled()
  })

  test('sendTo(userid) for an unverified target falls back to broadcast', async () => {
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-bc'
    const peer = await attachPeer(t, peerId)

    // peer-bc is connected but never completed the handshake, so the target
    // userid is unknown; sendTo must still broadcast to all connected peers.
    const sendSpy = vi.spyOn(peer, 'send')
    t.sendTo('unknown_user', new Uint8Array([9]))
    expect(sendSpy).toHaveBeenCalled()
  })
})

describe('EdrysSimplePeerTransport data gate', () => {
  beforeEach(() => {
    verifyImpl = () => Promise.resolve(true)
  })

  // A data frame as the base transport sends it: [0x00][payload].
  const dataFrame = (b: number) => new Uint8Array([0x00, b])

  test('data from a peer reaches the provider only after its handshake verifies', async () => {
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const got: number[] = []
    t.onMessage((d) => got.push(d[0]))
    const peerId = 'peer-data'
    const peer = await attachPeer(t, peerId)

    peer.emit('data', dataFrame(1))
    expect(got).toEqual([])

    deliverControl(t, peerId, idFrame('pubA_s1'))
    deliverControl(t, peerId, hsFrame('pubA', 'good-sig'))
    await flush()
    expect(got).toEqual([1])
    peer.emit('data', dataFrame(2))
    expect(got).toEqual([1, 2])
  })

  test('data from a peer that fails the handshake never reaches the provider', async () => {
    verifyImpl = () => Promise.resolve(false)
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const got: number[] = []
    t.onMessage((d) => got.push(d[0]))
    const peerId = 'peer-forged'
    const peer = await attachPeer(t, peerId)

    peer.emit('data', dataFrame(1))
    deliverControl(t, peerId, idFrame('pubS_s9'))
    deliverControl(t, peerId, hsFrame('pubS', 'forged-sig'))
    await flush()
    peer.emit('data', dataFrame(2))
    expect(got).toEqual([])
  })
})

async function flush() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
  }
}
