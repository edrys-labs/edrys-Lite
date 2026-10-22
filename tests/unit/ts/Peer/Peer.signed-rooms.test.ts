import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { i18n } from '../../../setup'

// Signed room records (y.roomSigs), verified on read.
// Real Utils (real WebCrypto), mocked
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

vi.mock('../../../../src/ts/Database', () => ({ Database: vi.fn(() => mockDb) }))
vi.mock('secure-ls', () => ({
  default: vi.fn().mockImplementation(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() })),
}))
vi.mock('../../../../src/api/debugHandler', () => ({
  debug: { ts: { peer: vi.fn() } },
}))
vi.mock('../../../../src/ts/GenericProviderAdapter', () => ({
  GenericWebrtcProviderAdapter: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    onLeave: vi.fn(),
    onMessage: vi.fn(),
    sendMessage: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
    getPresenceAwareness: vi.fn(() => new Awareness(new Y.Doc())),
    getAwareness: vi.fn(function (this: any) { return (this._app ??= new Awareness(new Y.Doc())) }),
  })),
}))
vi.mock('../../../../src/ts/GenericWebsocketProviderAdapter', () => ({
  GenericWebsocketProviderAdapter: vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    onLeave: vi.fn(),
    onMessage: vi.fn(),
    sendMessage: vi.fn(),
    disconnect: vi.fn(),
    destroy: vi.fn(),
    getPresenceAwareness: vi.fn(() => new Awareness(new Y.Doc())),
    getAwareness: vi.fn(function (this: any) { return (this._app ??= new Awareness(new Y.Doc())) }),
  })),
}))

