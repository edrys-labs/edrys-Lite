import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import * as Y from 'yjs'
import * as awarenessProtocol from 'y-protocols/awareness'

// A station in a hidden Chrome tab: its page timers wake at most once a
// minute, a worker's keep their pace. Real Utils (real WebCrypto) with a
// mocked Database, as in Presence.test.ts.

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

// Chrome's intensive throttling of a hidden tab.
const THROTTLED_WAKEUP = 60000

/** Relay every local change of `from` into `to`, like a transport would. */
function link(from: awarenessProtocol.Awareness, to: awarenessProtocol.Awareness) {
  from.on('update', ({ added, updated, removed }: any, origin: any) => {
    if (origin === 'remote') return
    awarenessProtocol.applyAwarenessUpdate(
      to,
      awarenessProtocol.encodeAwarenessUpdate(from, added.concat(updated, removed)),
      'remote'
    )
  })
}

/** Stand-in for the timer worker: keeps time with the given (unthrottled) timers. */
function fakeWorker(timers: { setInterval: any; setTimeout: any; clearInterval: any }) {
  const handles = new Map<number, any>()
  const w: any = {
    onmessage: null,
    onerror: null,
    terminate: vi.fn(() => handles.forEach((h) => timers.clearInterval(h))),
    postMessage: vi.fn(({ op, id, ms }: any) => {
      if (op === 'clear') {
        timers.clearInterval(handles.get(id))
        handles.delete(id)
      } else {
        const set = op === 'interval' ? timers.setInterval : timers.setTimeout
        handles.set(id, set(() => w.onmessage?.({ data: id }), ms))
      }
    }),
  }
  return w
}

describe('WorkerTimers', () => {
  let installWorkerTimers: any
  let uninstall: (() => void) | null = null

  beforeEach(async () => {
    vi.resetModules()
    ;({ installWorkerTimers } = await import('../../../src/ts/WorkerTimers'))
  })

  afterEach(() => {
    uninstall?.()
    uninstall = null
    vi.useRealTimers()
  })

  test('timers run through the worker and can be cleared', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const unthrottled = { setInterval, setTimeout, clearInterval }
    const worker = fakeWorker(unthrottled)
    uninstall = installWorkerTimers(() => worker)

    const every = vi.fn()
    const once = vi.fn()
    const iv = setInterval(every, 1000, 'a')
    setTimeout(once, 500, 'b')
    expect(worker.postMessage).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(3000)
    expect(every).toHaveBeenCalledTimes(3)
    expect(every).toHaveBeenCalledWith('a')
    expect(once).toHaveBeenCalledTimes(1)
    expect(once).toHaveBeenCalledWith('b')

    clearInterval(iv)
    vi.advanceTimersByTime(3000)
    expect(every).toHaveBeenCalledTimes(3)
  })

  test('uninstalling restores the native timers', () => {
    const before = globalThis.setInterval
    const worker = fakeWorker({ setInterval, setTimeout, clearInterval })
    const off = installWorkerTimers(() => worker)
    expect(globalThis.setInterval).not.toBe(before)
    off()
    expect(globalThis.setInterval).toBe(before)
    expect(worker.terminate).toHaveBeenCalled()
  })

  test('a worker that cannot be created leaves the native timers in place', () => {
    const before = globalThis.setTimeout
    expect(
      installWorkerTimers(() => {
        throw new Error('blocked')
      })
    ).toBeNull()
    expect(globalThis.setTimeout).toBe(before)
  })

  test('a failing worker hands pending timers back to the native ones', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const worker = fakeWorker({ setInterval: () => 0, setTimeout: () => 0, clearInterval: () => {} })
    uninstall = installWorkerTimers(() => worker)

    const every = vi.fn()
    const once = vi.fn()
    setInterval(every, 1000)
    setTimeout(once, 500)
    worker.onerror({})
    expect(worker.terminate).toHaveBeenCalled()
    vi.advanceTimersByTime(2000)
    expect(every).toHaveBeenCalledTimes(2)
    expect(once).toHaveBeenCalledTimes(1)

    // New timers go straight to the native ones.
    const later = vi.fn()
    setTimeout(later, 100)
    vi.advanceTimersByTime(100)
    expect(later).toHaveBeenCalledTimes(1)
    expect(worker.postMessage).toHaveBeenCalledTimes(2)
  })

  test('timers handed back after a worker failure can still be cleared by their old id', () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
    const worker = fakeWorker({ setInterval: () => 0, setTimeout: () => 0, clearInterval: () => {} })
    uninstall = installWorkerTimers(() => worker)

    const every = vi.fn()
    const once = vi.fn()
    const iv = setInterval(every, 1000)
    const to = setTimeout(once, 1500)
    worker.onerror({})

    vi.advanceTimersByTime(1000)
    expect(every).toHaveBeenCalledTimes(1)
    clearInterval(iv)
    clearTimeout(to)
    vi.advanceTimersByTime(5000)
    expect(every).toHaveBeenCalledTimes(1)
    expect(once).not.toHaveBeenCalled()
  })

  describe('a station in a hidden tab', () => {
    let SignedPresence: any
    let pub: string
    let awStation: awarenessProtocol.Awareness
    let awReader: awarenessProtocol.Awareness
    const started: any[] = []

    beforeEach(async () => {
      const Utils = await import('../../../src/ts/Utils')
      ;({ SignedPresence } = await import('../../../src/ts/Presence'))
      await Utils.initCryptoIdentity()
      pub = Utils.getPeerID(false)
      awStation = new awarenessProtocol.Awareness(new Y.Doc())
      awReader = new awarenessProtocol.Awareness(new Y.Doc())
      link(awStation, awReader)
      link(awReader, awStation)
    })

    afterEach(() => {
      for (const p of started.splice(0)) p.stop()
      awStation.destroy()
      awReader.destroy()
    })

    /**
     * Start a reader in a visible tab, then throttle the page's timers the
     * way Chrome does for the hidden station tab (optionally with the worker
     * timers installed), start the station and run for five minutes.
     * Returns about how many seconds the reader did not see the station.
     */
    async function runHiddenStation(withWorkerTimers: boolean): Promise<number> {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
      const unthrottled = { setInterval, setTimeout, clearInterval }
      const id = `${pub}_station`
      const reader = new SignedPresence(awReader, `${pub}_reader`, () => true, () => {})
      started.push(reader)

      const g = globalThis as any
      g.setInterval = (fn: any, ms: number, ...a: any[]) =>
        unthrottled.setInterval(fn, Math.max(ms, THROTTLED_WAKEUP), ...a)
      if (withWorkerTimers) uninstall = installWorkerTimers(() => fakeWorker(unthrottled))

      try {
        const station = new SignedPresence(awStation, id, () => true, () => {})
        started.push(station)
        await station.publish({ room: id })
        await settle()

        let hiddenFor = 0
        for (let s = 0; s < 300; s += 5) {
          vi.advanceTimersByTime(5000)
          await settle()
          if (!reader.has(id)) hiddenFor += 5
        }
        return hiddenFor
      } finally {
        uninstall?.()
        uninstall = null
        g.setInterval = unthrottled.setInterval
      }
    }

    test('without worker timers it keeps dropping out (the bug)', async () => {
      expect(await runHiddenStation(false)).toBeGreaterThan(0)
    }, 30000)

    test('with worker timers it stays visible the whole time', async () => {
      expect(await runHiddenStation(true)).toBe(0)
    }, 30000)
  })
})
