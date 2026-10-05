import { BrowserContext, BrowserType, Page, expect } from '@playwright/test'
const YAML: { load(s: string): any } = require('js-yaml')
import { inPeer, Session, BASE_URL, TRANSPORT } from '../helpers'

export { TRANSPORT }

/**
 * Extra helpers for the multi-peer station load test. Reuses the shared
 * `inPeer`/`Session`/`BASE_URL` plumbing (see tests/e2e-tests/helpers.ts)
 * rather than duplicating the Vue-tree Peer lookup.
 */

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// WS goes through a relay and converges more slowly than WebRTC's direct
// mesh — same reasoning as the shared SYNC_MS. Multiply timeouts
// that assume WebRTC-speed convergence by this factor when running WS.
export const TRANSPORT_TIMEOUT_SCALE = TRANSPORT === 'ws' ? 2 : 1

/** A named CDP network profile (chromium only). */
export interface NetworkProfile {
  name: string
  offline: boolean
  downloadThroughput: number // bytes/sec, -1 = unthrottled
  uploadThroughput: number
  latency: number // ms
}

// Kept to 3 representative conditions (good / typical / bad) rather than 5 —
// each profile is a full extra chromium process, and running many browsers
// concurrently on a local dev machine is heavy (see station-load.spec.ts).
export const NETWORK_PROFILES: NetworkProfile[] = [
  { name: 'wifi', offline: false, downloadThroughput: -1, uploadThroughput: -1, latency: 5 },
  {
    name: 'slow-4g',
    offline: false,
    downloadThroughput: (1.5 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
    latency: 150,
  },
  {
    name: 'slow-3g',
    offline: false,
    downloadThroughput: (400 * 1024) / 8,
    uploadThroughput: (400 * 1024) / 8,
    latency: 400,
  },
]

export interface PeerSession extends Session {
  context: BrowserContext
  page: Page
  close(): Promise<void>
}

/**
 * Open a chromium context throttled via CDP to `profile`, navigate to
 * `joinUrl`, and wait for the Peer to initialize.
 */
export async function openThrottledChromiumPeer(
  chromium: BrowserType,
  joinUrl: string,
  profile: NetworkProfile
): Promise<PeerSession> {
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  const client = await context.newCDPSession(page)
  await client.send('Network.enable')
  await client.send('Network.emulateNetworkConditions', {
    offline: profile.offline,
    downloadThroughput: profile.downloadThroughput,
    uploadThroughput: profile.uploadThroughput,
    latency: profile.latency,
  })

  // Log the applied network profile in the page's own console (visible in
  // that browser's DevTools) so it's obvious which peer is running under
  // which condition.
  await page.addInitScript((p) => {
    console.log(
      `[network-profile] ${p.name}: latency=${p.latency}ms download=${p.downloadThroughput < 0 ? 'unthrottled' : p.downloadThroughput + 'B/s'} upload=${p.uploadThroughput < 0 ? 'unthrottled' : p.uploadThroughput + 'B/s'}`
    )
  }, profile)

  await page.goto(joinUrl)
  await waitForPeerReady(page)
  const peerId = await inPeer<string>(page, 'return p.peerID')

  return {
    context,
    page,
    peerId,
    close: async () => {
      await browser.close().catch(() => {})
    },
  }
}

/**
 * Open the station as a NEW PAGE inside the owner's own browser context, so it
 * shares the owner's crypto identity (localStorage-scoped per context). Only
 * the owner/a teacher may create a station's room, so the station must be
 * opened as the owner — a separate browser/context would be a different,
 * unauthorized peer identity.
 */
export async function openStationAsOwner(
  owner: Session,
  stationJoinUrl: string
): Promise<Session> {
  const page = await owner.context.newPage()
  await page.goto(stationJoinUrl)
  await waitForPeerReady(page)
  const peerId = await inPeer<string>(page, 'return p.peerID')
  return { context: owner.context, page, peerId }
}

/** Open a plain (unthrottled) peer on any installed browser type. */
export async function openPeer(
  browserType: BrowserType,
  joinUrl: string
): Promise<PeerSession> {
  const browser = await browserType.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(joinUrl)
  await waitForPeerReady(page)
  const peerId = await inPeer<string>(page, 'return p.peerID')

  return {
    context,
    page,
    peerId,
    close: async () => {
      await browser.close().catch(() => {})
    },
  }
}

export async function waitForPeerReady(page: Page, timeout = 45000) {
  await page.waitForFunction(
    () => {
      const app = (document.body as any).__vue_app__
      const root = app && app._container && app._container._vnode
      if (!root) return false
      function walk(vn: any): any {
        if (!vn) return undefined
        const cmp = vn.component
        if (cmp && cmp.proxy && cmp.proxy.communication && cmp.proxy.communication.peerID)
          return cmp.proxy.communication
        if (cmp && cmp.subTree) {
          const hit = walk(cmp.subTree)
          if (hit) return hit
        }
        const kids = Array.isArray(vn.children) ? vn.children : []
        for (const k of kids) {
          const hit = walk(k)
          if (hit) return hit
        }
        return undefined
      }
      const p = walk(root)
      return !!(p && p.peerID)
    },
    { timeout, polling: 500 }
  )
}

/**
 * Owner: drive the REAL Settings UI — gear icon > Share tab > "Restore class
 * from URL" > Save — to load a classroom config from a published URL.
 *
 * Earlier this was done by reaching into the live Peer (`p.lab.data` +
 * `p._signAndWrite`) directly, mirroring what Share.vue's restoreURL does.
 * That bypassed the app's own persistence path: Settings.saveClass() calls
 * `database.update(...)` (IndexedDB) THEN `communication.newSetup(...)`, so a
 * config applied only via the live Peer never survives a reload — the next
 * page load re-reads the stale IndexedDB entry. Driving the UI goes through
 * the same code path a real user's save does, so the reload problem doesn't
 * exist in the first place.
 */
export async function ownerImportConfigFromUrl(
  owner: Session,
  configUrl: string,
  timeout = 20000
): Promise<string> {
  // Fetch+parse in Node first so we know the expected name up front (used
  // both to assert the restore succeeded and to verify post-reload).
  const res = await fetch(configUrl)
  if (!res.ok) throw new Error(`failed to fetch config: ${res.status}`)
  const text = await res.text()
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = YAML.load(text)
  }
  if (!parsed?.name) throw new Error('could not parse fetched config (or missing name)')

  const page = owner.page

  await page.getByTitle('Settings').click()
  await page.getByRole('tab').filter({ hasText: 'Share' }).click()

  const urlField = page.getByLabel('Restore class from URL (http, https)')
  await urlField.fill(configUrl)
  // Share.vue binds the field's append-icon click (not Enter) to restoreURL().
  await page
    .getByRole('button', { name: 'Restore class from URL (http, https) appended action' })
    .click()

  // restoreURL() is async (fetch + parseClassroom); wait for it to actually
  // update configClone.name in the Main tab before saving, otherwise Save
  // would persist the pre-restore clone.
  await page.getByRole('tab').filter({ hasText: 'Main' }).click()
  await expect(page.getByLabel('Class Name')).toHaveValue(parsed.name, { timeout })

  // The Save button's accessible name includes the "unsaved changes" badge
  // text ("Save Badge"), so match loosely rather than exact.
  await page.getByRole('button', { name: 'Save', exact: false }).first().click()

  await waitForLoadedConfigName(page, parsed.name, timeout)
  return parsed.name
}

