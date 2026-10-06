import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'

// Signed presence on awareness. Real Utils (real WebCrypto) with a mocked
// Database, so the identity is regenerated per test.

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 10))
const settle = async () => {
  for (let i = 0; i < 4; i++) await flushPromises()
}

const mockDb = {
  getPublicKeyRaw: vi.fn().mockResolvedValue(null),
  getPrivateKey: vi.fn().mockResolvedValue(null),
  setPublicKeyRaw: vi.fn().mockResolvedValue(undefined),
  setPrivateKey: vi.fn().mockResolvedValue(undefined),
  getMigrationDone: vi.fn().mockResolvedValue(true),
  setMigrationDone: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../../src/ts/Database', () => ({ Database: vi.fn(() => mockDb) }))
vi.mock('secure-ls', () => ({
  default: vi.fn().mockImplementation(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() })),
}))
vi.mock('../../../src/api/debugHandler', () => ({
  debug: { ts: { peer: vi.fn() } },
}))

/** Relay every local change of `from` into `to`, like a transport would. */
function link(from: awarenessProtocol.Awareness, to: awarenessProtocol.Awareness) {
  from.on('update', ({ added, updated, removed }: any, origin: any) => {
    if (origin === 'remote') return
    const changed = added.concat(updated, removed)
    awarenessProtocol.applyAwarenessUpdate(
      to,
      awarenessProtocol.encodeAwarenessUpdate(from, changed),
      'remote'
    )
  })
}

/** Inject a raw awareness state for a fake client into `aw`. */
function inject(aw: awarenessProtocol.Awareness, clientID: number, state: any, clock = 1) {
  const enc = awarenessProtocol.encodeAwarenessUpdate(
    // encodeAwarenessUpdate reads states/meta from the awareness it is given.
    {
      states: new Map([[clientID, state]]),
      meta: new Map([[clientID, { clock, lastUpdated: Date.now() }]]),
    } as any,
    [clientID]
  )
  awarenessProtocol.applyAwarenessUpdate(aw, enc, 'remote')
}

