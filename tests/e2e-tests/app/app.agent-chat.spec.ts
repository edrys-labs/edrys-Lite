import { test, expect, Page } from '@playwright/test'
import { closeSessions, Session } from '../helpers'
import { openDevClass } from '../edrys-dev'

/**
 * The teacher's agent chat in edrys-dev's ?dev tab, with a stand-in for
 * edrys-dev (see ../edrys-dev.ts): the stand-in pushes what edrys-dev's
 * streams would send, and records what the panel posts back.
 */

const drawer = (page: Page) => page.locator('.agent-panel')
const button = (page: Page) => page.locator('[data-test=agent-chat-button]')

// the rooms drawer opens with the class, its scrim over everything else
async function closeRooms(page: Page) {
  const rooms = page.getByRole('button', { name: 'Rooms' })
  if ((await rooms.getAttribute('aria-expanded')) === 'true') await rooms.click()
  await expect(page.locator('.rooms-drawer')).not.toBeInViewport()
}

const history = (entries: any[], open: string | null = null) => ({
  type: 'history',
  session: { id: 's1', title: 'Fix the lab' },
  sessions: [{ id: 's1', title: 'Fix the lab' }],
  entries,
  skipped: 0,
  open,
  status: 'Waiting for you',
  hint: '',
  lab: null,
})