/**
 * Poll a page's SIGNED y.setup config (the committed source of truth) until
 * its `name` matches `expectedName`, or fail. Use after any reload/new-page
 * navigation into an existing classroom to confirm that page actually
 * rendered the current config, rather than assuming a fixed settle delay.
 */
export async function waitForLoadedConfigName(
  page: Page,
  expectedName: string,
  timeout = 20000
) {
  const deadline = Date.now() + timeout
  let lastName: string | undefined
  while (Date.now() < deadline) {
    lastName = await inPeer<string | undefined>(
      page,
      "return p.y.setup.get('config')?.name"
    )
    if (lastName === expectedName) return
    await sleep(500)
  }
  throw new Error(
    `page's loaded config never settled to "${expectedName}" (last saw "${lastName}") within ${timeout}ms`
  )
}

/**
 * Build a station join URL for classroom `id` (owned by `ownerPeerId`) at
 * BASE_URL/station/..., preserving the `#comm=ws` fragment when running over
 * the WebSocket relay (E2E_TRANSPORT=ws) — same fragment `joinUrl` already
 * carries for every other peer, so the station's provider matches everyone
 * else's instead of silently falling back to WebRTC.
 */
export function stationUrl(classroomId: string, ownerPeerId: string): string {
  const base = `${BASE_URL}/?/station/${classroomId}/${ownerPeerId}`
  return TRANSPORT === 'ws' ? `${base}#comm=ws` : base
}

