import { test, expect } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, Session } from '../helpers'
import { SCALE, waitForVerified } from '../comm/helpers'

test.describe('App — rooms', () => {
  let owner: Session | undefined
  let guest: Session | undefined

  test.beforeEach(async ({ browser }) => {
    const created = await createClassroom(browser)
    owner = created.owner
    guest = await joinClassroom(browser, created.joinUrl)
    await waitForMesh(owner, guest)
    await waitForVerified(owner, guest)
    await waitForVerified(guest, owner)
  })

  test.afterEach(async () => {
    await closeSessions(owner, guest)
    owner = guest = undefined
  })

  const timeout = 20000 * SCALE
  const rooms = (s: Session) =>
    inPeer<string[]>(s.page, 'return Object.keys(p._viewRooms()).filter((n) => n.startsWith("Room "))')

  async function setRoomCount(page: Session['page'], count: number) {
    const dialog = page
      .locator('.v-overlay--active .v-card')
      .filter({ has: page.getByRole('tab', { name: 'Members' }) })
    // Settings stays open after a save
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Settings' }).click()
    await dialog.getByRole('tab', { name: 'Main' }).click()
    await dialog.locator('.rooms-num input').fill(String(count))
    await dialog.getByRole('button', { name: /^Save( Badge)?$/ }).click()
  }

  test('a dropped label leaves nothing unsaved and a second save keeps it gone', async () => {
    const page = owner!.page
    await page.getByRole('button', { name: 'New room' }).click()
    await expect.poll(() => rooms(owner!), { timeout }).toHaveLength(1)
    await page.getByRole('button', { name: 'New room' }).click()
    await expect.poll(() => rooms(owner!), { timeout }).toHaveLength(2)
    await page.getByRole('button', { name: 'Rename Room 2' }).click()
    await page.getByRole('textbox', { name: 'Room name' }).fill('Group B')
    await page.keyboard.press('Enter')
    await expect(page.locator('.room-name').filter({ hasText: 'Group B' })).toBeVisible({ timeout })

    await setRoomCount(page, 1)
    await expect(page.locator('.unsaved')).toHaveCount(0)

    await setRoomCount(page, 2)
    await expect(page.locator('.unsaved')).toHaveCount(0)
    await page.getByRole('button', { name: /^Save( Badge)?$/ }).click()
    await expect
      .poll(() => inPeer(page, 'return p.lab.data.meta.roomNames ?? null'), { timeout })
      .toBe(null)
  })

  test('a room dropped by lowering the count comes back empty', async () => {
    const newRoom = owner!.page.getByRole('button', { name: 'New room' })
    await newRoom.click()
    await expect.poll(() => rooms(owner!), { timeout }).toHaveLength(1)
    await newRoom.click()
    await expect.poll(() => rooms(guest!), { timeout }).toEqual(['Room 1', 'Room 2'])

    await inPeer(owner!.page, 'p.y.rooms.get("Room 2").set("notes", "old")')
    await expect
      .poll(() => inPeer(guest!.page, 'return p.roomState("Room 2")?.notes'), { timeout })
      .toBe('old')

    await setRoomCount(owner!.page, 1)
    await expect.poll(() => rooms(guest!), { timeout }).toEqual(['Room 1'])

    await setRoomCount(owner!.page, 2)
    await expect.poll(() => rooms(guest!), { timeout }).toEqual(['Room 1', 'Room 2'])
    await expect
      .poll(() => inPeer(guest!.page, 'return p.roomState("Room 2")?.notes ?? null'), { timeout })
      .toBe(null)
  })
})
