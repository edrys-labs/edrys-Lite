/**
 * Dev mode: the page is served by edrys-dev, which watches a lab file on disk.
 * That file is the source of truth: the tab opened with `?dev` imports it as a
 * class owned by this browser's key and, through the normal saveClass path
 * (signed), republishes it whenever the file changes.
 *
 * edrys-dev endpoints (same origin):
 *   GET  /edrys-dev/lab     { path, text, communication? }
 *   GET  /edrys-dev/events  server-sent events, `reload-lab` when the file changed
 *   POST /edrys-dev/bridge  JSON reports from this tab
 */
import { Database } from './Database'
import {
  infoHash,
  getPeerID,
  hashPubKey,
  parseClassroom,
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

/** The lab as classroom data, without id and createdBy: those belong to the class, not the file. */
export async function fetchLab(): Promise<{ path: string; data: any }> {
  const response = await fetch(API + '/lab')
  if (!response.ok) throw new Error(`${API}/lab: ${response.status}`)

  const lab = await response.json()
  const data = parseClassroom(lab.text)
  if (!data) throw new Error('not a classroom: ' + lab.path)

  delete data.id
  delete data.createdBy

  // edrys-dev runs its own sync server; its classes never use public ones.
  const communicationConfig = encodeCommConfig(lab.communication)
  if (communicationConfig) data.communicationConfig = communicationConfig

  return { path: lab.path, data }
}

/** Reopens the lab's class, importing it as Deploy does on first use; returns the class route. */
export async function openDevLab(database = new Database()): Promise<string> {
  const { path, data } = await fetchLab()
  const peerID = getPeerID(false)

  let id = localStorage.getItem(labKey(path))
  if (!id || !(await database.exists(id))) {
    id = infoHash(16)
    data.id = id
    data.createdBy = peerID
    await database.put({ id, data, timestamp: Date.now(), hash: null })
    localStorage.setItem(labKey(path), id)
  }

  sessionStorage.setItem(SESSION_KEY, id)
  return `?/classroom/${id}/${await hashPubKey(peerID)}`
}

/** Tells edrys-dev what this tab sees; best effort, edrys-dev may be gone. */
export function report(type: string, payload: any = {}) {
  fetch(API + '/bridge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, ...payload }),
    keepalive: true,
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
  /** A file of a local module changed: load the modules whose url starts with `url` again. */
  reloadModule?: (command: { url: string }) => void
}

/**
 * Passes the lab to `apply` on connect (also after edrys-dev restarts) and on
 * every change of the file; `apply` returns whether the class changed.
 * `commands` handles what edrys-dev asks of this tab. Returns a function that
 * stops listening.
 */
export function startDevBridge(apply: (data: any) => boolean, commands: DevCommands = {}): () => void {
  const reload = (connected = false) =>
    fetchLab()
      .then(({ data }) => {
        if (connected) report('open', { url: shareLink(data) })
        report('applied', { changed: apply(data) })
      })
      .catch((error) => {
        console.warn('edrys-dev: could not load the lab', error)
        report('error', { message: error.message })
      })

  const events = new EventSource(API + '/events')
  events.onopen = () => reload(true)
  events.addEventListener('reload-lab', () => reload())
  events.addEventListener('goto', (event: MessageEvent) => commands.goto?.(JSON.parse(event.data)))
  events.addEventListener('reload-module', (event: MessageEvent) =>
    commands.reloadModule?.(JSON.parse(event.data))
  )

  return () => events.close()
}

/** The class as the agent needs it: own room, who is in which room, the modules. */
export function classState(live: any, peerID: string, data: any) {
  const rooms: Record<string, { name: string; role: string; me?: true }[]> = {}
  for (const name of Object.keys(live?.rooms || {})) rooms[name] = []

  for (const [id, user] of Object.entries<any>(live?.users || {})) {
    const entry: { name: string; role: string; me?: true } = { name: user.displayName, role: user.role }
    if (id === peerID) entry.me = true
    ;(rooms[user.room] ??= []).push(entry)
  }

  return {
    room: live?.users?.[peerID]?.room ?? null,
    rooms,
    modules: (data?.modules || []).map((module: any) => module.name || module.url),
  }
}

let lastClass = ''
let classTimer: ReturnType<typeof setTimeout> | undefined

/** Reports the class state to edrys-dev, only when it changed and at most every 500 ms. */
export function reportClass(state: ReturnType<typeof classState>) {
  clearTimeout(classTimer)
  classTimer = setTimeout(() => {
    const json = JSON.stringify(state)
    if (json === lastClass) return
    lastClass = json
    report('class', state)
  }, 500)
}
