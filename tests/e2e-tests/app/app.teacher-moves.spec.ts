import { test, expect } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, Session } from '../helpers'
import { SCALE, waitForVerified } from '../comm/helpers'
import { openStationAsOwner, stationUrl } from '../load/helpers'

/**
 * "Only teachers can move students": the owner turns it on in Settings, the
 * student is locked to where they are, and the owner moves them with the
 * move menu on their row, to a room or a station.
 */
test.describe('App — teacher moves students', () => {
  let owner: Session | undefined
  let guest: Session | undefined
  let station: Session | undefined
  let joinUrl: string

  test.beforeEach(async ({ browser }) => {
    const created = await createClassroom(browser)
    owner = created.owner
    joinUrl = created.joinUrl
    guest = await joinClassroom(browser, joinUrl)
    await waitForMesh(owner, guest)
    await waitForVerified(owner, guest)
    await waitForVerified(guest, owner)
  })

  test.afterEach(async () => {
    // the station shares the owner's context
    await closeSessions(owner, guest)
    owner = guest = station = undefined
  })

  const timeout = 20000 * SCALE

  /** Saves the room count and the setting in Settings, then closes it. */
  async function saveSettings({ rooms, teacherMoves }: { rooms?: number; teacherMoves: boolean }) {
    const page = owner!.page
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page
      .locator('.v-overlay--active .v-card')
      .filter({ has: page.getByRole('tab', { name: 'Members' }) })
    await dialog.getByRole('tab', { name: 'Main' }).click()
    if (rooms !== undefined) await dialog.locator('.rooms-num input').fill(String(rooms))
    await dialog.getByLabel('Only teachers can move students').setChecked(teacherMoves)
    await dialog.getByRole('button', { name: /^Save( Badge)?$/ }).click()
    // the drawer misbehaves while Settings is still open
    await dialog.getByRole('button', { name: 'Close' }).first().click()
    await expect(dialog).toBeHidden()
  }

  const guestRoom = () => inPeer<string>(guest!.page, 'return p.user()?.room')
  const guestLocked = () => inPeer<boolean>(guest!.page, 'return p.isLocked()')

  /** Opens the move menu on the guest's row in the owner's room list. */
  async function openMoveMenu() {
    const name = await inPeer<string>(
      owner!.page,
      `return p._viewUsers()[${JSON.stringify(guest!.peerId)}]?.displayName`
    )
    const button = owner!.page.getByRole('button', { name: `Move ${name}`, exact: true })
    await expect(button).toBeVisible({ timeout })
    await button.click()
    const menu = owner!.page.getByRole('menu', { name: `Move ${name} to` })
    await expect(menu).toBeVisible()
    return menu
  }

  test('the owner moves a locked student into a room', async () => {
    await saveSettings({ rooms: 2, teacherMoves: true })
    await expect.poll(guestLocked, { timeout }).toBe(true)

    // the student sees the rooms and the lock, but can't go anywhere
    const guestPage = guest!.page
    await expect(guestPage.locator('.drawer-locked')).toHaveText('Your teacher moves you between rooms')
    await expect(guestPage.locator('.room-row').filter({ hasText: 'Room 2' })).toBeVisible({ timeout })
    await expect(guestPage.getByRole('button', { name: /^Go to / })).toHaveCount(0)
    await guestPage.locator('.room-row').filter({ hasText: 'Room 1' }).click()
    await expect.poll(guestRoom).toBe('Lobby')

    const menu = await openMoveMenu()
    await expect(menu.getByRole('menuitem', { name: /Lobby/ })).toHaveAttribute('aria-disabled', 'true')
    await menu.getByRole('menuitem', { name: /Room 2/ }).click()

    await expect.poll(guestRoom, { timeout }).toBe('Room 2')
    await expect(guestPage.getByText('Your teacher moved you to Room 2')).toBeVisible()
    // the owner sees the student there
    await expect
      .poll(() => inPeer(owner!.page, `return p._viewUsers()[${JSON.stringify(guest!.peerId)}]?.room`), { timeout })
      .toBe('Room 2')
  })

  test('the owner moves a locked student to a station', async () => {
    await saveSettings({ teacherMoves: true })
    await expect.poll(guestLocked, { timeout }).toBe(true)

    const match = joinUrl.match(/\/classroom\/([^/]+)\/([^/?#]+)/)
    if (!match) throw new Error(`could not parse classroom id/owner out of ${joinUrl}`)
    station = await openStationAsOwner(owner!, stationUrl(match[1], match[2]))
    const sid = station.peerId
    await expect
      .poll(() => inPeer(guest!.page, `return ${JSON.stringify(sid)} in p._viewRooms(false)`), { timeout })
      .toBe(true)

    await owner!.page.bringToFront()
    const menu = await openMoveMenu()
    await menu.getByRole('menuitem', { name: new RegExp(sid.replace('Station ', '')) }).click()

    await expect.poll(guestRoom, { timeout }).toBe(sid)
    await expect
      .poll(() => inPeer(station!.page, `return p._viewUsers()[${JSON.stringify(guest!.peerId)}]?.room`), { timeout })
      .toBe(sid)
  })

  test('the owner picks two students and moves them together', async ({ browser }) => {
    const second = await joinClassroom(browser, joinUrl)
    try {
      await waitForMesh(owner!, second)
      await waitForVerified(owner!, second)
      await waitForVerified(second, owner!)
      await saveSettings({ rooms: 2, teacherMoves: true })
      for (const s of [guest!, second]) {
        await expect.poll(() => inPeer(s.page, 'return p.isLocked()'), { timeout }).toBe(true)
      }

      const page = owner!.page
      await expect(page.locator('.user-move')).toHaveCount(2, { timeout })
      await page.getByRole('button', { name: 'Select', exact: true }).click()
      const boxes = page.getByRole('checkbox', { name: /^Select / })
      await expect(boxes).toHaveCount(2)
      await boxes.nth(0).check()
      await boxes.nth(1).check()
      await expect(page.locator('.select-count')).toHaveText('2 selected')

      await page.getByRole('button', { name: 'Move to…' }).click()
      const menu = page.getByRole('menu', { name: 'Move 2 students to' })
      await expect(menu.getByRole('menuitem', { name: /Lobby/ })).toContainText('2 here')
      await menu.getByRole('menuitem', { name: /Room 2/ }).click()

      for (const s of [guest!, second]) {
        await expect.poll(() => inPeer(s.page, 'return p.user()?.room'), { timeout }).toBe('Room 2')
      }
      // picking ends with the move
      await expect(page.getByRole('button', { name: 'Select', exact: true })).toBeVisible()
    } finally {
      await closeSessions(second)
    }
  })

  test('turning the setting on keeps the student where they are, turning it off frees them', async () => {
    await saveSettings({ rooms: 1, teacherMoves: false })
    const roomRow = (text: string) => guest!.page.locator('.room-row').filter({ hasText: text })
    await expect(roomRow('Room 1')).toBeVisible({ timeout })
    await roomRow('Room 1').click()
    await expect.poll(guestRoom, { timeout }).toBe('Room 1')

    await saveSettings({ teacherMoves: true })
    await expect.poll(guestLocked, { timeout }).toBe(true)
    await expect(guest!.page.locator('.drawer-locked')).toBeVisible()
    await roomRow('Lobby').click()
    await expect.poll(guestRoom).toBe('Room 1')

    await saveSettings({ teacherMoves: false })
    await expect.poll(guestLocked, { timeout }).toBe(false)
    await expect(guest!.page.locator('.drawer-locked')).toBeHidden()
    await guest!.page.getByRole('button', { name: /^Go to Lobby/ }).click()
    await expect.poll(guestRoom, { timeout }).toBe('Lobby')
  })
})
