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
