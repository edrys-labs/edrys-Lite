import { describe, test, expect, vi, beforeEach } from 'vitest'
import { encoding } from 'lib0'
import { EdrysSimplePeerTransport } from '../../../src/ts/EdrysSimplePeerTransport'

// verifyHandshake is driven per-test; sign/getPeerID are stubbed but the
// receiver-side gate (the security-critical half) is exercised by injecting
// control frames directly, so it does not depend on announce-time identity.
let verifyImpl: (pk: string, sig: string, payload: string) => Promise<boolean> = () =>
  Promise.resolve(true)

vi.mock('../../../src/ts/Utils', async () => {
  const actual = await vi.importActual<any>('../../../src/ts/Utils')
  return {
    ...actual,
    getPeerID: vi.fn((withSession = true) => (withSession ? 'self_s0' : 'self')),
    signHandshake: vi.fn(() => Promise.resolve('self-sig')),
    verifyHandshake: vi.fn((pk: string, sig: string, payload: string) => verifyImpl(pk, sig, payload)),
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

// Fake RTCPeerConnection: `on*` properties plus addEventListener, like the real
// one. Each connection gets its own DTLS fingerprints, as in a browser.
let pcCount = 0
const sdpWith = (fp: string) => ({ sdp: `v=0\r\na=fingerprint:${fp}\r\n` })
class FakePC {
  n = ++pcCount
  localDescription: { sdp: string } | null = sdpWith(`sha-256 LOCAL:${this.n}`)
  remoteDescription: { sdp: string } | null = sdpWith(`sha-256 REMOTE:${this.n}`)
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

  test('a handshake replayed on another connection is rejected', async () => {
    // The victim signs the payload of its own connection.
    const payloads: string[] = []
    let victimPayload = ''
    verifyImpl = (pk, sig, payload) => {
      payloads.push(payload)
      if (!victimPayload) victimPayload = payload
      return Promise.resolve(pk === 'pubV' && sig === 'victim-sig' && payload === victimPayload)
    }
    const t = makeTransport()
    await t.connect({ room: 'room-1' })

    await attachPeer(t, 'victim-conn')
    deliverControl(t, 'victim-conn', idFrame('pubV_s1'))
    deliverControl(t, 'victim-conn', hsFrame('pubV', 'victim-sig'))
    await flush()
    expect(t.peerIdForUser('pubV_s1')).toBe('victim-conn')

    // Another peer that received the victim's frames sends them again.
    const other = await attachPeer(t, 'other-conn')
    deliverControl(t, 'other-conn', idFrame('pubV_s1'))
    deliverControl(t, 'other-conn', hsFrame('pubV', 'victim-sig'))
    await flush()

    // Each connection asks for a signature over different data...
    expect(payloads).toHaveLength(2)
    expect(payloads[1]).not.toBe(payloads[0])
    // ...so the replay fails and the victim keeps its connection.
    expect(other.destroyed).toBe(true)
    expect(t.peerIdForUser('pubV_s1')).toBe('victim-conn')
  })

  test('the signed payload holds both peer ids and both fingerprints', async () => {
    let seen = ''
    verifyImpl = (_pk, _sig, payload) => {
      seen = payload
      return Promise.resolve(true)
    }
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peer = await attachPeer(t, 'peer-fp')
    peer._pc.localDescription = sdpWith('sha-256 LO:CA:L')
    peer._pc.remoteDescription = sdpWith('sha-256 RE:MO:TE')

    deliverControl(t, 'peer-fp', idFrame('pubA_s1'))
    deliverControl(t, 'peer-fp', hsFrame('pubA', 'sig'))
    await flush()

    // Signer (the remote) first, verifier (us) second.
    expect(JSON.parse(seen)).toEqual([
      'edrys-handshake-v2',
      'room-1',
      'peer-fp',
      t.localPeerId,
      'sha-256 RE:MO:TE',
      'sha-256 LO:CA:L',
    ])
  })

  test('on connect we send our ID, then a handshake signed for this connection', async () => {
    const utils = await import('../../../src/ts/Utils')
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    ;(t as any).handlePeerSignal('peer-out', { type: 'offer' })
    const peer: FakePeer = (t as any).peers.get('peer-out').peer
    const sent = vi.spyOn(t, 'sendControl')

    peer.open()
    await flush()

    expect(utils.signHandshake).toHaveBeenLastCalledWith(
      JSON.stringify([
        'edrys-handshake-v2',
        'room-1',
        t.localPeerId,
        'peer-out',
        `sha-256 LOCAL:${peer._pc.n}`,
        `sha-256 REMOTE:${peer._pc.n}`,
      ])
    )
    expect(sent.mock.calls.map(([, frame]) => frame[0])).toEqual([CTRL_ID, CTRL_HANDSHAKE])
  })

  test('a connection without fingerprints is rejected without calling verify', async () => {
    const verifySpy = vi.fn(() => Promise.resolve(true))
    verifyImpl = verifySpy
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peer = await attachPeer(t, 'peer-nofp')
    peer._pc.remoteDescription = null

    deliverControl(t, 'peer-nofp', idFrame('pubA_s1'))
    deliverControl(t, 'peer-nofp', hsFrame('pubA', 'sig'))
    await flush()

    expect(verifySpy).not.toHaveBeenCalled()
    expect(t.peerIdForUser('pubA_s1')).toBeUndefined()
    expect(peer.destroyed).toBe(true)
  })

  test('a handshake frame with no prior ID frame is rejected', async () => {
    const t = makeTransport()
    await t.connect({ room: 'room-1' })
    const peerId = 'peer-x'
    const peer = await attachPeer(t, peerId)

    deliverControl(t, peerId, hsFrame('pubA', 'sig'))
    await flush()

    expect(t.peerIdForUser('pubA_s1')).toBeUndefined()
    expect(peer.destroyed).toBe(true)
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

  test('a silent peer and one that keeps re-announcing are dropped after the deadline', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    try {
      const t = makeTransport()
      await t.connect({ room: 'room-1' })
      const silent = await attachPeer(t, 'peer-silent') // never sends anything
      const chatty = await attachPeer(t, 'peer-chatty')

      deliverControl(t, 'peer-chatty', idFrame('pubC_s1'))
      vi.advanceTimersByTime(30000) // first sweep: not expired yet
      deliverControl(t, 'peer-chatty', idFrame('pubC_s1')) // must not reset the deadline
      expect(silent.destroyed).toBe(false)

      vi.advanceTimersByTime(30000)
      expect(silent.destroyed).toBe(true)
      expect(chatty.destroyed).toBe(true)
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