test.describe('App — the agent chat of edrys-dev', () => {
  let owner: Session | undefined

  test.afterEach(async () => {
    await closeSessions(owner)
    owner = undefined
  })

  test('there is none without an agent or a tutor', async ({ browser }) => {
    const dev = await openDevClass(browser)
    owner = dev.owner
    await expect(button(owner.page)).toHaveCount(0)
  })

  test('the teacher reads the agent, answers its form and writes to it', async ({ browser }) => {
    const dev = await openDevClass(browser, { agent: true, students: false })
    owner = dev.owner
    const page = owner.page

    await expect(button(page)).toBeVisible({ timeout: 20000 })
    await closeRooms(page)
    await dev.dev.push('/chat/events', history([{ n: 1, t: 1, type: 'user', text: 'Add a terminal' }]))
    await dev.dev.push('/chat/events', {
      type: 'entry',
      entry: {
        n: 2,
        t: 2,
        type: 'ai',
        // no HTML of the agent's runs in the page
        markdown: 'Which **room**? <img src=x onerror="window.__pwned=1">',
        ask: 'ask-1',
        inputs: [{ id: 'room', type: 'buttons', options: ['Lobby', 'Station 1'] }],
      },
    })

    // something new while it is closed: a dot on the button
    await expect(button(page)).toHaveAttribute('aria-label', /new/)
    await button(page).click()
    await expect(drawer(page)).toBeVisible()
    await expect(button(page)).not.toHaveAttribute('aria-label', /new/)
    await expect(drawer(page).locator('strong', { hasText: 'room' })).toBeVisible()
    await expect(drawer(page).locator('img')).toHaveCount(0)
    expect(await page.evaluate(() => (window as any).__pwned)).toBeUndefined()
    await expect(drawer(page).getByText('Waiting for you')).toBeVisible()

    // one row of buttons sends at once
    await drawer(page).getByRole('button', { name: 'Station 1' }).click()
    await expect.poll(() => dev.dev.posts.at(-1)).toEqual({ path: '/chat', body: { ask: 'ask-1', values: { room: 'Station 1' } } })
    await dev.dev.push('/chat/events', { type: 'entry', entry: { n: 3, t: 3, type: 'answer', ask: 'ask-1', values: { room: 'Station 1' } } })
    await expect(drawer(page).locator('form[aria-disabled=true]')).toHaveCount(1)

    const box = drawer(page).locator('textarea')
    await box.fill('Thanks')
    await box.press('Enter')
    await expect.poll(() => dev.dev.posts.at(-1)).toEqual({ path: '/chat', body: { text: 'Thanks' } })
    await expect(box).toHaveValue('')

    // its width stays within the window, and the class keeps the rest
    const width = (await drawer(page).boundingBox())!.width
    expect(width).toBeGreaterThanOrEqual(320)
    const main = (await page.locator('.v-main').boundingBox())!
    expect(main.width).toBeGreaterThan(0)
  })

  test('the Students view shows the tutor threads and switches the tutor', async ({ browser }) => {
    const dev = await openDevClass(browser, { agent: true, students: true })
    owner = dev.owner
    const page = owner.page

    await expect(button(page)).toBeVisible({ timeout: 20000 })
    await closeRooms(page)
    await button(page).click()
    await expect(drawer(page)).toBeVisible()
    await dev.dev.push('/tutor/events', { type: 'threads', on: true, threads: [] })
    // a question while the Agent view is shown: counted on the tab
    await dev.dev.push('/tutor/events', {
      type: 'entry',
      id: 't1',
      name: 'Ada',
      entry: { from: 'student', t: Date.now(), text: 'Why no LED?', room: 'Lobby' },
    })
    const tab = page.locator('[data-test=agent-chat-tab-students]')
    await expect(tab).toContainText('1')

    await tab.click()
    await expect(tab).not.toContainText('1')
    await expect(drawer(page).getByText('Why no LED?')).toBeVisible()
    await expect(drawer(page).getByText('Ada')).toBeVisible()

    await drawer(page).getByLabel('Tutor answers students').click()
    await expect.poll(() => dev.dev.posts.at(-1)).toEqual({ path: '/tutor', body: { on: false } })
  })

  test('the tutor limit shows until the tutor takes a question again', async ({ browser }) => {
    const dev = await openDevClass(browser, { agent: false, students: true })
    owner = dev.owner
    const page = owner.page

    await expect(button(page)).toBeVisible({ timeout: 20000 })
    await closeRooms(page)
    await button(page).click()
    await dev.dev.push('/tutor/events', { type: 'threads', on: true, threads: [] })
    await dev.dev.push('/tutor/events', { type: 'limit', perHour: 60 })
    const limit = drawer(page).locator('.agent-alert--warn')
    await expect(limit).toContainText('60')

    await dev.dev.push('/tutor/events', {
      type: 'entry',
      id: 't1',
      name: 'Ada',
      entry: { from: 'student', t: Date.now(), text: 'Still stuck', room: 'Lobby' },
    })
    await expect(limit).toHaveCount(0)
  })

  test('a lab problem sent again on a reconnect is not new', async ({ browser }) => {
    const dev = await openDevClass(browser, { agent: true, students: false })
    owner = dev.owner
    const page = owner.page
    const problem = { text: 'lab.yml does not load', detail: 'line 3' }

    await expect(button(page)).toBeVisible({ timeout: 20000 })
    await closeRooms(page)
    await dev.dev.push('/chat/events', { ...history([]), lab: problem })
    await expect(button(page)).toHaveAttribute('aria-label', /new/)
    await button(page).click()
    await button(page).click()
    await expect(button(page)).not.toHaveAttribute('aria-label', /new/)

    // the same history after a reconnect
    await dev.dev.push('/chat/events', { ...history([]), lab: problem })
    await expect(button(page)).not.toHaveAttribute('aria-label', /new/)
  })

  test('an edrys-dev with other views gets a panel with those views', async ({ browser }) => {
    const dev = await openDevClass(browser, { agent: false, students: true })
    owner = dev.owner
    const page = owner.page

    await expect(button(page)).toBeVisible({ timeout: 20000 })
    await closeRooms(page)
    await expect(page.locator('[data-test=agent-chat-tab-agent]')).toHaveCount(0)

    await dev.dev.setChat({ agent: true, students: true })
    await button(page).click()
    await page.locator('[data-test=agent-chat-tab-agent]').click()
    // the new panel listens to the agent's stream
    await dev.dev.push('/chat/events', history([{ n: 1, t: 1, type: 'user', text: 'Hello agent' }]))
    await expect(drawer(page).getByText('Hello agent')).toBeVisible()

    await dev.dev.setChat(undefined)
    await expect(button(page)).toHaveCount(0)
  })
})
