import { test, expect, Page } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, closeSessions, Session } from '../helpers'
import { SCALE, waitForVerified } from '../comm/helpers'
import { openDevClass, askTutor, tutorDrawer } from '../edrys-dev'
import { routeProbeModule, ownerAddProbeModule, inProbe } from './probe-module'

/**
 * A name chosen in the user menu reaches the other peers: in the room list and
 * chat beside the short ID, and in modules, the dev agent's state and the tutor.
 */

const timeout = 30000 * SCALE

async function setName(page: Page, name: string) {
  await page.locator('button:has(.mdi-dots-vertical)').first().click()
  const field = page.locator('#user-menu-username')
  await field.fill(name)
  await field.press('Enter')
  await page.keyboard.press('Escape')
}

async function sendChat(page: Page, text: string) {
  await page.locator('#chat-message').fill(text)
  await page.locator('#chat-message').press('Enter')
}

const openChat = (page: Page) => page.locator('button:has(.mdi-message-outline)').first().click()

test.describe('App — chosen user names', () => {
  let owner: Session | undefined
  let guest: Session | undefined

  test.afterEach(async () => {
    await closeSessions(owner, guest)
    owner = guest = undefined
  })

  test.describe('in a class', () => {
    test.beforeEach(async ({ browser }) => {
      const opts = { prepare: routeProbeModule }
      const created = await createClassroom(browser, opts)
      owner = created.owner
      guest = await joinClassroom(browser, created.joinUrl, opts)
      await waitForMesh(owner, guest)
      await waitForVerified(owner, guest)
      await waitForVerified(guest, owner)
    })

    test('a name shows in the room list with the short ID, and survives a reload', async () => {
      await setName(guest!.page, 'Ada')

      const row = owner!.page.locator('.room-user').filter({ hasText: 'Ada' })
      await expect(row).toHaveCount(1, { timeout })
      await expect(row.locator('.user-short-id')).toHaveText(/^[0-9a-f]+$/)

      await guest!.page.reload()
      await expect(row).toHaveCount(1, { timeout })
    })

    test('chat keeps the name a message was sent with', async () => {
      await openChat(guest!.page)
      await setName(guest!.page, 'Ada')
      await sendChat(guest!.page, 'as Ada')
      await setName(guest!.page, 'Grace')
      await sendChat(guest!.page, 'as Grace')
      await setName(guest!.page, '')
      await sendChat(guest!.page, 'unnamed')

      await openChat(owner!.page)
      const named = (text: string) =>
        owner!.page.locator('.chat-message').filter({ hasText: text }).locator('.chat-name')
      await expect(named('as Ada')).toHaveText('Ada', { timeout })
      await expect(named('as Grace')).toHaveText('Grace', { timeout })
      await expect(owner!.page.locator('.chat-message').filter({ hasText: 'unnamed' })).toHaveCount(1, { timeout })
      await expect(named('unnamed')).toHaveCount(0)
    })

    test('modules get the name in username, and displayName stays the short ID', async () => {
      await ownerAddProbeModule(owner!)
      await setName(guest!.page, 'Ada')

      const users = () => inProbe(owner!, () => (window as any).Edrys.liveClass.users)
      await expect.poll(async () => (await users())[guest!.peerId]?.username, { timeout }).toBe('Ada')
      expect((await users())[guest!.peerId].displayName).not.toBe('Ada')
    })
  })

  test('the dev agent and the tutor get the name', async ({ browser }) => {
    const dev = await openDevClass(browser)
    owner = dev.owner
    guest = await joinClassroom(browser, dev.joinUrl)
    await waitForVerified(owner, guest)
    await waitForVerified(guest, owner)
    await expect(guest.page.locator('[data-test=tutor-button]')).toBeVisible({ timeout: 45000 * SCALE })

    await setName(guest.page, 'Ada')
    await expect
      .poll(() => JSON.stringify(dev.dev.reports).includes('"username":"Ada"'), { timeout })
      .toBe(true)
    // the owner tab's user list, where the relay reads the name, is throttled
    await expect
      .poll(() => owner!.page.locator('.room-user').filter({ hasText: 'Ada' }).count(), { timeout })
      .toBe(1)

    await askTutor(guest.page, 'Why does my LED not light?')
    await expect(tutorDrawer(guest.page).getByText('Echo: Why does my LED not light?')).toBeVisible({ timeout })
    expect(dev.dev.reports.find((r: any) => r.type === 'tutor-ask').name).toMatch(/^Ada · \S+$/)
  })
})
