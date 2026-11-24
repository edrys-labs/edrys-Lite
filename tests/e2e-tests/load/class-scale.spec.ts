import { test, chromium, Browser, BrowserContext, Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as os from 'node:os'
import * as path from 'node:path'
import { createClassroom, closeSessions, inPeer, sleep, Session } from '../helpers'
import { ownerImportConfigFromUrl, waitForLoadedConfigName, waitForPeerReady, TRANSPORT } from './helpers'

/**
 * Class-size scaling: how long a class of N students takes to come together,
 * and whether it stays together. One run per N in CLASS_SIZES, each in a
 * fresh classroom:
 *
 * 1. The owner creates a class and imports a real lab (see LAB_DIR below).
 * 2. All N students open the join link at the same moment (start of class).
 * 3. Measured from that moment:
 *    - pageReadyMaxS:     the slowest student page has booted the app
 *    - configAllS:        every student has the signed lab config (doc sync)
 *    - ownerSeesAllS:     the owner's user list contains all N students
 *    - studentsSeeOwnerS: every student's user list contains the owner
 *    - allSeeAllS:        every student's user list contains everyone else
 *    then chat latency (owner -> all students), and a HOLD_MS dwell checking
 *    that the full presence view stays complete. The hold outlasts the 30s
 *    awareness timeout, which matters once N passes ~20 and the WebRTC mesh
 *    becomes partial (maxConns is a random 20-34 per peer). When a class
 *    doesn't converge, `diag` records each student's transport state
 *    (maxConns, open vs. pending connections, signaling).
 *
 * Students are separate contexts (separate identities) in ONE chromium
 * process, and module iframes are blocked: each page runs the full edrys app
 * and sync layer with the real lab config, but not the modules, so a single
 * machine can host more peers. Every peer shares this machine's CPU, and
 * WebRTC never leaves it (no TURN, no real network): this measures how the
 * sync and presence layer scale with class size, not real network
 * conditions. Watch `load1`: once the machine is saturated, the numbers
 * describe the machine, not edrys.
 *
 * Opt-in: skipped unless CLASS_SIZES is set (`npm run test:e2e:scale` sets
 * 5,10,20). Each class size takes 1-5 minutes.
 *
 * Env:
 *   CLASS_SIZES  comma-separated student counts, e.g. "5,10,20,30"
 *   HOLD_MS      presence dwell per class (default 60000)
 *   LAB_DIR      folder with the lab file, served locally (default: a sibling
 *                checkout of Edrys_Laboratories/lab-tubaf-embedded-systems;
 *                without it, the published copy on GitHub is used)
 *   LAB_FILE     lab file name (default task-1.yaml)
 * Results: printed, and written to test-results/class-scale-<transport>.json.
 *
 * PREREQUISITE: the dev server on E2E_BASE_URL (see ../README.md).
 */

const CLASS_SIZES = (process.env.CLASS_SIZES || '')
  .split(',')
  .map(Number)
  .filter((n) => n > 0)
const HOLD_MS = Number(process.env.HOLD_MS || 60000)
const LAB_DIR =
  process.env.LAB_DIR ||
  path.resolve(__dirname, '../../../../Edrys_Laboratories/lab-tubaf-embedded-systems/laboratory/de')
const LAB_FILE = process.env.LAB_FILE || 'task-1.yaml'
const LAB_FALLBACK_URL =
  'https://raw.githubusercontent.com/edrys-labs/lab-tubaf-embedded-systems/main/laboratory/de'
const CONVERGE_TIMEOUT = (TRANSPORT === 'ws' ? 240 : 180) * 1000
const POLL_MS = 1000

interface Result {
  transport: string
  students: number
  pageReadyMaxS: number
  configAllS: number | null
  ownerSeesAllS: number | null
  studentsSeeOwnerS: number | null
  allSeeAllS: number | null
  chatAllS: number | null
  holdOk: boolean | null
  holdWorst: string
  /** min-max open WebRTC connections per student; 'n/a' over the relay */
  meshDegree: string
  heapMBAvg: number
  memAvailGB: number
  load1: number
  note: string
  /** Per-student transport state, recorded when the class didn't converge. */
  diag?: any[]
}

/**
 * Serve LAB_DIR with CORS so the browser's restore-from-link can fetch it, or
 * fall back to the published lab when that folder isn't there.
 */
function serveLab(): Promise<{ url: string; close: () => void }> {
  if (!fs.existsSync(path.join(LAB_DIR, LAB_FILE))) {
    console.log(`lab: ${LAB_DIR}/${LAB_FILE} not found, using ${LAB_FALLBACK_URL}`)
    return Promise.resolve({ url: LAB_FALLBACK_URL, close: () => {} })
  }
  const server = http.createServer((req, res) => {
    const file = path.join(LAB_DIR, path.basename(decodeURIComponent(req.url || '')))
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (!fs.existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', 'text/yaml')
    res.end(fs.readFileSync(file))
  })
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as any
      console.log(`lab: serving ${LAB_DIR}`)
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() })
    })
  )
}

