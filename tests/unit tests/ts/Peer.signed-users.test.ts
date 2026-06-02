import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { i18n } from '../../setup'

// y.users sidecar signing integration test.
// Uses real Utils (real WebCrypto) with mocked Database (so the crypto
// identity is regenerated per test) and mocked providers (no network).

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 10))

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
vi.mock('../../../src/ts/EdrysWebrtcProvider', () => ({
  EdrysWebrtcProvider: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    onLeave: vi.fn(),
    onMessage: vi.fn(),
    sendMessage: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  })),
}))
vi.mock('../../../src/ts/EdrysWebsocketProvider', () => ({
  EdrysWebsocketProvider: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    onLeave: vi.fn(),
    onMessage: vi.fn(),
    sendMessage: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
  })),
}))

describe('Signed y.users', () => {
  let Peer: any
  let Utils: any

  beforeEach(async () => {
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    Utils = await import('../../../src/ts/Utils')
    Peer = (await import('../../../src/ts/Peer')).default
  })

  function makeSetup(createdBy: string) {
    return {
      id: 'lab1',
      data: {
        meta: { defaultNumberOfRooms: 0 },
        members: { teacher: [], student: [] },
        createdBy,
      },
      timestamp: Date.now(),
      hash: null,
    }
  }

  test('initUser writes a verifiable envelope to y.userSigs', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises() // let _signUserEntry resolve
    await flushPromises()

    const peerID = peer['peerID']
    const userEntry = peer['y'].users.get(peerID)
    expect(userEntry).toBeDefined()

    const envelope = peer['y'].userSigs.get(peerID)
    expect(envelope).toBeDefined()
    expect(envelope.signer).toBe(myPubKey)
    expect(typeof envelope.signature).toBe('string')
    expect(typeof envelope.nonce).toBe('number')

    // Verify the envelope against the current entry payload
    const payload = userEntry.toJSON()
    const valid = await Utils.verifyEntry('users', peerID, payload, envelope)
    expect(valid).toBe(true)

    peer.stop()
  })

  test('ticktack re-signs after bumping logicalClock', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()

    const peerID = peer['peerID']
    const firstEnv = peer['y'].userSigs.get(peerID)
    const firstNonce = firstEnv.nonce

    // Sleep slightly so the new nonce differs deterministically
    await new Promise((r) => setTimeout(r, 5))

    peer.ticktack()
    await flushPromises()

    const secondEnv = peer['y'].userSigs.get(peerID)
    expect(secondEnv.nonce).toBeGreaterThanOrEqual(firstNonce)
    // The signature must still verify against the (now updated) payload.
    const payload = peer['y'].users.get(peerID).toJSON()
    const valid = await Utils.verifyEntry('users', peerID, payload, secondEnv)
    expect(valid).toBe(true)

    peer.stop()
  })

  test('gotoRoom updates the room field and re-signs', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()

    const peerID = peer['peerID']
    peer['y'].rooms.set('Room1', new Y.Map())
    peer.gotoRoom('Room1')
    await flushPromises()

    const entry = peer['y'].users.get(peerID).toJSON()
    expect(entry.room).toBe('Room1')

    const envelope = peer['y'].userSigs.get(peerID)
    const valid = await Utils.verifyEntry('users', peerID, entry, envelope)
    expect(valid).toBe(true)

    peer.stop()
  })

  test('stop deletes both the user entry and its sidecar envelope', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()

    const peerID = peer['peerID']
    expect(peer['y'].users.has(peerID)).toBe(true)
    expect(peer['y'].userSigs.has(peerID)).toBe(true)

    peer.stop()
  })

  test('an unsigned remote user entry is reverted by the local observer', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    // Attach observers; constructor's initUser call sets withObserver=false.
    await peer.join('student')
    await flushPromises()

    // Simulate an attacker peer in another doc that injects a fake user with
    // no signature, then sync that update into our peer's doc.
    const attackerDoc = new Y.Doc()
    attackerDoc.clientID = 1 // distinct from peer doc's clientID 0
    const attackerUsers = attackerDoc.getMap('users')
    const fakeID = 'A'.repeat(40) + '_FAKE'
    attackerDoc.transact(() => {
      const m = new Y.Map()
      m.set('displayName', 'Mallory')
      m.set('room', 'Lobby')
      m.set('role', 'teacher')
      m.set('dateJoined', Date.now())
      m.set('logicalClock', 0)
      m.set('handRaised', false)
      m.set('connections', [])
      attackerUsers.set(fakeID, m)
    })

    const update = Y.encodeStateAsUpdate(attackerDoc)
    Y.applyUpdate(peer['y'].doc, update)
    await flushPromises()
    await flushPromises()

    // The unsigned entry must have been reverted by the verify-and-revert observer.
    expect(peer['y'].users.has(fakeID)).toBe(false)

    peer.stop()
    attackerDoc.destroy()
  })

  test('a remote user entry signed by a different identity is reverted (spoof attempt)', async () => {
    // Identity #1 — the legitimate local peer
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    await peer.join('student')
    await flushPromises()

    // Identity #2 — the attacker, loaded into a fresh Utils module so they
    // have a distinct keypair.
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    const AttackerUtils: any = await import('../../../src/ts/Utils')
    await AttackerUtils.initCryptoIdentity()
    const attackerPubKey = AttackerUtils.getPeerID(false)
    expect(attackerPubKey).not.toBe(myPubKey)

    // Attacker forges a user record claiming to be someone *else* (id whose
    // pubkey prefix is some-random-string, not attackerPubKey), signs it with
    // their own key, and tries to inject it.
    const victimID = 'B'.repeat(40) + '_SPOOF'
    const attackerDoc = new Y.Doc()
    attackerDoc.clientID = 2
    const attackerUsers = attackerDoc.getMap('users')
    const attackerSigs = attackerDoc.getMap('userSigs')
    const payload: any = {
      displayName: 'Spoofed',
      room: 'Lobby',
      role: 'teacher',
      dateJoined: Date.now(),
      logicalClock: 0,
      handRaised: false,
      connections: [],
    }
    const envelope = await AttackerUtils.signEntry('users', victimID, payload)

    attackerDoc.transact(() => {
      const m = new Y.Map()
      for (const k of Object.keys(payload)) m.set(k, payload[k])
      attackerUsers.set(victimID, m)
      attackerSigs.set(victimID, envelope)
    })

    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(attackerDoc))
    await flushPromises()
    await flushPromises()

    // Signature is valid but signer doesn't match victimID's pubkey prefix →
    // unauthorized → reverted.
    expect(peer['y'].users.has(victimID)).toBe(false)

    peer.stop()
    attackerDoc.destroy()
  })
})