describe('Signed y.rooms', () => {
  let Peer: any
  let Utils: any
  let ABSENT_GRACE: number

  beforeEach(async () => {
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    Utils = await import('../../../../src/ts/Utils')
    Peer = (await import('../../../../src/ts/Peer')).default
    ;({ ABSENT_GRACE } = await import('../../../../src/ts/Presence'))
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

  test('joining seeds Lobby state without a record and signs default rooms', async () => {
    await Utils.initCryptoIdentity()
    const myPubKey = Utils.getPeerID(false)

    const peer: any = new Peer(makeSetup(myPubKey, 1), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    // Not seeded before connecting, so an unsynced doc can't overwrite Lobby.
    expect(peer['y'].rooms.size).toBe(0)

    await peer.join('student')
    await flushPromises()
    await flushPromises()

    expect(peer['y'].rooms.has('Lobby')).toBe(true)
    expect(peer['y'].roomSigs.has('Lobby')).toBe(false)
    expect(peer['y'].rooms.has('Room 1')).toBe(true)
    const roomEnv = peer['y'].roomSigs.get('Room 1')
    expect(await Utils.verifyEntry('rooms', 'Room 1', {}, roomEnv)).toBe(true)

    expect(Object.keys((await peer.toJSON()).rooms)).toEqual(['Lobby', 'Room 1'])

    peer.stop()
  })

  // Another identity, for attackers and second teachers.
  async function otherIdentity() {
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    const OtherUtils: any = await import('../../../../src/ts/Utils')
    await OtherUtils.initCryptoIdentity()
    return OtherUtils
  }

  async function joinedOwner(teachers: string[] = []) {
    await Utils.initCryptoIdentity()
    const owner = Utils.getPeerID(false)
    const peer: any = new Peer(makeSetup(owner, 0, teachers), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    await peer.join('teacher')
    await flushPromises()
    return peer
  }

  // Applies `change` to a copy of the peer's doc and syncs it back.
  async function remoteChange(peer: any, change: (doc: Y.Doc) => void) {
    const other = new Y.Doc()
    Y.applyUpdate(other, Y.encodeStateAsUpdate(peer['y'].doc))
    other.transact(() => change(other))
    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(other))
    for (let i = 0; i < 3; i++) await flushPromises()
    other.destroy()
  }

  test('an unsigned remote room stays out of the view and is not deleted', async () => {
    const peer = await joinedOwner()

    await remoteChange(peer, (doc) => doc.getMap('rooms').set('Forged', new Y.Map()))

    expect(peer['y'].rooms.has('Forged')).toBe(true)
    expect('Forged' in (await peer.toJSON()).rooms).toBe(false)

    peer.stop()
  })

  test('records signed by someone other than the owner or a teacher are ignored', async () => {
    const peer = await joinedOwner()
    const Attacker = await otherIdentity()

    const evil = await Attacker.signEntry('rooms', 'Evil', {})
    const station = await Attacker.signEntry('rooms', 'Station evil', {})
    await remoteChange(peer, (doc) => {
      doc.getMap('rooms').set('Evil', new Y.Map())
      doc.getMap('roomSigs').set('Evil', evil)
      doc.getMap('roomSigs').set('Station evil', station)
    })

    const { rooms } = await peer.toJSON()
    expect('Evil' in rooms).toBe(false)
    expect('Station evil' in rooms).toBe(false)
    // Nobody wrote a correction.
    expect(peer['y'].roomSigs.get('Evil')).toEqual(evil)

    peer.stop()
  })

  test('the owner republishes a deleted room; it stays in the view throughout', async () => {
    const peer = await joinedOwner()
    peer.addRoom('Discussion')
    await flushPromises()
    const record = peer['y'].roomSigs.get('Discussion')

    await remoteChange(peer, (doc) => {
      doc.getMap('rooms').delete('Discussion')
      doc.getMap('roomSigs').delete('Discussion')
    })

    expect('Discussion' in (await peer.toJSON()).rooms).toBe(true)
    expect(peer['y'].rooms.get('Discussion')).toBeInstanceOf(Y.Map)
    expect(peer['y'].roomSigs.get('Discussion')).toEqual(record)

    peer.stop()
  })

  test('the owner republishes a record overwritten with garbage', async () => {
    const peer = await joinedOwner()
    peer.addRoom('Discussion')
    await flushPromises()
    const record = peer['y'].roomSigs.get('Discussion')

    await remoteChange(peer, (doc) =>
      doc.getMap('roomSigs').set('Discussion', { ...record, signature: 'AAAA' }))

    expect('Discussion' in (await peer.toJSON()).rooms).toBe(true)
    expect(peer['y'].roomSigs.get('Discussion')).toEqual(record)

    peer.stop()
  })

  test('a student keeps a deleted room in its view without writing it back', async () => {
    const owner = await joinedOwner()
    owner.addRoom('Discussion')
    await flushPromises()

    const student: any = new Peer(makeSetup(Utils.getPeerID(false)), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    student.role = 'student'
    student['lab'].data.createdBy = 'someone-else'
    student['lab'].data.members.teacher = [Utils.getPeerID(false)]
    Y.applyUpdate(student['y'].doc, Y.encodeStateAsUpdate(owner['y'].doc))
    for (let i = 0; i < 3; i++) await flushPromises()
    student.gotoRoom('Discussion')

    const writes: any[] = []
    student['y'].doc.on('update', (_u: Uint8Array, origin: any) => writes.push(origin))
    await remoteChange(student, (doc) => {
      doc.getMap('rooms').delete('Discussion')
      doc.getMap('roomSigs').delete('Discussion')
    })

    expect('Discussion' in (await student.toJSON()).rooms).toBe(true)
    expect(student['y'].roomSigs.has('Discussion')).toBe(false)
    expect(writes.filter((o) => o === 'republishRoom')).toEqual([])
    student['connected'] = true
    student['_leaveMissingRoom']()
    student['_leaveMissingRoom']()
    expect(student.user().room).toBe('Discussion')

    owner.stop()
    student.stop()
  })

  test('two teachers with different valid records for a room do not fight', async () => {
    const Teacher = await otherIdentity()
    const peer = await joinedOwner([Teacher.getPeerID(false)])
    peer.addRoom('Shared')
    await flushPromises()

    const theirs = await Teacher.signEntry('rooms', 'Shared', {})
    const writes: any[] = []
    peer['y'].doc.on('update', (_u: Uint8Array, origin: any) => writes.push(origin))
    await remoteChange(peer, (doc) => doc.getMap('roomSigs').set('Shared', theirs))

    expect(peer['y'].roomSigs.get('Shared')).toEqual(theirs)
    expect(writes.filter((o) => o === 'republishRoom')).toEqual([])
    expect('Shared' in (await peer.toJSON()).rooms).toBe(true)

    peer.stop()
  })

  test('a record that arrives before the setup shows once the owner is known', async () => {
    await Utils.initCryptoIdentity()
    const owner = Utils.getPeerID(false)
    const record = await Utils.signEntry('rooms', 'Early', {})

    const peer: any = new Peer(makeSetup(''), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    await remoteChange(peer, (doc) => {
      doc.getMap('rooms').set('Early', new Y.Map())
      doc.getMap('roomSigs').set('Early', record)
    })
    expect('Early' in (await peer.toJSON()).rooms).toBe(false)

    peer['lab'].data.createdBy = owner
    peer['_reverifyAfterSetup']()
    await flushPromises()
    expect('Early' in (await peer.toJSON()).rooms).toBe(true)

    peer.stop()
  })

  // A station and a participant, both run by the owner, with the station's
  // doc updates and presence relayed to the participant.
  async function stationWithParticipant() {
    await Utils.initCryptoIdentity()
    const owner = Utils.getPeerID(false)

    const station: any = new Peer(makeSetup(owner), 'stn1', i18n.global.t)
    const participant: any = new Peer(makeSetup(owner), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()

    const from = station['presence']['awareness']
    const to = participant['presence']['awareness']
    from.on('update', ({ added, updated, removed }: any) => {
      const changed = added.concat(updated, removed)
      applyAwarenessUpdate(to, encodeAwarenessUpdate(from, changed), 'relay')
    })
    station['y'].doc.on('update', (u: Uint8Array) => Y.applyUpdate(participant['y'].doc, u, 'relay'))
    Y.applyUpdate(participant['y'].doc, Y.encodeStateAsUpdate(station['y'].doc), 'relay')

    await station.join('station')
    await participant.join('student')
    participant['connected'] = true
    for (let i = 0; i < 4; i++) await flushPromises()

    const view = await participant.toJSON()
    expect('Station stn1' in view.rooms).toBe(true)
    expect(view.users['Station stn1']).toMatchObject({ role: 'station', room: 'Station stn1' })
    return { station, participant }
  }

  test('a stopped station disappears everywhere and its visitors move to Lobby', async () => {
    const { station, participant } = await stationWithParticipant()
    participant.gotoRoom('Station stn1')

    station.stop()
    for (let i = 0; i < 3; i++) await flushPromises()
    // Past the absence grace a removed entry must outlast.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + ABSENT_GRACE + 1)
    participant['presence'].reauthorize()
    vi.useRealTimers()

    let view = await participant.toJSON()
    expect(view.users['Station stn1']).toBeUndefined()
    // It may be reloading: visitors wait for it a while, still seeing its room.
    expect(participant.user().room).toBe('Station stn1')
    expect('Station stn1' in view.rooms).toBe(true)

    const { STATION_RETURN_GRACE } = await import('../../../../src/ts/Peer')
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + STATION_RETURN_GRACE + 1)
    participant['_leaveMissingRoom']()
    vi.useRealTimers()
    expect(participant.user().room).toBe('Lobby')
    for (let i = 0; i < 3; i++) await flushPromises()
    view = await participant.toJSON()
    expect('Station stn1' in view.rooms).toBe(false)

    participant.stop()
  })

  test("another peer in a stopped station's room is shown in the Lobby", async () => {
    const { station, participant } = await stationWithParticipant()

    // A second participant (same owner, another session) inside the station.
    const otherId = Utils.getPeerID(false) + '_other1'
    const payload = { room: 'Station stn1', dateJoined: 1, handRaised: false }
    const envelope = await Utils.signEntry('users', otherId, payload, Date.now())
    const other = new Awareness(new Y.Doc())
    other.setLocalStateField('presence', { id: otherId, payload, envelope })
    applyAwarenessUpdate(
      participant['presence']['awareness'],
      encodeAwarenessUpdate(other, [other.clientID]),
      'relay'
    )
    for (let i = 0; i < 3; i++) await flushPromises()
    expect((await participant.toJSON()).users[otherId].room).toBe('Station stn1')

    participant.gotoRoom('Station stn1')
    // Only the view rule here; leaving the missing room is tested elsewhere.
    participant['_leaveMissingRoom'] = () => {}
    station.stop()
    for (let i = 0; i < 3; i++) await flushPromises()

    const view = await participant.toJSON()
    expect('Station stn1' in view.rooms).toBe(false)
    expect(view.users[otherId].room).toBe('Lobby')
    // Our own room is left for _leaveMissingRoom to change.
    expect(view.users[participant.peerID].room).toBe('Station stn1')

    other.destroy()
    participant.stop()
  })

  test("deleting a present station's room from the doc does not remove it from the view", async () => {
    const { station, participant } = await stationWithParticipant()

    const attackerDoc = new Y.Doc()
    Y.applyUpdate(attackerDoc, Y.encodeStateAsUpdate(participant['y'].doc))
    attackerDoc.transact(() => {
      attackerDoc.getMap('rooms').delete('Station stn1')
      attackerDoc.getMap('roomSigs').delete('Station stn1')
    })
    Y.applyUpdate(participant['y'].doc, Y.encodeStateAsUpdate(attackerDoc))
    for (let i = 0; i < 3; i++) await flushPromises()

    expect('Station stn1' in (await participant.toJSON()).rooms).toBe(true)

    station.stop()
    participant.stop()
    attackerDoc.destroy()
  })
})
