/**
 * Dev mode: the page is served by edrys-dev, which watches a lab file on disk.
 * That file is the source of truth: the tab opened with `?dev` imports it as a
 * class owned by this browser's key and, through the normal saveClass path
 * (signed), republishes it whenever the file changes.
 *
 * edrys-dev endpoints (same origin):
 *   GET  /edrys-dev/lab     { path, text, communication?, tutor?, studentSite? }
 *   GET  /edrys-dev/events  server-sent events, `reload-lab` when the file changed,
 *                           `tutor-answer` for a student's question
 *   POST /edrys-dev/bridge  JSON reports from this tab
 */
import { Database } from './Database'
import {
  infoHash,
  getPeerID,
  getShortPeerID,
  hashPubKey,
  sameKey,
  parse,
  normalizeClassroom,
  encodeCommConfig,
} from './Utils'

const API = '/edrys-dev'

// sessionStorage: the class this tab opened with `?dev`, so only that tab
// (and its reloads) follows the lab file.
const SESSION_KEY = 'edrys-dev'

// localStorage: lab path → class id, so restarts reopen the same class
// (same share links) instead of importing a new copy each time.
const labKey = (path: string) => `edrys-dev:${path}`

const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]']

/** `?dev` on a page served from this machine; does nothing on the hosted site. */
export function isDevEntry(): boolean {
  return location.search === '?dev' && LOCAL_HOSTS.includes(location.hostname)
}

/** The class this tab follows the lab file for, if it was opened with `?dev`. */
export function devClassId(): string | null {
  return sessionStorage.getItem(SESSION_KEY)
}

// The hosted edrys-Lite students join on, as edrys-dev says (--student-url);
// null: they cannot (--local); undefined: not known (an older edrys-dev).
let studentSite: string | null | undefined

/**
 * A link to `classId` for students. In the class this tab follows the lab
 * file for, a link to this page only works on this machine: it moves to the
 * site students join on, null if they cannot. Elsewhere `link` as it is.
 */
export function studentLink(link: string, classId: string): string | null {
  if (studentSite === undefined || !classId || devClassId() !== classId) return link
  if (studentSite === null) return null
  const from = new URL(link)
  const url = new URL(studentSite)
  url.search = from.search
  url.hash = from.hash
  return url.toString()
}

/** The lab as classroom data, without id and createdBy: those belong to the class, not the file. */
export async function fetchLab(): Promise<{ path: string; data: any; tutor: boolean }> {
  const response = await fetch(API + '/lab')
  if (!response.ok) throw new Error(`${API}/lab: ${response.status}`)

  const lab = await response.json()
  if ('studentSite' in lab) {
    studentSite = typeof lab.studentSite === 'string' && /^https?:\/\//.test(lab.studentSite) ? lab.studentSite : null
  }
  let parsed: any
  try {
    parsed = parse(lab.text)
  } catch (error: any) {
    // the agent fixes the file from this: js-yaml names line and column
    throw new Error(`could not parse ${lab.path}: ${error.message}`)
  }
  const data = normalizeClassroom(parsed)
  if (!data) throw new Error('not a classroom: ' + lab.path)

  delete data.id
  delete data.createdBy

  // edrys-dev runs its own sync server; its classes never use public ones.
  const communicationConfig = encodeCommConfig(lab.communication)
  if (communicationConfig) data.communicationConfig = communicationConfig

  return { path: lab.path, data, tutor: lab.tutor === true }
}

/** Reopens the lab's class, importing it as Deploy does on first use; returns the class route. */
export async function openDevLab(database = new Database()): Promise<string> {
  const { path, data } = await fetchLab()
  const peerID = getPeerID(false)

  let id = localStorage.getItem(labKey(path))
  // a class of another key (this browser's identity changed) would not take
  // the lab's changes: only its owner can save it
  const stored = id ? await database.get(id) : null
  if (!stored || !sameKey(stored.data?.createdBy, peerID)) {
    id = infoHash(16)
    data.id = id
    data.createdBy = peerID
    await database.put({ id, data, timestamp: Date.now(), hash: null })
    localStorage.setItem(labKey(path), id)
  }

  sessionStorage.setItem(SESSION_KEY, id)
  return `?/classroom/${id}/${await hashPubKey(peerID)}`
}

// Browsers refuse keepalive requests whose bodies add up to more than 64 KiB,
// without an error to see; a larger report goes without keepalive.
const KEEPALIVE_MAX = 60000

/** Tells edrys-dev what this tab sees; best effort, edrys-dev may be gone. */
export function report(type: string, payload: any = {}) {
  const body = JSON.stringify({ type, ...payload })
  fetch(API + '/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: new TextEncoder().encode(body).length < KEEPALIVE_MAX,
  }).catch(() => {})
}

/** This class's link for others: without `#comm=` they would not find edrys-dev's sync server. */
function shareLink(data: any): string {
  const url = new URL(location.href)
  url.hash = data.communicationConfig ? `comm=${data.communicationConfig}` : ''
  return url.toString()
}

