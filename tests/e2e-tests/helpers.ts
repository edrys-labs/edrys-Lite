import { Browser, BrowserContext, Page } from '@playwright/test'

/**
 * Shared helpers for the e2e suites (see README.md).
 *
 * Each test spins up isolated browser contexts against a running dev server
 * (default http://localhost:6999): an OWNER that creates a virgin classroom
 * (it is `setup.createdBy`, the trust anchor) and participants that join it.
 * Tests drive and inspect each page's live `Peer` via `inPeer`.
 *
 * TRANSPORT: default is WebRTC (the app's default provider). Set E2E_TRANSPORT=ws
 * to run over the WebSocket relay instead (appends `#comm=ws` to the join URL and
 * flips the owner's communication method). WS additionally requires the owner to
 * pick "Websocket" + "Keep communication settings in URL" in Settings — done by
 * createClassroom() automatically.
 *
 * PREREQUISITE: a running dev server (`npm run watch`).
 */

export const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:6999'
export const TRANSPORT: 'webrtc' | 'ws' =
  process.env.E2E_TRANSPORT === 'ws' ? 'ws' : 'webrtc'

// Post-action sync budget (WS goes through a relay and is slower than WebRTC).
// Peer connection is awaited actively via waitForPeer/waitForMesh, not slept.
export const SYNC_MS = TRANSPORT === 'ws' ? 6000 : 3000

/**
 * Locate the live `Peer` (communication) instance by walking the Vue app tree.
 * Fully null-safe: returns undefined (never throws) before the app has mounted,
 * so it is safe to call from inside a polling `waitForFunction`.
 *
 * Defined as a string so it can be prepended to page-side function bodies.
 */
const FIND_PEER_SRC = `
  function findPeer() {
    var app = document.body && document.body.__vue_app__;
    var root = app && app._container && app._container._vnode;
    if (!root) return undefined;
    function walk(vn, hits) {
      if (!vn) return hits;
      var cmp = vn.component;
      if (cmp && cmp.proxy && cmp.proxy.communication && cmp.proxy.communication.peerID)
        hits.push(cmp.proxy.communication);
      if (cmp && cmp.subTree) walk(cmp.subTree, hits);
      var kids = Array.isArray(vn.children) ? vn.children : [];
      for (var i = 0; i < kids.length; i++) walk(kids[i], hits);
      return hits;
    }
    return walk(root, [])[0];
  }
`

/**
 * Run `body` (a statement block that operates on `p` = the Peer and `return`s a
 * value) in the page. Throws if the Peer isn't present yet.
 */
export function inPeer<T = any>(page: Page, body: string): Promise<T> {
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    `${FIND_PEER_SRC}\nvar p = findPeer();\nif (!p) throw new Error('Peer instance not found in Vue tree');\n${body}`
  ) as () => T
  return page.evaluate(fn)
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Wait until the page's Peer instance exists and is initialized. */
async function waitForPeer(page: Page, timeout = 20000) {
  await page.waitForFunction(
    (src) => {
      // eslint-disable-next-line no-new-func
      const find = new Function(`${src}\nreturn findPeer();`) as () => any
      const p = find()
      return !!(p && p.peerID)
    },
    FIND_PEER_SRC,
    { timeout, polling: 500 }
  )
}

export interface Session {
  context: BrowserContext
  page: Page
  peerId: string
}

/**
 * OWNER: create a virgin classroom. Returns the join URL (already carrying the
 * transport fragment) and the owner session.
 */
export interface SessionOptions {
  initScript?: () => void
  /** Runs on the fresh context before the first navigation (e.g. routes). */
  prepare?: (context: BrowserContext) => Promise<void>
}

export async function createClassroom(
  browser: Browser,
  { initScript, prepare }: SessionOptions = {}
): Promise<{ owner: Session; joinUrl: string }> {
  const context = await browser.newContext()
  if (initScript) await context.addInitScript(initScript)
  if (prepare) await prepare(context)
  const page = await context.newPage()
  await page.goto(BASE_URL)
  await page.getByText('Create a class').click()
  await waitForPeer(page)

  if (TRANSPORT === 'ws') {
    // Switch communication to Websocket + keep in URL, then reload onto it.
    const url = page.url().split('#')[0]
    await page.goto(url + '#comm=ws')
    await waitForPeer(page)
    await page.waitForFunction(
      (src) => {
        // eslint-disable-next-line no-new-func
        const find = new Function(`${src}\nreturn findPeer();`) as () => any
        const p = find()
        return !!p?.provider?.constructor?.name?.includes('Websocket')
      },
      FIND_PEER_SRC,
      { timeout: 15000, polling: 500 }
    )
  }

  const peerId = await inPeer<string>(page, 'return p.peerID')
  const joinUrl =
    TRANSPORT === 'ws'
      ? page.url().split('#')[0] + '#comm=ws'
      : page.url().split('#')[0]

  return { owner: { context, page, peerId }, joinUrl }
}

/** Participant: join an existing classroom. */
export async function joinClassroom(
  browser: Browser,
  joinUrl: string,
  { initScript, prepare }: SessionOptions = {}
): Promise<Session> {
  const context = await browser.newContext()
  if (initScript) await context.addInitScript(initScript)
  if (prepare) await prepare(context)
  const page = await context.newPage()
  await page.goto(joinUrl)
  await waitForPeer(page)
  const peerId = await inPeer<string>(page, 'return p.peerID')
  return { context, page, peerId }
}

/**
 * Wait until BOTH peers see each other in y.users (meshed). This is the real
 * convergence gate — WebRTC meshes in a few seconds; the WS relay's identity
 * handshake rides awareness heartbeats (~5s cadence) so it needs longer.
 */
export async function waitForMesh(
  a: Session,
  b: Session,
  timeout = TRANSPORT === 'ws' ? 45000 : 20000
) {
  const bothSee = async () => {
    const aSees = await inPeer<string[]>(
      a.page,
      'return Object.keys(p.y.users.toJSON())'
    )
    const bSees = await inPeer<string[]>(
      b.page,
      'return Object.keys(p.y.users.toJSON())'
    )
    return aSees.includes(b.peerId) && bSees.includes(a.peerId)
  }
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await bothSee()) return
    await sleep(1000)
  }
  throw new Error('peers did not mesh within timeout')
}

/** Convenience: the standard sync wait after a peer action. */
export const syncWait = () => sleep(SYNC_MS)

export async function closeSessions(...sessions: (Session | undefined)[]) {
  for (const s of sessions) {
    if (s) await s.context.close().catch(() => {})
  }
}