/** Have a joined participant (non-station) enter a station's room. */
export async function enterStationRoom(session: Session, stationName: string) {
  await inPeer(session.page, `p.gotoRoom(${JSON.stringify('Station ' + stationName)}); return true`)
}

/** Read the station's own peerID's room name (e.g. "Station ab12cd") from its page. */
export async function getStationRoomName(stationSession: Session): Promise<string> {
  return inPeer<string>(stationSession.page, 'return p.peerID')
}

/**
 * Poll a session's live `y.rooms` for a station room until it contains all
 * expected participant peerIds, or fail. On timeout, throws with a diagnostic
 * dump of the observer's full y.users snapshot (which peers are missing vs.
 * present-but-in-a-different-room vs. entirely absent/not meshed).
 *
 * If `stragglers` (peerId -> Session) is given, any peer still not in
 * `roomName` after `retryAfterMs` gets its `gotoRoom` re-issued — a slow/
 * throttled link can drop the first signed write in flight, and re-sending
 * is cheaper and more realistic than just widening the timeout further.
 */
export async function waitForAllInRoom(
  observer: Session,
  roomName: string,
  expectedPeerIds: string[],
  timeout = 60000,
  opts: { stragglers?: Record<string, Session>; retryAfterMs?: number } = {}
) {
  const { stragglers, retryAfterMs = 15000 } = opts
  const deadline = Date.now() + timeout
  let lastUsers: Record<string, { room: string }> = {}
  let lastRetryAt = Date.now()
  while (Date.now() < deadline) {
    lastUsers = await inPeer(observer.page, 'return v.users')
    const inRoom = Object.entries(lastUsers)
      .filter(([, u]) => u.room === roomName)
      .map(([id]) => id)
    const allIn = expectedPeerIds.every((id) => inRoom.includes(id))
    if (allIn) return

    if (stragglers && Date.now() - lastRetryAt >= retryAfterMs) {
      const stuck = expectedPeerIds.filter((id) => !inRoom.includes(id))
      await Promise.all(
        stuck
          .map((id) => stragglers[id])
          .filter((s): s is Session => !!s)
          .map((s) => enterStationRoom(s, roomName.replace(/^Station /, '')))
      )
      lastRetryAt = Date.now()
    }

    await sleep(1500)
  }
  const missing = expectedPeerIds.filter((id) => !(id in lastUsers))
  const wrongRoom = expectedPeerIds
    .filter((id) => id in lastUsers && lastUsers[id].room !== roomName)
    .map((id) => `${id}=${lastUsers[id].room}`)
  throw new Error(
    `not all peers reached room "${roomName}" within ${timeout}ms.\n` +
      `  not meshed/absent from observer's y.users (${missing.length}): ${missing.join(', ')}\n` +
      `  meshed but in wrong room (${wrongRoom.length}): ${wrongRoom.join(', ')}\n` +
      `  observer y.users snapshot: ${JSON.stringify(lastUsers)}`
  )
}
