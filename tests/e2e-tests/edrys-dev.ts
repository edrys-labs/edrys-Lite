import { Browser, Page } from '@playwright/test'
import { BASE_URL, inPeer, Session, TRANSPORT } from './helpers'

/**
 * A stand-in for edrys-dev (see src/ts/DevBridge.ts), so the suites can run
 * an owner tab opened with `?dev` against the plain dev server: routes for
 * `/edrys-dev/lab` and `/edrys-dev/bridge`, and an EventSource for
 * `/edrys-dev/events` that the test pushes events into. Its tutor answers
 * every question at once with `Echo: <question>`.
 */

const LAB = `name: Tutor E2E
meta:
  defaults:
    rooms: 1
modules: []
`

export interface FakeEdrysDev {
  /** Every report the owner tab sent to edrys-dev, oldest first. */
  reports: any[]
  /** Turns the tutor on or off, as the switch in edrys-dev's panel does. */
  setTutor(on: boolean): Promise<void>
}

// Replaces EventSource for edrys-dev's streams: open at once, never failing,
// and `window.__devEvents.emit(type, data)` delivers an event.
function fakeEventSource() {
  const Real = window.EventSource
  class DevEvents extends EventTarget {
    onopen: ((e: Event) => void) | null = null
    onerror: ((e: Event) => void) | null = null
    onmessage: ((e: MessageEvent) => void) | null = null
    readyState = 1
    constructor(public url: string) {
      super()
      setTimeout(() => this.onopen?.(new Event('open')))
    }
    emit(type: string, data: any) {
      this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }))
    }
    close() {
      this.readyState = 2
    }
  }
  ;(window as any).EventSource = function (url: string, options?: any) {
    if (!String(url).startsWith('/edrys-dev/')) return new Real(url, options)
    const events = new DevEvents(String(url))
    if (String(url) === '/edrys-dev/events') (window as any).__devEvents = events
    return events
  }
}

const emit = (page: Page, type: string, data: any) =>
  page.evaluate(([type, data]) => (window as any).__devEvents?.emit(type, data), [type, data] as const)

/**
 * OWNER: opens the stand-in's lab with `?dev`, as edrys-dev's class tab, with
 * the tutor on. Returns the session, the join link the tab reported, and the
 * stand-in.
 */
export async function openDevClass(browser: Browser): Promise<{ owner: Session; joinUrl: string; dev: FakeEdrysDev }> {
  const context = await browser.newContext()
  await context.addInitScript(fakeEventSource)
  let page: Page
  let tutor = true
  const reports: any[] = []

  await context.route('**/edrys-dev/lab', (route) =>
    route.fulfill({
      json: {
        path: '/e2e/lab.yml',
        text: LAB,
        tutor,
        communication: TRANSPORT === 'ws' ? { communicationMethod: 'Websocket' } : undefined,
      },
    })
  )
  await context.route('**/edrys-dev/bridge', async (route) => {
    const report = route.request().postDataJSON()
    reports.push(report)
    await route.fulfill({ status: 204 })
    if (report?.type === 'tutor-ask') {
      const { id, student, text } = report
      emit(page, 'tutor-answer', { id, student, text: `Echo: ${text}` }).catch(() => {})
    }
  })

  page = await context.newPage()
  // isDevEntry: ?dev on a page of this machine
  await page.goto(`${new URL(BASE_URL).origin}/?dev`)
  await page.waitForFunction(() => location.search.startsWith('?/classroom/'), null, { timeout: 20000 })
  await page.waitForFunction(() => (window as any).__devEvents, null, { timeout: 20000 })
  const peerId = await waitForPeerId(page)

  const open = () => reports.filter((r) => r.type === 'open').at(-1)
  for (let i = 0; i < 40 && !open(); i++) await page.waitForTimeout(500)
  if (!open()) throw new Error('the dev tab reported no class link')
  if (TRANSPORT === 'ws') {
    const onRelay = await inPeer<boolean>(page, "return !!p.provider?.constructor?.name?.includes('Websocket')")
    if (!onRelay || !open().url.includes('#comm=ws')) throw new Error(`the dev class is not on the relay: ${open().url}`)
  }

  return {
    owner: { context, page, peerId },
    joinUrl: open().url,
    dev: {
      reports,
      async setTutor(on: boolean) {
        tutor = on
        await emit(page, 'reload-lab', {})
      },
    },
  }
}

async function waitForPeerId(page: Page): Promise<string> {
  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const id = await inPeer<string>(page, 'return p.peerID').catch(() => '')
    if (id) return id
    await page.waitForTimeout(500)
  }
  throw new Error('the dev tab has no Peer')
}

/** The tutor drawer of a student page. */
export const tutorDrawer = (page: Page) => page.locator('.v-navigation-drawer').filter({ hasText: 'Ask about the lab' })

/** A student asks the tutor through its UI. */
export async function askTutor(page: Page, text: string) {
  const drawer = tutorDrawer(page)
  if (!(await drawer.isVisible())) await page.locator('[data-test=tutor-button]').click()
  const box = drawer.locator('textarea')
  await box.fill(text)
  await box.press('Enter')
}
