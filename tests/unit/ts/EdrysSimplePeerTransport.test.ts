import { describe, test, expect, vi, beforeEach } from 'vitest'
import * as Y from 'yjs'
import { encoding } from 'lib0'
import { GenericProvider } from 'genericprovider'
import { EdrysSimplePeerTransport } from '../../../src/ts/EdrysSimplePeerTransport'
import { REVERT_INVALID_ORIGIN } from '../../../src/ts/Utils'

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

// Fake simple-peer: minimal event emitter, one instance per createPeerConnection.
class FakePeer {
  private listeners: Record<string, Function[]> = {}
  connected = false
  destroyed = false
  constructor(_opts: any) {}
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
  ;(t as any)._controlCallback(peerId, frame)
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
})

describe('excludeOrigins kills revert propagation', () => {
  test('updates tagged REVERT_INVALID_ORIGIN never reach the transport', () => {
    const doc = new Y.Doc()
    const sent: Uint8Array[] = []
    const transport: any = {
      get isConnected() {
        return true
      },
      connect: vi.fn(() => Promise.resolve()),
      disconnect: vi.fn(),
      send: (d: Uint8Array) => sent.push(d),
      onMessage: () => () => {},
    }

    const provider = new GenericProvider(doc, transport, {
      excludeOrigins: [REVERT_INVALID_ORIGIN],
    })

    // A normal edit must be forwarded.
    doc.getMap('m').set('k', 'normal')
    const afterNormal = sent.length
    expect(afterNormal).toBeGreaterThan(0)

    // A revert transaction must be dropped.
    doc.transact(() => {
      doc.getMap('m').set('k', 'reverted')
    }, REVERT_INVALID_ORIGIN)

    expect(sent.length).toBe(afterNormal)

    provider.destroy?.()
  })
})

// Paired in-memory transport: send() on one side is delivered to the other's
// onMessage on a microtask, so two GenericProviders can sync end-to-end.
function makePairedTransports() {
  const cbs: Array<((d: Uint8Array) => void) | null> = [null, null]
  const make = (self: number, other: number): any => ({
    get isConnected() {
      return true
    },
    connect: () => Promise.resolve(),
    disconnect: () => {},
    send: (d: Uint8Array) => {
      const copy = d.slice()
      queueMicrotask(() => cbs[other]?.(copy))
    },
    onMessage: (cb: (d: Uint8Array) => void) => {
      cbs[self] = cb
      return () => {
        cbs[self] = null
      }
    },
  })
  return [make(0, 1), make(1, 0)]
}

describe('computeDocHash convergence (verifyUpdates)', () => {
  test('two convergent docs reach synced without a hash-mismatch loop', async () => {
    const warnings: string[] = []
    const spy = vi.spyOn(console, 'warn').mockImplementation((...a) => {
      warnings.push(a.join(' '))
    })

    const docA = new Y.Doc()
    const docB = new Y.Doc()
    // Pre-connect offline edits on both sides, so initial sync must merge two
    // divergent histories — the exact case where encodeStateAsUpdate hashes
    // differed between the (now convergent) replicas.
    docA.getMap('m').set('a', 1)
    docB.getMap('m').set('b', 2)

    const [tA, tB] = makePairedTransports()

    // verifyUpdates ON — the path that hashed encodeStateAsUpdate and looped.
    const pA = new GenericProvider(docA, tA, { verifyUpdates: true, disableBc: true })
    const pB = new GenericProvider(docB, tB, { verifyUpdates: true, disableBc: true })

    let aSynced = false
    let bSynced = false
    pA.on('synced', () => (aSynced = true))
    pB.on('synced', () => (bSynced = true))

    await pA.connect({ room: 'r' })
    await pB.connect({ room: 'r' })
    await flush()

    // More interleaved edits after connect (delivered as verified updates).
    docA.getMap('m').set('a2', 3)
    docB.getMap('m').set('b2', 4)
    await flush()
    await new Promise((r) => setTimeout(r, 30))
    await flush()

    // Both docs converge to the same content...
    expect(docA.getMap('m').toJSON()).toEqual(docB.getMap('m').toJSON())
    // ...and synced fires (only emitted when localHash === expectedHash).
    expect(aSynced && bSynced).toBe(true)

    // Once converged, a convergence-invariant hash must NOT keep detecting
    // mismatches (the pre-fix bug looped here forever).
    warnings.length = 0
    await new Promise((r) => setTimeout(r, 50))
    await flush()
    const mismatchAfterConverge = warnings.filter((w) => w.includes('Hash mismatch'))
    expect(mismatchAfterConverge).toEqual([])

    spy.mockRestore()
    pA.destroy()
    pB.destroy()
  })
})

async function flush() {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve()
  }
}
