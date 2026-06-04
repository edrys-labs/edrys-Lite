import { describe, test, expect, beforeEach, vi } from 'vitest'
import * as Y from 'yjs'
import { i18n } from '../../setup'

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

describe('Signed y.chat', () => {
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

  test('entry from unknown signer (not in y.users) is filtered', async () => {
    const { peer } = await bootPeer()

    // Manually craft a signed entry using a different identity
    vi.resetModules()
    const Utils3 = await import('../../../src/ts/Utils')
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
})
