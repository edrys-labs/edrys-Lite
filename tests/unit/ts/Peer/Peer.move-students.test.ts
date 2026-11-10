import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { i18n } from '../../../setup'

// "Only teachers can move students": the lock on our own room changes.
// Real Utils (real WebCrypto), mocked Database and providers (no network).

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 10))

const mockDb = {
  getPublicKeyRaw: vi.fn().mockResolvedValue(null),
  getPrivateKey: vi.fn().mockResolvedValue(null),
  setPublicKeyRaw: vi.fn().mockResolvedValue(undefined),
  setPrivateKey: vi.fn().mockResolvedValue(undefined),
  getMigrationDone: vi.fn().mockResolvedValue(true),
  setMigrationDone: vi.fn().mockResolvedValue(undefined),
}

const adapter = () => ({
  on: vi.fn(),
  onLeave: vi.fn(),
  onMessage: vi.fn(),
  sendMessage: vi.fn(),
  disconnect: vi.fn(),
  destroy: vi.fn(),
  getPresenceAwareness: vi.fn(() => new Awareness(new Y.Doc())),
  getAwareness: vi.fn(function (this: any) { return (this._app ??= new Awareness(new Y.Doc())) }),
})

vi.mock('../../../../src/ts/Database', () => ({ Database: vi.fn(() => mockDb) }))
vi.mock('secure-ls', () => ({
  default: vi.fn().mockImplementation(() => ({ get: vi.fn(), set: vi.fn(), remove: vi.fn() })),
}))
vi.mock('../../../../src/api/debugHandler', () => ({
  debug: { ts: { peer: vi.fn() } },
}))
vi.mock('../../../../src/ts/GenericProviderAdapter', () => ({
  GenericWebrtcProviderAdapter: vi.fn().mockImplementation(adapter),
}))
vi.mock('../../../../src/ts/GenericWebsocketProviderAdapter', () => ({
  GenericWebsocketProviderAdapter: vi.fn().mockImplementation(adapter),
}))

describe('Teacher moves students: lock', () => {
  let Peer: any
  let Utils: any

  beforeEach(async () => {
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    Utils = await import('../../../../src/ts/Utils')
    Peer = (await import('../../../../src/ts/Peer')).default
  })

  const OTHER_OWNER = 'b'.repeat(43) + '='

  function makeSetup(createdBy: string, teacherMovesStudents: boolean, timestamp = Date.now()) {
    return {
      id: 'lab1',
      data: {
        meta: { defaultNumberOfRooms: 2, teacherMovesStudents },
        members: { teacher: [], student: [] },
        createdBy,
      },
      timestamp,
      hash: null,
    }
  }

  async function joined(createdBy: string, setting: boolean, role = 'student') {
    await Utils.initCryptoIdentity()
    const peer: any = new Peer(makeSetup(createdBy, setting), undefined, i18n.global.t)
    await flushPromises()
    await peer.join(role)
    await flushPromises()
    peer.connected = true
    return peer
  }

  test('a student can change rooms while the setting is off', async () => {
    const peer = await joined(OTHER_OWNER, false)
    expect(peer.isLocked()).toBe(false)
    peer.gotoRoom('Room 1')
    expect(peer.user().room).toBe('Room 1')
    peer.stop()
  })

  test('a student stays put while the setting is on', async () => {
    const peer = await joined(OTHER_OWNER, true)
    expect(peer.isLocked()).toBe(true)
    peer.gotoRoom('Room 1')
    expect(peer.user().room).toBe('Lobby')
    peer.stop()
  })

  test('teachers, stations and the owner are not locked', async () => {
    const teacher = await joined(OTHER_OWNER, true, 'teacher')
    expect(teacher.isLocked()).toBe(false)
    teacher.gotoRoom('Room 1')
    expect(teacher.user().room).toBe('Room 1')
    teacher.stop()

    const station = await joined(OTHER_OWNER, true, 'station')
    expect(station.isLocked()).toBe(false)
    station.stop()

    await Utils.initCryptoIdentity()
    const owner = await joined(Utils.getPeerID(false), true)
    expect(owner.isLocked()).toBe(false)
    owner.gotoRoom('Room 1')
    expect(owner.user().room).toBe('Room 1')
    owner.stop()
  })

  test('the lock follows the setting when a new setup arrives', async () => {
    const peer = await joined(OTHER_OWNER, false)
    expect(peer.isLocked()).toBe(false)
    peer.newSetup(makeSetup(OTHER_OWNER, true, Date.now() + 1))
    expect(peer.isLocked()).toBe(true)
    peer.newSetup(makeSetup(OTHER_OWNER, false, Date.now() + 2))
    expect(peer.isLocked()).toBe(false)
    peer.stop()
  })

  test('a locked student still leaves a room that is gone', async () => {
    const peer = await joined(OTHER_OWNER, false)
    peer.gotoRoom('Room 2')
    peer._leaveMissingRoom(false) // sees Room 2 in the view
    peer.newSetup(makeSetup(OTHER_OWNER, true, Date.now() + 1))

    const fewer = makeSetup(OTHER_OWNER, true, Date.now() + 2)
    fewer.data.meta.defaultNumberOfRooms = 1
    peer.newSetup(fewer)
    await flushPromises()

    expect(peer.isLocked()).toBe(true)
    expect(peer.user().room).toBe('Lobby')
    peer.stop()
  })
})