export type DevCommands = {
  /** Move this tab into a room. */
  goto?: (command: { room?: string }) => void
  /**
   * A file of a local module changed: load the modules whose url starts with
   * one of `urls` again (the module's folder under each local address).
   */
  reloadModule?: (command: { urls: string[] }) => void
  /** The shared state of a room's modules as JSON, now; undefined if there is no such room. */
  readState?: (room: string) => Record<string, any> | undefined
  /** edrys-dev answers students' questions (--tutor), or no longer does (it is gone). */
  tutor?: (on: boolean) => void
  /** edrys-dev's answer to a question passed on with `tutor-ask`. */
  tutorAnswer?: (answer: { id: string; student: string; text?: string; error?: string }) => void
}

/**
 * The modules of the lab (`modules`, as in its file) whose url starts with one
 * of `urls`, scraped again: their meta tags may have changed too, and a module
 * edrys-Lite inlines would show its old copy on a mere reload. Each is marked
 * with `devReload`, so Module.vue mounts it anew. Resolves with them by index,
 * empty when none matches.
 */
export async function rescrapeModules(
  modules: any[],
  urls: string[],
  scrape: (module: any) => Promise<any>
): Promise<Map<number, any>> {
  const fresh = new Map<number, any>()
  await Promise.all(
    modules.map(async (module, i) => {
      if (!urls.some((url) => module.url?.startsWith(url))) return
      fresh.set(i, { ...(await scrape(module)), devReload: Date.now() })
    })
  )
  return fresh
}

/**
 * `scraped` with the modules of `fresh` (by index) in place. A module whose
 * url differs at that index is kept: the list changed in the meantime.
 */
export function withFresh(scraped: any[], fresh: Map<number, any>): any[] {
  return scraped.map((module, i) => (fresh.get(i)?.url === module?.url ? fresh.get(i) : module))
}

// strings of the state are cut to this many characters, or to KEY_MAX when
// only one key is asked for
const STATE_MAX = 1000
const KEY_MAX = 50000

/** A state value fit to send: long strings cut, binary data as its size. */
export function trimState(value: any, max: number): any {
  if (typeof value === 'string') return value.length > max ? value.slice(0, max) + `…(${value.length})` : value
  if (value instanceof Uint8Array) return { binary: value.length }
  if (Array.isArray(value)) return value.map((item) => trimState(item, max))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, trimState(v, max)]))
  }
  return value
}

/** Answers `read-state` {room, key?}: the room's state, or one key of it. */
function readState(commands: DevCommands, { room, key }: { room: string; key?: string }) {
  const state = commands.readState?.(room)
  if (!state) throw new Error(`no room ${room}`)
  if (key === undefined) return { room, state: trimState(state, STATE_MAX) }
  if (!Object.prototype.hasOwnProperty.call(state, key)) throw new Error(`no key ${key} in ${room}; keys: ${Object.keys(state).join(', ')}`)
  return { room, key, value: trimState(state[key], KEY_MAX) }
}

/**
 * Answers `run-module` {url, code, ms}: runs `code` in every frame of the
 * module at `url` in this tab's room. Only local modules served by edrys-dev
 * listen for it (edrys-dev puts the listener into their pages).
 */
export async function runInModule({ url, code, ms }: { url: string; code: string; ms: number }) {
  const frames = [...document.querySelectorAll<HTMLIFrameElement>('iframe[data-module-url]')].filter(
    (frame) => frame.dataset.moduleUrl === url && frame.contentWindow
  )
  if (!frames.length) throw new Error(`${url} is not shown in this tab's room`)
  return Promise.all(frames.map((frame) => runInFrame(frame.contentWindow!, code, ms)))
}

function runInFrame(frame: Window, code: string, ms: number): Promise<{ value: string } | { error: string }> {
  return new Promise((resolve) => {
    const id = infoHash(8)
    const done = (result: { value: string } | { error: string }) => {
      clearTimeout(timer)
      removeEventListener('message', listen)
      resolve(result)
    }
    const listen = (event: MessageEvent) => {
      const data = event.data
      if (event.source !== frame || data?.event !== 'dev-ran' || data.id !== id) return
      done(data.error !== undefined ? { error: String(data.error) } : { value: String(data.value) })
    }
    const timer = setTimeout(
      () => done({ error: `no answer within ${ms / 1000} s: not loaded yet, or still running` }),
      ms
    )
    addEventListener('message', listen)
    // an inlined module runs on a data: URL, whose origin is "null"
    frame.postMessage({ event: 'dev-run', id, code }, '*')
  })
}

/**
 * Passes the lab to `apply` on connect (also after edrys-dev restarts) and on
 * every change of the file; `apply` returns whether the class changed.
 * `commands` handles what edrys-dev asks of this tab. Returns a function that
 * stops listening.
 */