/** Block module iframes (and their assets); the edrys app itself still loads. */
async function blockModules(context: BrowserContext) {
  await context.route(/^https:\/\/edrys-labs\.github\.io\/module-/, (route) => route.abort())
}

const s = (ms: number) => Math.round(ms / 100) / 10

/** Evaluate in a page; undefined instead of throwing while it isn't ready. */
async function tryPeer<T>(page: Page, body: string): Promise<T | undefined> {
  try {
    return await inPeer<T>(page, body)
  } catch {
    return undefined
  }
}

async function runClass(browser: Browser, labUrl: string, n: number): Promise<Result> {
  const result: Result = {
    transport: TRANSPORT,
    students: n,
    pageReadyMaxS: 0,
    configAllS: null,
    ownerSeesAllS: null,
    studentsSeeOwnerS: null,
    allSeeAllS: null,
    chatAllS: null,
    holdOk: null,
    holdWorst: '',
    meshDegree: '',
    heapMBAvg: 0,
    memAvailGB: 0,
    load1: 0,
    note: '',
  }

  const { owner, joinUrl } = await createClassroom(browser, { prepare: blockModules })
  const students: Session[] = []
  try {
    const configName = await ownerImportConfigFromUrl(owner, `${labUrl}/${LAB_FILE}`)
    await owner.page.reload()
    await waitForPeerReady(owner.page)
    await waitForLoadedConfigName(owner.page, configName)
    // The reload starts a new session, and the session is part of the peer id.
    owner.peerId = await inPeer<string>(owner.page, 'return p.peerID')

    // Prepare every student context first, so the joins start together.
    const contexts = await Promise.all(
      Array.from({ length: n }, async () => {
        const context = await browser.newContext()
        await blockModules(context)
        return { context, page: await context.newPage() }
      })
    )

    const t0 = Date.now()
    const readyAt: number[] = []
    await Promise.all(
      contexts.map(async ({ context, page }, i) => {
        await page.goto(joinUrl)
        await waitForPeerReady(page, CONVERGE_TIMEOUT)
        readyAt[i] = Date.now() - t0
        students[i] = { context, page, peerId: await inPeer<string>(page, 'return p.peerID') }
      })
    )
    result.pageReadyMaxS = s(Math.max(...readyAt))

    const ids = students.map((st) => st.peerId)
    const everyone = [owner.peerId, ...ids]
    const missingPerStudent = (views: (string[] | undefined)[]) =>
      views.map((users, i) => everyone.filter((id) => id !== ids[i] && !users?.includes(id)).length)

    let lastMissing = ''
    while (
      Date.now() - t0 < CONVERGE_TIMEOUT &&
      [result.configAllS, result.ownerSeesAllS, result.allSeeAllS].includes(null)
    ) {
      const views = await Promise.all(
        students.map((st) =>
          tryPeer<{ users: string[]; config?: string }>(
            st.page,
            `return { users: Object.keys(v.users), config: p.y.setup.get('config')?.name }`
          )
        )
      )
      const elapsed = s(Date.now() - t0)
      if (result.configAllS === null && views.every((v) => v?.config === configName)) {
        result.configAllS = elapsed
      }
      if (result.ownerSeesAllS === null) {
        const ownerUsers = (await tryPeer<string[]>(owner.page, 'return Object.keys(v.users)')) || []
        if (ids.every((id) => ownerUsers.includes(id))) result.ownerSeesAllS = elapsed
      }
      if (result.studentsSeeOwnerS === null && views.every((v) => v?.users.includes(owner.peerId))) {
        result.studentsSeeOwnerS = elapsed
      }
      if (result.allSeeAllS === null) {
        const missing = missingPerStudent(views.map((v) => v?.users))
        if (missing.every((m) => m === 0)) result.allSeeAllS = elapsed
        else lastMissing = `worst student misses ${Math.max(...missing)} of ${n}`
      }
      await sleep(POLL_MS)
    }
    const converged = result.allSeeAllS !== null
    if (!converged) result.note = `not converged after ${s(CONVERGE_TIMEOUT)}s: ${lastMissing}`

    // Chat: owner -> every student.
    const marker = `scale-${n}-${Date.now()}`
    const c0 = Date.now()
    await inPeer(owner.page, `p.sendMessage(${JSON.stringify(marker)}); return true`)
    while (Date.now() - c0 < 60000) {
      const seen = await Promise.all(
        students.map((st) =>
          tryPeer<boolean>(st.page, `return v.chat.some((m) => m.msg === ${JSON.stringify(marker)})`)
        )
      )
      if (seen.every(Boolean)) {
        result.chatAllS = s(Date.now() - c0)
        break
      }
      await sleep(250)
    }

    // Resource snapshot while the class is together.
    const degrees = await Promise.all(
      students.map((st) => tryPeer<number>(st.page, 'return p.provider?.transport?.connectedPeers'))
    )
    const known = degrees.filter((d): d is number => typeof d === 'number')
    result.meshDegree = known.length ? `${Math.min(...known)}-${Math.max(...known)}` : 'n/a'
    const heaps = await Promise.all(
      students.map((st) =>
        st.page.evaluate(() => (performance as any).memory?.usedJSHeapSize ?? 0).catch(() => 0)
      )
    )
    result.heapMBAvg = Math.round(heaps.reduce((a, b) => a + b, 0) / heaps.length / 1e6)
    result.memAvailGB = Math.round((os.freemem() / 1e9) * 10) / 10
    result.load1 = Math.round(os.loadavg()[0] * 10) / 10

    if (!converged) {
      result.diag = await Promise.all(
        students.map((st) =>
          tryPeer<any>(
            st.page,
            `var t = p.provider && p.provider.transport;
             var h = t && t.signalingHealth;
             return {
               sees: Object.keys(v.users).length,
               seesOwner: ${JSON.stringify(owner.peerId)} in v.users,
               config: !!p.y.setup.get('config'),
               maxConns: t && t.options && t.options.maxConns,
               peers: h && h.peers,
               connected: h && h.connectedPeers,
               signalingOpen: h && h.open,
               reachesAllPeers: t && t.reachesAllPeers,
             }`
          )
        )
      )
      return result
    }

    // Hold: everyone must keep seeing everyone.
    let worst = 0
    const holdUntil = Date.now() + HOLD_MS
    while (Date.now() < holdUntil) {
      const views = await Promise.all(
        students.map((st) => tryPeer<string[]>(st.page, 'return Object.keys(v.users)'))
      )
      worst = Math.max(worst, ...missingPerStudent(views))
      await sleep(3000)
    }
    result.holdOk = worst === 0
    result.holdWorst = worst === 0 ? '' : `a student missed up to ${worst} peers`
    return result
  } finally {
    await closeSessions(...students)
    await closeSessions(owner)
  }
}

test.describe(`class scale (${TRANSPORT})`, () => {
  test.skip(CLASS_SIZES.length === 0, 'opt-in: set CLASS_SIZES (or run npm run test:e2e:scale)')

  test(`classes of ${CLASS_SIZES.join(', ')} students`, async () => {
    test.setTimeout(CLASS_SIZES.length * (CONVERGE_TIMEOUT + HOLD_MS + 180000))
    const lab = await serveLab()
    const browser = await chromium.launch()
    const results: Result[] = []
    try {
      for (const n of CLASS_SIZES) {
        const r = await runClass(browser, lab.url, n)
        results.push(r)
        console.log(JSON.stringify(r))
        await sleep(5000) // let the previous class's peers leave signaling
      }
    } finally {
      await browser.close().catch(() => {})
      lab.close()
      fs.mkdirSync('test-results', { recursive: true })
      fs.writeFileSync(`test-results/class-scale-${TRANSPORT}.json`, JSON.stringify(results, null, 2))
      console.table(results.map(({ diag, ...row }) => row))
    }
  })
})