describe('SignedPresence', () => {
  let Utils: any
  let SignedPresence: any
  let STALE_AFTER: number
  let RESIGN_INTERVAL: number
  let pub: string
  let awA: awarenessProtocol.Awareness
  let awB: awarenessProtocol.Awareness
  const started: any[] = []
  // Human ids are "<pubkey>_<session>" and must be signed by that pubkey.
  const authorize = (id: string, signer: string) => id.split('_')[0] === signer

  beforeEach(async () => {
    vi.resetModules()
    Utils = await import('../../../src/ts/Utils')
    ;({ SignedPresence, STALE_AFTER, RESIGN_INTERVAL } = await import('../../../src/ts/Presence'))
    await Utils.initCryptoIdentity()
    pub = Utils.getPeerID(false)
    awA = new awarenessProtocol.Awareness(new Y.Doc())
    awB = new awarenessProtocol.Awareness(new Y.Doc())
    link(awA, awB)
    link(awB, awA)
  })

  afterEach(() => {
    for (const p of started.splice(0)) p.stop()
    awA.destroy()
    awB.destroy()
    vi.useRealTimers()
  })

  function make(aw: awarenessProtocol.Awareness, id: string, auth = authorize) {
    const onChange = vi.fn()
    const p = new SignedPresence(aw, id, auth, onChange)
    started.push(p)
    return { p, onChange }
  }

  test('a published entry verifies and shows on the other peer', async () => {
    const a = make(awA, `${pub}_a`)
    const b = make(awB, `${pub}_b`)
    await a.p.publish({ room: 'Lobby' })
    await settle()

    expect(b.p.visible[`${pub}_a`]).toEqual({ room: 'Lobby' })
    expect(b.onChange).toHaveBeenCalled()
    const entry = awA.getLocalState()!.presence
    expect(await Utils.verifyEntry('users', entry.id, entry.payload, entry.envelope, Infinity)).toBe(true)
  })

  test('our own entry is always visible to ourselves', async () => {
    const a = make(awA, `${pub}_a`)
    await a.p.publish({ room: 'Room 1' })
    expect(a.p.visible).toEqual({ [`${pub}_a`]: { room: 'Room 1' } })
    expect(a.p.own).toEqual({ room: 'Room 1' })
  })

  test('a moved peer shows in its new room', async () => {
    const a = make(awA, `${pub}_a`)
    const b = make(awB, `${pub}_b`)
    await a.p.publish({ room: 'Lobby' })
    await a.p.publish({ room: 'Room 1' })
    await settle()
    expect(b.p.visible[`${pub}_a`]).toEqual({ room: 'Room 1' })
  })

  test('an unsigned entry is not shown', async () => {
    const b = make(awB, `${pub}_b`)
    inject(awB, 4242, { presence: { id: `${pub}_x`, payload: { room: 'Lobby' } } })
    await settle()
    expect(b.p.has(`${pub}_x`)).toBe(false)
  })

  test('a valid signature reused with another payload is not shown', async () => {
    const a = make(awA, `${pub}_a`)
    const b = make(awB, `${pub}_b`)
    await a.p.publish({ room: 'Lobby' })
    await settle()
    const real = awA.getLocalState()!.presence
    // Same envelope, different room, under another client id.
    inject(awB, 4243, { presence: { ...real, id: `${pub}_x`, payload: { room: 'Forged' } } })
    inject(awB, 4244, { presence: { ...real, payload: { room: 'Forged' } } })
    await settle()
    expect(b.p.has(`${pub}_x`)).toBe(false)
    expect(b.p.visible[`${pub}_a`]).toEqual({ room: 'Lobby' })
  })

  test('an entry its signer may not hold is not shown', async () => {
    const b = make(awB, `${pub}_b`)
    const id = 'SOMEONEELSE_1'
    const envelope = await Utils.signEntry('users', id, { room: 'Lobby' })
    inject(awB, 4245, { presence: { id, payload: { room: 'Lobby' }, envelope } })
    await settle()
    expect(b.p.has(id)).toBe(false)
  })

  test('replaying an older signed entry does not move the peer back', async () => {
    const a = make(awA, `${pub}_a`)
    const b = make(awB, `${pub}_b`)
    await a.p.publish({ room: 'Room 1' })
    await settle()
    const old = awA.getLocalState()!.presence
    await a.p.publish({ room: 'Room 2' })
    await settle()

    inject(awB, 4246, { presence: old })
    await settle()
    expect(b.p.visible[`${pub}_a`]).toEqual({ room: 'Room 2' })
  })

  test('an entry whose nonce stops rising goes stale; re-signing keeps it shown', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    const a = make(awA, `${pub}_a`)
    const b = make(awB, `${pub}_b`)
    await a.p.publish({ room: 'Lobby' })
    await settle()
    const copy = awA.getLocalState()!.presence

    // A live peer re-signs, so it stays visible well past the stale window.
    for (let t = 0; t < STALE_AFTER * 2; t += RESIGN_INTERVAL) {
      vi.advanceTimersByTime(RESIGN_INTERVAL)
      await settle()
    }
    expect(b.p.has(`${pub}_a`)).toBe(true)

    // The peer leaves; an attacker keeps replaying its last entry.
    a.p.stop()
    inject(awB, 4247, { presence: awA.getLocalState()?.presence ?? copy })
    await settle()
    vi.advanceTimersByTime(STALE_AFTER + RESIGN_INTERVAL)
    await settle()
    expect(b.p.has(`${pub}_a`)).toBe(false)
  })

  test('a peer that clears its presence disappears right away', async () => {
    const a = make(awA, `${pub}_a`)
    const b = make(awB, `${pub}_b`)
    await a.p.publish({ room: 'Lobby' })
    await settle()
    expect(b.p.has(`${pub}_a`)).toBe(true)
    a.p.stop()
    await settle()
    expect(b.p.has(`${pub}_a`)).toBe(false)
  })

  test('markLeft hides a peer until it publishes again', async () => {
    const a = make(awA, `${pub}_a`)
    const b = make(awB, `${pub}_b`)
    await a.p.publish({ room: 'Lobby' })
    await settle()

    b.p.markLeft(`${pub}_a`)
    expect(b.p.has(`${pub}_a`)).toBe(false)

    await a.p.publish({ room: 'Lobby' })
    await settle()
    expect(b.p.has(`${pub}_a`)).toBe(true)
  })

  test('markLeft for a peer never seen does not hide it later', async () => {
    const b = make(awB, `${pub}_b`)
    b.p.markLeft(`${pub}_a`)
    const a = make(awA, `${pub}_a`)
    await a.p.publish({ room: 'Lobby' })
    await settle()
    expect(b.p.has(`${pub}_a`)).toBe(true)
  })

  test('a remote overwrite of our awareness state is put back', async () => {
    const a = make(awA, `${pub}_a`)
    await a.p.publish({ room: 'Lobby' })
    const ours = awA.getLocalState()!.presence
    inject(awA, awA.clientID, { presence: { ...ours, payload: { room: 'Forged' } } }, 1000)
    await settle()
    expect(awA.getLocalState()!.presence).toEqual(ours)
  })

  test('reauthorize hides a peer that lost its authorization', async () => {
    let allowed = true
    const a = make(awA, `${pub}_a`)
    const b = make(awB, `${pub}_b`, (id, signer) => allowed && authorize(id, signer))
    await a.p.publish({ room: 'Lobby' })
    await settle()
    expect(b.p.has(`${pub}_a`)).toBe(true)

    allowed = false
    b.p.reauthorize()
    expect(b.p.has(`${pub}_a`)).toBe(false)
  })
})
