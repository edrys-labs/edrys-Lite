import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { i18n } from '../../setup'

// y.rooms sidecar signing integration test.
// Mirrors Peer.signed-users.test.ts: real Utils (real WebCrypto), mocked
// Database (fresh crypto identity per test) and mocked providers (no network).

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

describe('Signed y.rooms', () => {
  let Peer: any
  let Utils: any

  beforeEach(async () => {
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    Utils = await import('../../../src/ts/Utils')
    Peer = (await import('../../../src/ts/Peer')).default
  })

  function makeSetup(createdBy: string, defaultNumberOfRooms = 0, teachers: string[] = []) {
    return {
      id: 'lab1',
      data: {
        meta: { defaultNumberOfRooms },
        members: { teacher: teachers, student: [] },
        createdBy,
      },
      timestamp: Date.now(),
      hash: null,
    }
  }

  test('addRoom writes a verifiable envelope to y.roomSigs', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()

    // Owner adds a custom room
    peer.addRoom('Discussion')
    await flushPromises()

    expect(peer['y'].rooms.has('Discussion')).toBe(true)
    const env = peer['y'].roomSigs.get('Discussion')
    expect(env).toBeDefined()
    expect(env.signer).toBe(myPubKey)
    expect(typeof env.signature).toBe('string')
    expect(typeof env.nonce).toBe('number')

    const valid = await Utils.verifyEntry('rooms', 'Discussion', {}, env)
    expect(valid).toBe(true)

    peer.stop()
  })

  test('default rooms (Lobby) are signed during bootstrap', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey, 1), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()

    expect(peer['y'].rooms.has('Lobby')).toBe(true)
    expect(peer['y'].rooms.has('Room 1')).toBe(true)

    const lobbyEnv = peer['y'].roomSigs.get('Lobby')
    expect(lobbyEnv).toBeDefined()
    const lobbyValid = await Utils.verifyEntry('rooms', 'Lobby', {}, lobbyEnv)
    expect(lobbyValid).toBe(true)

    const roomEnv = peer['y'].roomSigs.get('Room 1')
    expect(roomEnv).toBeDefined()
    const roomValid = await Utils.verifyEntry('rooms', 'Room 1', {}, roomEnv)
    expect(roomValid).toBe(true)

    peer.stop()
  })

  test('unsigned remote room is reverted by the local observer (Exploit 4)', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    // join() wires the observer; constructor's initRooms uses withObserver=false.
    await peer.join('student')
    await flushPromises()

    // Attacker doc creates an unsigned room and syncs into ours.
    const attackerDoc = new Y.Doc()
    attackerDoc.clientID = 1
    const attackerRooms = attackerDoc.getMap('rooms')
    attackerDoc.transact(() => {
      attackerRooms.set('Station fakeStn', new Y.Map())
    })

    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(attackerDoc))
    await flushPromises()
    await flushPromises()

    expect(peer['y'].rooms.has('Station fakeStn')).toBe(false)

    peer.stop()
    attackerDoc.destroy()
  })

  test('remote station room created by a non-owner/teacher signer is reverted (Exploit 4 signed variant)', async () => {
    // Owner identity
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    await peer.join('student')
    await flushPromises()

    // Attacker identity with its own keypair
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    const AttackerUtils: any = await import('../../../src/ts/Utils')
    await AttackerUtils.initCryptoIdentity()
    const attackerPubKey = AttackerUtils.getPeerID(false)
    expect(attackerPubKey).not.toBe(myPubKey)

    // Attacker signs a station room with their own (unauthorized) key.
    const envelope = await AttackerUtils.signEntry('rooms', 'Station evil', {})

    const attackerDoc = new Y.Doc()
    attackerDoc.clientID = 2
    const attackerRooms = attackerDoc.getMap('rooms')
    const attackerSigs = attackerDoc.getMap('roomSigs')
    attackerDoc.transact(() => {
      attackerRooms.set('Station evil', new Y.Map())
      attackerSigs.set('Station evil', envelope)
    })

    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(attackerDoc))
    await flushPromises()
    await flushPromises()

    // Signature is valid but signer is neither owner nor teacher → reverted.
    expect(peer['y'].rooms.has('Station evil')).toBe(false)

    peer.stop()
    attackerDoc.destroy()
  })

  test('remote delete of a legitimate room is healed from cache (Exploit 3 / 5)', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    await peer.join('student')
    await flushPromises()

    // Owner adds a legitimate station room.
    peer.addRoom('Station stn1')
    await flushPromises()
    expect(peer['y'].rooms.has('Station stn1')).toBe(true)
    // Ensure last-good cache is populated by walking through one observer cycle
    // — explicitly trigger by syncing the same room back from a peer doc.
    // (addRoom origin is 'addRoom' which is local-skip; we need a remote-origin
    // visit to seed the cache. Simulate by having another peer ack the room.)
    const ackDoc = new Y.Doc()
    ackDoc.clientID = 3
    Y.applyUpdate(ackDoc, Y.encodeStateAsUpdate(peer['y'].doc))
    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(ackDoc))
    await flushPromises()
    await flushPromises()

    // Attacker doc starts from our state, then deletes the station room.
    const attackerDoc = new Y.Doc()
    attackerDoc.clientID = 4
    Y.applyUpdate(attackerDoc, Y.encodeStateAsUpdate(peer['y'].doc))
    attackerDoc.transact(() => {
      attackerDoc.getMap('rooms').delete('Station stn1')
      attackerDoc.getMap('roomSigs').delete('Station stn1')
    })

    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(attackerDoc))
    await flushPromises()
    await flushPromises()

    // Local observer must restore the deleted room from cached envelope.
    expect(peer['y'].rooms.has('Station stn1')).toBe(true)
    const env = peer['y'].roomSigs.get('Station stn1')
    expect(env).toBeDefined()
    const valid = await Utils.verifyEntry('rooms', 'Station stn1', {}, env)
    expect(valid).toBe(true)

    peer.stop()
    attackerDoc.destroy()
    ackDoc.destroy()
  })

  test('user is NOT moved to Lobby when a remote attacker deletes their current room', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    await peer.join('student')
    await flushPromises()

    // Owner creates a room and moves there.
    peer.addRoom('Discussion')
    await flushPromises()
    peer.gotoRoom('Discussion')
    await flushPromises()
    expect(peer.user().get('room')).toBe('Discussion')

    // Seed the cache via a remote sync round-trip.
    const ackDoc = new Y.Doc()
    ackDoc.clientID = 5
    Y.applyUpdate(ackDoc, Y.encodeStateAsUpdate(peer['y'].doc))
    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(ackDoc))
    await flushPromises()
    await flushPromises()

    // Attacker deletes the room remotely.
    const attackerDoc = new Y.Doc()
    attackerDoc.clientID = 6
    Y.applyUpdate(attackerDoc, Y.encodeStateAsUpdate(peer['y'].doc))
    attackerDoc.transact(() => {
      attackerDoc.getMap('rooms').delete('Discussion')
      attackerDoc.getMap('roomSigs').delete('Discussion')
    })
    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(attackerDoc))
    await flushPromises()
    await flushPromises()

    // The room is healed back from cache, and the user stays in Discussion
    // (move-to-Lobby is gated on local-origin deletes only).
    expect(peer['y'].rooms.has('Discussion')).toBe(true)
    expect(peer.user().get('room')).toBe('Discussion')

    peer.stop()
    attackerDoc.destroy()
    ackDoc.destroy()
  })

  test('local delete (checkForDeadStations) still moves user to Lobby and removes sig', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    await peer.join('student')
    await flushPromises()

    peer.addRoom('TmpRoom')
    await flushPromises()
    peer.gotoRoom('TmpRoom')
    await flushPromises()
    expect(peer.user().get('room')).toBe('TmpRoom')

    // Local delete via the internal helper.
    peer['_deleteAndUnsignRoom']('TmpRoom', 'checkForDeadStations')
    await flushPromises()

    expect(peer['y'].rooms.has('TmpRoom')).toBe(false)
    expect(peer['y'].roomSigs.has('TmpRoom')).toBe(false)
    expect(peer.user().get('room')).toBe('Lobby')

    peer.stop()
  })
})
