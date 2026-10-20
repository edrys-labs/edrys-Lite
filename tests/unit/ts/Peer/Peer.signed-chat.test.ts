import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import { i18n } from '../../../setup'

// y.chat signing integration tests.
// Real WebCrypto (via real Utils), mocked Database (fresh identity per test),
// mocked providers (no network).

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

describe('Signed y.chat', () => {
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

  async function bootPeer() {
    await Utils.initCryptoIdentity()
    const pubKey = Utils.getPeerID(false)
    const peer: any = new Peer(makeSetup(pubKey), undefined, i18n.global.t)
    await flushPromises()
    await flushPromises()
    peer.initChat()
    await flushPromises()
    return { peer, pubKey }
  }

  test('sendMessage pushes an entry with signer and signature fields', async () => {
    const { peer } = await bootPeer()

    await peer.sendMessage('hello')
    await flushPromises()

    const entry = peer['y'].chat.get(0)
    expect(entry).toBeDefined()
    expect(entry.msg).toBe('hello')
    expect(typeof entry.signer).toBe('string')
    expect(typeof entry.signature).toBe('string')
    expect(typeof entry.timestamp).toBe('number')

    peer.stop()
  })

  test('sendMessage entry passes verifyEntry', async () => {
    const { peer } = await bootPeer()

    await peer.sendMessage('verified?')
    await flushPromises()

    const entry = peer['y'].chat.get(0) as any
    const envelope = { signer: entry.signer, nonce: entry.timestamp, signature: entry.signature }
    const payload = { msg: entry.msg, timestamp: entry.timestamp, user: entry.user }
    const valid = await Utils.verifyEntry('chat', String(entry.timestamp), payload, envelope)
    expect(valid).toBe(true)

    peer.stop()
  })

  test('each inserted entry is verified once, however often initChat/join run', async () => {
    const { peer } = await bootPeer()
    peer.initChat()
    await peer.join('student')
    const verify = vi.spyOn(peer, '_verifyChatEntry')

    await peer.sendMessage('once')
    await flushPromises()

    expect(verify).toHaveBeenCalledTimes(1)
    peer.stop()
  })

  test('valid signed message appears in update("chat") output', async () => {
    const { peer } = await bootPeer()

    let chatMessages: any[] | null = null
    peer.on('chat', (data: any) => { chatMessages = data.messages })

    await peer.sendMessage('visible')
    await flushPromises()
    await flushPromises()

    expect(chatMessages).not.toBeNull()
    expect(chatMessages!.length).toBe(1)
    expect(chatMessages![0].msg).toBe('visible')

    peer.stop()
  })

  test('unsigned entry (missing signer/signature) is filtered from output', async () => {
    const { peer } = await bootPeer()

    let chatMessages: any[] | null = null
    peer.on('chat', (data: any) => { chatMessages = data.messages })

    // Raw push without signing
    peer['y'].doc.transact(() => {
      peer['y'].chat.push([{ timestamp: Date.now(), user: 'attacker', msg: 'spoof' }])
    }, 'test-raw')
    await flushPromises()
    await flushPromises()

    expect(chatMessages).not.toBeNull()
    expect(chatMessages!.length).toBe(0)

    peer.stop()
  })

  test('entry with tampered msg is filtered (sig mismatch)', async () => {
    const { peer } = await bootPeer()

    let chatMessages: any[] | null = null
    peer.on('chat', (data: any) => { chatMessages = data.messages })

    await peer.sendMessage('original')
    await flushPromises()

    const raw = peer['y'].chat.get(0) as any
    // Build a second doc and inject the entry with tampered msg but same sig
    const doc2 = new Y.Doc()
    const chat2 = doc2.getArray('chat')
    doc2.transact(() => {
      chat2.push([{ ...raw, msg: 'tampered' }])
    })
    Y.applyUpdate(peer['y'].doc, Y.encodeStateAsUpdate(doc2))
    await flushPromises()
    await flushPromises()

    // The tampered entry lands at index 1 (the signed original stays at 0)
    const filtered = chatMessages!.filter((m) => m.msg === 'tampered')
    expect(filtered.length).toBe(0)

    peer.stop()
  })

  test('entry from unknown signer (not present) is filtered', async () => {
    const { peer } = await bootPeer()

    // Manually craft a signed entry using a different identity
    vi.resetModules()
    const Utils3 = await import('../../../../src/ts/Utils')
    await Utils3.initCryptoIdentity()
    const ts = Date.now()
    const payload = { msg: 'infiltrate', timestamp: ts, user: 'stranger' }
    const env = await Utils3.signEntry('chat', String(ts), payload, ts)

    let chatMessages: any[] | null = null
    peer.on('chat', (data: any) => { chatMessages = data.messages })

    peer['y'].doc.transact(() => {
      peer['y'].chat.push([{
        timestamp: ts,
        user: 'stranger',
        msg: 'infiltrate',
        signer: env.signer,
        signature: env.signature,
      }])
    }, 'test-stranger')
    await flushPromises()
    await flushPromises()

    expect(chatMessages!.filter((m: any) => m.msg === 'infiltrate').length).toBe(0)

    peer.stop()
  })

  test('a held-back entry shows once its signer becomes present', async () => {
    const { peer } = await bootPeer()

    vi.resetModules()
    const Writer = await import('../../../../src/ts/Utils')
    await Writer.initCryptoIdentity()
    const ts = Date.now()
    const payload = { msg: 'before you arrived', timestamp: ts, user: 'writer' }
    const env = await Writer.signEntry('chat', String(ts), payload, ts)

    let chatMessages: any[] = []
    peer.on('chat', (data: any) => { chatMessages = data.messages })

    // The chat arrives with the doc, before the writer's presence.
    peer['y'].doc.transact(() => {
      peer['y'].chat.push([{ ...payload, signer: env.signer, signature: env.signature }])
    }, 'sync')
    await flushPromises()
    await flushPromises()
    expect(chatMessages.map((m) => m.msg)).toEqual([])

    const id = `${env.signer}_s1`
    const presence = { id, payload: { room: 'Lobby' }, envelope: await Writer.signEntry('users', id, { room: 'Lobby' }) }
    const clientID = 777
    applyAwarenessUpdate(
      peer['presence']['awareness'],
      encodeAwarenessUpdate(
        { states: new Map([[clientID, { presence }]]), meta: new Map([[clientID, { clock: 1, lastUpdated: Date.now() }]]) } as any,
        [clientID]
      ),
      'remote'
    )
    await flushPromises()
    await flushPromises()

    expect(chatMessages.map((m) => m.msg)).toEqual(['before you arrived'])

    peer.stop()
  })

  test('a ten-minute-old message still shows', async () => {
    const { peer } = await bootPeer()
    let chatMessages: any[] = []
    peer.on('chat', (data: any) => { chatMessages = data.messages })

    const ts = Date.now() - 10 * 60 * 1000
    const payload = { msg: 'from ten minutes ago', timestamp: ts, user: 'me' }
    const env = await Utils.signEntry('chat', String(ts), payload, ts)
    peer['y'].doc.transact(() => {
      peer['y'].chat.push([{ ...payload, signer: env.signer, signature: env.signature }])
    }, 'sync')
    await flushPromises()
    await flushPromises()

    expect(chatMessages.map((m) => m.msg)).toEqual(['from ten minutes ago'])
    peer.stop()
  })

  test('a replayed copy of a signed message is hidden', async () => {
    const { peer } = await bootPeer()
    let chatMessages: any[] = []
    peer.on('chat', (data: any) => { chatMessages = data.messages })

    await peer.sendMessage('once')
    await flushPromises()
    const original = { ...peer['y'].chat.get(0) }
    peer['y'].doc.transact(() => peer['y'].chat.push([original]), 'replay')
    await flushPromises()
    await flushPromises()

    expect(peer['y'].chat.length).toBe(2)
    expect(chatMessages.map((m) => m.msg)).toEqual(['once'])
    peer.stop()
  })

  test('a replayed copy with a re-encoded signature is hidden too', async () => {
    const { peer } = await bootPeer()
    let chatMessages: any[] = []
    peer.on('chat', (data: any) => { chatMessages = data.messages })

    await peer.sendMessage('once')
    await flushPromises()
    const original = peer['y'].chat.get(0)
    // atob ignores whitespace: same signature bytes, different string
    const copy = { ...original, signature: ' ' + original.signature }
    peer['y'].doc.transact(() => peer['y'].chat.push([copy]), 'replay')
    await flushPromises()
    await flushPromises()

    expect(peer['y'].chat.length).toBe(2)
    expect(chatMessages.map((m) => m.msg)).toEqual(['once'])
    peer.stop()
  })
})
