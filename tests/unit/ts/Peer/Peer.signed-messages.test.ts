import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { i18n } from '../../../setup'

// Module message signing integration tests.
// Real WebCrypto (via real Utils), mocked Database (fresh identity per test),
// mocked providers (no network). Received messages are fed to `_receive` as
// the provider would.

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
  })),
}))

describe('Signed module messages', () => {
  let Peer: any
  let Utils: any

  beforeEach(async () => {
    vi.resetModules()
    mockDb.getPublicKeyRaw.mockResolvedValue(null)
    mockDb.getPrivateKey.mockResolvedValue(null)
    Utils = await import('../../../../src/ts/Utils')
    Peer = (await import('../../../../src/ts/Peer')).default
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

  /** The receiving peer (the class owner), and what reaches its modules. */
  async function bootPeer() {
    await Utils.initCryptoIdentity()
    const peer: any = new Peer(makeSetup(Utils.getPeerID(false)), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    const delivered: any[] = []
    peer.on('message', (msg: any) => delivered.push(msg))
    return { peer, delivered }
  }

  /** Another participant: its own key, and a signer for messages as it would send them. */
  async function otherPeer() {
    vi.resetModules()
    const Other = await import('../../../../src/ts/Utils')
    await Other.initCryptoIdentity()
    const id = `${Other.getPeerID(false)}_s1`
    const sign = async (msg: any, nonce = Date.now()) => ({
      ...msg,
      envelope: await Other.signEntry('messages', msg.from, JSON.parse(JSON.stringify(msg)), nonce),
    })
    return { id, sign }
  }

  async function receive(peer: any, msg: any) {
    peer['_receive'](JSON.parse(JSON.stringify(msg)))
    await peer['_receiveQueue']
  }

  /** A room message from `from` to the receiver's room. */
  const toRoom = (peer: any, from: string, body: any) =>
    ({ from, subject: 's', body, room: peer.user().room })

  test('a message signed for its sender reaches the modules', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()

    await receive(peer, { ...(await other.sign({ ...toRoom(peer, other.id, { n: 1 }), module: 'm' })), id: 'x1' })

    expect(delivered.map((m) => m.body)).toEqual([{ n: 1 }])
    peer.stop()
  })

  test('a message that claims another sender is dropped', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()

    await receive(peer, await other.sign(toRoom(peer, peer.peerID, 'as owner')))

    expect(delivered).toEqual([])
    peer.stop()
  })

  test('an unsigned message is dropped', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()

    await receive(peer, toRoom(peer, other.id, 'unsigned'))

    expect(delivered).toEqual([])
    peer.stop()
  })

  test('a message with an edited body is dropped', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()

    await receive(peer, { ...(await other.sign(toRoom(peer, other.id, 'original'))), body: 'edited' })

    expect(delivered).toEqual([])
    peer.stop()
  })

  test('a message for another room is dropped, also when re-addressed', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()
    const signed = await other.sign({ from: other.id, subject: 's', body: 'room 1', room: 'Room 1' })

    await receive(peer, signed)
    await receive(peer, { ...signed, room: peer.user().room })

    expect(delivered).toEqual([])
    peer.stop()
  })

  test('a message addressed to another user is dropped', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()

    await receive(peer, await other.sign({ ...toRoom(peer, other.id, 'for x'), user: 'x_s1' }))
    await receive(peer, await other.sign({ ...toRoom(peer, other.id, 'for us'), user: peer.peerID }))

    expect(delivered.map((m) => m.body)).toEqual(['for us'])
    peer.stop()
  })

  test('a replayed message is delivered once, also with a new transport id', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()
    const signed = await other.sign(toRoom(peer, other.id, 'once'))

    await receive(peer, { ...signed, id: 'a' })
    await receive(peer, { ...signed, id: 'b' })

    expect(delivered.map((m) => m.body)).toEqual(['once'])
    peer.stop()
  })

  test('a replayed message is delivered once, also with a re-encoded signature', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()
    const signed = await other.sign(toRoom(peer, other.id, 'once'))
    const { signature } = signed.envelope

    await receive(peer, signed)
    // atob ignores whitespace and missing padding: same bytes, new strings
    await receive(peer, { ...signed, envelope: { ...signed.envelope, signature: ' ' + signature } })
    await receive(peer, { ...signed, envelope: { ...signed.envelope, signature: signature.replace(/=+$/, '') } })

    expect(delivered.map((m) => m.body)).toEqual(['once'])
    peer.stop()
  })

  test('a message signed long before the sender\'s newest is dropped', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()
    const now = Date.now()

    await receive(peer, await other.sign(toRoom(peer, other.id, 'new'), now))
    await receive(peer, await other.sign(toRoom(peer, other.id, 'old'), now - 120000))
    // out of order within the window is fine
    await receive(peer, await other.sign(toRoom(peer, other.id, 'late'), now - 1000))

    expect(delivered.map((m) => m.body)).toEqual(['new', 'late'])
    peer.stop()
  })

  test('an old message is dropped by a receiver that has seen nothing of its sender yet', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()

    await receive(peer, await other.sign(toRoom(peer, other.id, 'old'), Date.now() - 120000))

    expect(delivered).toEqual([])
    peer.stop()
  })

  test('the sender\'s presence nonce sets the window, on the sender\'s clock', async () => {
    const { peer, delivered } = await bootPeer()
    const other = await otherPeer()
    // the sender's clock runs ten minutes ahead
    const senderNow = Date.now() + 600000
    vi.spyOn(peer['presence'], 'nonceOf').mockImplementation((id: any) => (id === other.id ? senderNow : undefined))

    await receive(peer, await other.sign(toRoom(peer, other.id, 'old'), senderNow - 120000))
    await receive(peer, await other.sign(toRoom(peer, other.id, 'new'), senderNow))

    expect(delivered.map((m) => m.body)).toEqual(['new'])
    peer.stop()
  })

  test('a station may send with the owner\'s key, not with a student\'s', async () => {
    const { peer, delivered } = await bootPeer()
    const station = 'Station lab-pc'

    const byOwner = toRoom(peer, station, 'from the station')
    await receive(peer, { ...byOwner, envelope: await Utils.signEntry('messages', station, byOwner) })
    const other = await otherPeer()
    await receive(peer, await other.sign(toRoom(peer, station, 'from a student')))

    expect(delivered.map((m) => m.body)).toEqual(['from the station'])
    peer.stop()
  })

  test('broadcast signs what it sends, in call order, with rising nonces, and the addressee accepts it', async () => {
    const { peer, delivered } = await bootPeer()
    peer['connected'] = true
    const sendMessage = vi.mocked(peer['provider'].sendMessage)

    peer.broadcast('Lobby', { from: peer.peerID, subject: 's', body: 1, user: 'x_s1' })
    peer.broadcast('Lobby', { from: peer.peerID, subject: 's', body: 2, user: 'x_s1' })
    await peer['_sendQueue']

    const sent = sendMessage.mock.calls.map(([msg]: any[]) => msg)
    expect(sent.map((m: any) => m.body)).toEqual([1, 2])
    expect(sent[1].envelope.nonce).toBeGreaterThan(sent[0].envelope.nonce)
    // receive as the addressee
    peer.peerID = 'x_s1'
    for (const msg of sent) await receive(peer, msg)
    expect(delivered.map((m) => m.body)).toEqual([1, 2])
    peer.stop()
  })
})