describe('Teacher moves students: moves', () => {
  let Peer: any
  let Utils: any

  beforeEach(async () => {
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    Utils = await import('../../../../src/ts/Utils')
    Peer = (await import('../../../../src/ts/Peer')).default
  })

  /** A key of its own, the tab id it sends from, and a signer for its messages. */
  async function sender() {
    vi.resetModules()
    const Other = await import('../../../../src/ts/Utils')
    await Other.initCryptoIdentity()
    const key = Other.getPeerID(false)
    const sign = async (msg: any) => ({
      ...msg,
      envelope: await Other.signEntry('messages', msg.from, JSON.parse(JSON.stringify(msg)), Date.now()),
    })
    return { key, id: `${key}_t1`, sign }
  }

  /** The student, in a class owned by `owner` with `teachers`, and the moves it reports. */
  async function student(owner: string, setting = true, teachers: string[] = []) {
    await Utils.initCryptoIdentity()
    const setup = {
      id: 'lab1',
      data: {
        meta: { defaultNumberOfRooms: 2, teacherMovesStudents: setting },
        members: { teacher: teachers, student: [] },
        createdBy: owner,
      },
      timestamp: Date.now(),
      hash: null,
    }
    const peer: any = new Peer(setup, undefined, i18n.global.t)
    await flushPromises()
    await peer.join('student')
    await flushPromises()
    peer.connected = true
    const moved: string[] = []
    peer.on('moved', (room: string) => moved.push(room))
    return { peer, moved }
  }

  /** Makes `id` present in the peer's view, as its signed presence would. */
  const present = (peer: any, id: string, room = 'Lobby') => {
    peer.presence._visible = { ...peer.presence.visible, [id]: { room } }
  }

  async function receive(peer: any, msg: any) {
    peer['_receive'](JSON.parse(JSON.stringify(msg)))
    await peer['_receiveQueue']
  }

  const move = (from: string, to: string, room: string) => ({ from, user: to, move: room, room: 'Lobby' })

  test('a locked student follows a move from the owner, and says so', async () => {
    const teacher = await sender()
    const { peer, moved } = await student(teacher.key)
    present(peer, teacher.id)

    await receive(peer, await teacher.sign(move(teacher.id, peer.peerID, 'Room 2')))

    expect(peer.user().room).toBe('Room 2')
    expect(moved).toEqual(['Room 2'])
    peer.stop()
  })

  test('a move from a listed teacher works too', async () => {
    const teacher = await sender()
    const { peer } = await student('b'.repeat(43) + '=', true, [teacher.key])
    present(peer, teacher.id)

    await receive(peer, await teacher.sign(move(teacher.id, peer.peerID, 'Room 1')))

    expect(peer.user().room).toBe('Room 1')
    peer.stop()
  })

  test('a move from another student or a station is ignored', async () => {
    const other = await sender()
    const { peer, moved } = await student('b'.repeat(43) + '=')
    present(peer, other.id)
    await receive(peer, await other.sign(move(other.id, peer.peerID, 'Room 1')))

    const station = 'Station ' + other.key
    present(peer, station)
    await receive(peer, await other.sign(move(station, peer.peerID, 'Room 1')))

    expect(peer.user().room).toBe('Lobby')
    expect(moved).toEqual([])
    peer.stop()
  })

  test('a move from a teacher who is not present is ignored', async () => {
    const teacher = await sender()
    const { peer } = await student(teacher.key)

    await receive(peer, await teacher.sign(move(teacher.id, peer.peerID, 'Room 1')))

    expect(peer.user().room).toBe('Lobby')
    peer.stop()
  })

  test('a move to a room that does not exist is ignored', async () => {
    const teacher = await sender()
    const { peer, moved } = await student(teacher.key)
    present(peer, teacher.id)

    await receive(peer, await teacher.sign(move(teacher.id, peer.peerID, 'Room 9')))
    await receive(peer, await teacher.sign({ ...move(teacher.id, peer.peerID, ''), move: { room: 'Room 1' } }))

    expect(peer.user().room).toBe('Lobby')
    expect(moved).toEqual([])
    peer.stop()
  })

  test('a move is ignored while the setting is off', async () => {
    const teacher = await sender()
    const { peer, moved } = await student(teacher.key, false)
    present(peer, teacher.id)

    await receive(peer, await teacher.sign(move(teacher.id, peer.peerID, 'Room 1')))

    expect(peer.user().room).toBe('Lobby')
    expect(moved).toEqual([])
    peer.stop()
  })

  test('a move addressed to another tab, edited or unsigned is ignored', async () => {
    const teacher = await sender()
    const { peer } = await student(teacher.key)
    present(peer, teacher.id)

    await receive(peer, await teacher.sign(move(teacher.id, 'someone_s1', 'Room 1')))
    await receive(peer, { ...(await teacher.sign(move(teacher.id, peer.peerID, 'Room 1'))), move: 'Room 2' })
    await receive(peer, move(teacher.id, peer.peerID, 'Room 1'))

    expect(peer.user().room).toBe('Lobby')
    peer.stop()
  })

  test('a move never reaches the modules', async () => {
    const teacher = await sender()
    const { peer } = await student(teacher.key)
    present(peer, teacher.id)
    const delivered: any[] = []
    peer.on('message', (msg: any) => delivered.push(msg))

    await receive(peer, await teacher.sign(move(teacher.id, peer.peerID, 'Room 1')))

    expect(delivered).toEqual([])
    peer.stop()
  })

  test('moveUser sends a signed move to each tab of that user, not to others', async () => {
    await Utils.initCryptoIdentity()
    const owner = Utils.getPeerID(false)
    const teacher: any = new Peer(
      { id: 'lab1', data: { meta: { defaultNumberOfRooms: 2, teacherMovesStudents: true }, members: { teacher: [], student: [] }, createdBy: owner }, timestamp: Date.now(), hash: null },
      undefined, i18n.global.t
    )
    await flushPromises()
    await teacher.join('teacher')
    await flushPromises()
    teacher.connected = true
    const key = 'c'.repeat(43) + '='
    for (const id of [`${key}_a`, `${key}_b`, `${'d'.repeat(43)}=_a`, `Station ${key}`]) present(teacher, id)

    teacher.moveUser(`${key}_a`, 'Room 1')
    await teacher['_sendQueue']

    const sent = teacher.provider.sendMessage.mock.calls
    expect(sent.map(([, to]: any) => to).sort()).toEqual([`${key}_a`, `${key}_b`])
    for (const [msg, to] of sent) {
      expect(msg).toMatchObject({ from: teacher.peerID, user: to, move: 'Room 1' })
      expect(msg.envelope.signer).toBe(owner)
    }
    teacher.stop()
  })
})