export function startDevBridge(apply: (data: any) => boolean, commands: DevCommands = {}): () => void {
  // two saves in a row fetch the lab twice; the older answer may come last
  let reloads = 0
  const reload = (connected = false) => {
    const run = ++reloads
    return fetchLab()
      .then(({ data, tutor }) => {
        if (connected) report('open', { url: shareLink(data) })
        commands.tutor?.(tutor)
        if (run === reloads) report('applied', { changed: apply(data) })
      })
      .catch((error) => {
        if (run !== reloads) return
        console.warn('edrys-dev: could not load the lab', error)
        report('error', { message: error.message })
      })
  }

  const events = new EventSource(API + '/events')
  events.onopen = () => {
    reload(true)
    // a restarted edrys-dev knows nothing of the class yet
    resendClass()
  }
  // no edrys-dev, no tutor; onopen announces it again
  events.onerror = () => commands.tutor?.(false)
  events.addEventListener('reload-lab', () => reload())
  events.addEventListener('tutor-answer', (event: MessageEvent) => commands.tutorAnswer?.(JSON.parse(event.data)))
  events.addEventListener('goto', (event: MessageEvent) => commands.goto?.(JSON.parse(event.data)))
  events.addEventListener('reload-module', (event: MessageEvent) => commands.reloadModule?.(JSON.parse(event.data)))
  // questions of edrys-dev, answered with a `reply` of the same id
  const answer = (event: string, handle: (command: any) => any) =>
    events.addEventListener(event, async (event: MessageEvent) => {
      const { id, ...command } = JSON.parse(event.data)
      try {
        report('reply', { id, value: await handle(command) })
      } catch (error: any) {
        report('reply', { id, error: error.message })
      }
    })
  answer('read-state', (command) => readState(commands, command))
  answer('run-module', runInModule)

  return () => events.close()
}

/**
 * The class as the agent needs it: own room, who is in which room, the
 * modules ({name, url}, and error if it could not be loaded; `scraped` are
 * the loaded modules, in the order of the lab's).
 */
export function classState(live: any, peerID: string, data: any, scraped: any[] = []) {
  const rooms: Record<string, { name: string; role: string; me?: true }[]> = {}
  for (const name of Object.keys(live?.rooms || {})) rooms[name] = []

  for (const [id, user] of Object.entries<any>(live?.users || {})) {
    const entry: { name: string; role: string; me?: true } = { name: user.displayName, role: user.role }
    if (id === peerID) entry.me = true
    ;(rooms[user.room] ??= []).push(entry)
  }

  const modules = (data?.modules || []).map((module: any, i: number) => {
    const loaded = scraped[i]
    // scrapeModule names a module it could not load like this
    const failed = loaded?.url === module.url && String(loaded.name).startsWith('<Error')
    return {
      name: (!failed && loaded?.name) || module.name || module.url,
      url: module.url,
      ...(failed ? { error: String(loaded.description) } : {}),
    }
  })

  return { room: live?.users?.[peerID]?.room ?? null, rooms, modules }
}

// A body larger than this many characters is not passed on. edrys.js sends
// bodies MessagePack-encoded; edrys-dev decodes and shortens them, a cut one
// could not be decoded.
const BODY_MAX = 20000
// at most this many messages per report; a terminal may send hundreds
const MESSAGES_MAX = 50
let messages: any[] = []
let dropped = 0
let messageTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Passes a module message the ?dev tab sees (sent or received) on to
 * edrys-dev, in batches every 500 ms. Does nothing in other tabs.
 */
export function reportMessage(classId: string, msg: any) {
  if (devClassId() !== classId) return

  if (messages.length >= MESSAGES_MAX) {
    dropped++
  } else {
    const size = typeof msg.body === 'string' ? msg.body.length : JSON.stringify(msg.body ?? null)?.length ?? 0
    messages.push({
      t: msg.date ?? Date.now(),
      subject: msg.subject,
      body: size > BODY_MAX ? { tooLarge: size } : msg.body,
      module: msg.module,
      // as the class shows it, not the whole key
      from: typeof msg.from === 'string' && !msg.from.startsWith('Station ') ? getShortPeerID(msg.from) : msg.from,
    })
  }

  messageTimer ??= setTimeout(() => {
    report('messages', { messages, dropped })
    messages = []
    dropped = 0
    messageTimer = undefined
  }, 500)
}

let lastClass = ''
let nextClass: ReturnType<typeof classState> | undefined
let classTimer: ReturnType<typeof setTimeout> | undefined

/**
 * Reports the class state to edrys-dev, only when it changed and at most every
 * 500 ms; the newest state of those 500 ms counts.
 */
export function reportClass(state: ReturnType<typeof classState>) {
  nextClass = state
  classTimer ??= setTimeout(() => {
    classTimer = undefined
    const json = JSON.stringify(nextClass)
    if (json === lastClass) return
    lastClass = json
    report('class', nextClass)
  }, 500)
}

/** Reports the last class state again, if there is one. */
export function resendClass() {
  if (lastClass) report('class', JSON.parse(lastClass))
}
