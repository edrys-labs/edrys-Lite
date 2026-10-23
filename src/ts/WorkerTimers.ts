/**
 * Runs the page's setTimeout/setInterval inside a Web Worker.
 *
 * Chrome throttles timers of a hidden tab to one wake-up per minute, but not a
 * dedicated worker's. Presence re-signs, heartbeats and awareness renewals all
 * run on timers and peers time them out well under a minute, so without this a
 * station left in a background tab keeps dropping out for everyone else.
 *
 * The worker only keeps time; callbacks still run on the page, triggered by the
 * worker's messages (which are not throttled).
 */

const WORKER_SRC = `
const timers = new Map()
onmessage = ({ data: { op, id, ms } }) => {
  if (op === 'clear') {
    clearTimeout(timers.get(id))
    timers.delete(id)
  } else if (op === 'interval') {
    timers.set(id, setInterval(() => postMessage(id), ms))
  } else {
    timers.set(id, setTimeout(() => { timers.delete(id); postMessage(id) }, ms))
  }
}
`

// Above any id the browser hands out, so clear*() can tell ours from native ones.
const FIRST_ID = 1e9

export interface TimerWorker {
  postMessage(msg: any): void
  onmessage: ((e: { data: any }) => void) | null
  onerror: ((e: any) => void) | null
  terminate(): void
}

function createWorker(): TimerWorker {
  const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))
  try {
    return new Worker(url) as unknown as TimerWorker
  } finally {
    URL.revokeObjectURL(url)
  }
}

let uninstall: (() => void) | null = null

/**
 * Replace the global timers with worker-backed ones. Returns a function that
 * restores the originals, or null if no worker could be created (the native
 * timers then stay in place).
 */
export function installWorkerTimers(
  makeWorker: () => TimerWorker = createWorker
): (() => void) | null {
  if (uninstall) return uninstall
  if (typeof Worker === 'undefined' && makeWorker === createWorker) return null

  let worker: TimerWorker
  try {
    worker = makeWorker()
  } catch {
    return null
  }

  const g = globalThis as any
  const native = {
    setTimeout: g.setTimeout,
    setInterval: g.setInterval,
    clearTimeout: g.clearTimeout,
    clearInterval: g.clearInterval,
  }
  const pending = new Map<number, { fn: Function; args: any[]; ms: number; repeat: boolean }>()
  // Once the worker failed: our id -> the native timer that took over.
  const moved = new Map<number, any>()
  let failed = false
  let nextId = FIRST_ID

  worker.onmessage = ({ data: id }) => {
    const timer = pending.get(id)
    if (!timer) return
    if (!timer.repeat) pending.delete(id)
    timer.fn(...timer.args)
  }

  const schedule = (repeat: boolean) =>
    function (fn: any, ms?: number, ...args: any[]) {
      // String handlers (eval) aren't worth supporting.
      if (failed || typeof fn !== 'function') {
        return (repeat ? native.setInterval : native.setTimeout).call(g, fn, ms, ...args)
      }
      const id = nextId++
      ms = Math.max(0, Number(ms) || 0)
      pending.set(id, { fn, args, ms, repeat })
      worker.postMessage({ op: repeat ? 'interval' : 'timeout', id, ms })
      return id
    }

  const clear = (nativeClear: Function) =>
    function (id: any) {
      if (pending.delete(id)) worker.postMessage({ op: 'clear', id })
      else if (moved.has(id)) {
        nativeClear.call(g, moved.get(id))
        moved.delete(id)
      } else if (typeof id !== 'number' || id < FIRST_ID) nativeClear.call(g, id)
    }

  g.setTimeout = schedule(false)
  g.setInterval = schedule(true)
  g.clearTimeout = clear(native.clearTimeout)
  g.clearInterval = clear(native.clearInterval)

  uninstall = () => {
    Object.assign(g, native)
    worker.onmessage = worker.onerror = null
    worker.terminate()
    pending.clear()
    uninstall = null
  }

  // A worker that fails (e.g. blocked by a CSP) never fires: hand everything
  // still pending to the native timers, and from then on schedule natively.
  // The callers still hold our ids, so clear*() keeps translating them.
  worker.onerror = () => {
    failed = true
    worker.onmessage = worker.onerror = null
    worker.terminate()
    for (const [id, t] of pending) {
      moved.set(
        id,
        t.repeat
          ? native.setInterval.call(g, t.fn, t.ms, ...t.args)
          : native.setTimeout.call(
              g,
              () => {
                moved.delete(id)
                t.fn(...t.args)
              },
              t.ms
            )
      )
    }
    pending.clear()
  }

  return uninstall
}
