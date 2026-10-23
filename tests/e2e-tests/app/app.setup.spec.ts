import { test, expect, Page, Locator } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, sleep, Session, TRANSPORT } from '../helpers'
import { SCALE, eventually, marker, waitForVerified } from '../comm/helpers'
import { routeProbeModule, probe, MODULE_URL } from './probe-module'

/**
 * The owner's real setup flow: configure the class through the Settings dialog,
 * share the Communication tab's "Shareable Link", and have a guest join from
 * it. Checks that the owner-signed setup (name, meta, modules, members) reaches
 * the guest and is acted on, that the link carries the owner trust anchor, and
 * that the guest keeps the setup once the owner is gone.
 */

const settingsDialog = (page: Page) =>
  page.locator('.v-overlay--active .v-card').filter({ has: page.getByRole('tab', { name: 'Members' }) })

async function openSettings(page: Page): Promise<Locator> {
  const dialog = settingsDialog(page)
  if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Settings' }).click()
  await expect(dialog).toBeVisible()
  return dialog
}

async function save(dialog: Locator) {
  // "Save Badge" while the unsaved-changes dot is shown.
  await dialog.getByRole('button', { name: /^Save( Badge)?$/ }).click()
}

const peerId = (s: Session) => inPeer<string>(s.page, 'return p.peerID')

/**
 * Let a save settle. A save that changes the signed communicationConfig reloads
 * the page 3s later (Peer.logSetupChanges) under a new session id; wait past
 * that and pick up the current id. Returns whether the session reloaded.
 */
async function settle(s: Session): Promise<boolean> {
  const before = s.peerId
  await sleep(5000)
  await expect.poll(() => peerId(s).catch(() => ''), { timeout: 30000 * SCALE }).not.toBe('')
  s.peerId = await peerId(s)
  return s.peerId !== before
}

test.describe('App — owner setup, share and join', () => {
  let owner: Session | undefined
  let guest: Session | undefined

  test.afterEach(async () => {
    await closeSessions(owner, guest)
    owner = guest = undefined
  })

  test('a guest joining from the shared link gets the configured class, and keeps it', async ({ browser }) => {
    test.setTimeout(test.info().timeout + 120000 * SCALE)
    const opts = { prepare: routeProbeModule }
    owner = (await createClassroom(browser, opts)).owner
    const name = marker('E2E').slice(0, 20)

    // ── Owner configures the class through the UI ──
    let dialog = await openSettings(owner.page)
    await dialog.getByRole('tab', { name: 'Main' }).click()
    await dialog.getByLabel('Class Name').fill(name)
    await dialog.getByLabel('Default number of rooms (optional)').fill('2')

    await dialog.getByRole('tab', { name: 'Modules' }).click()
    await dialog.getByLabel('Module URL').fill(MODULE_URL)
    await dialog.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(dialog.getByText('E2E Probe', { exact: true })).toBeVisible({ timeout: 10000 })

    await dialog.getByRole('tab', { name: 'Communication' }).click()
    if (TRANSPORT === 'ws') await dialog.getByLabel('Keep communication settings in URL').check()
    const shareUrl = await dialog.getByRole('textbox', { name: /Shareable Link/ }).inputValue()
    expect(shareUrl.includes('#comm=ws'), `share link matches the transport: ${shareUrl}`).toBe(TRANSPORT === 'ws')
    await save(dialog)

    // On WS this first save pins "ws" into the signed setup -> one expected reload.
    await settle(owner)
    await probe(owner)

    // ── Guest joins from the shared link ──
    guest = await joinClassroom(browser, shareUrl, opts)
    await waitForMesh(owner, guest)
    await waitForVerified(guest, owner)

    // The link carries the owner hash, so the guest enforces the trust anchor.
    const ownerHash = await owner.page.evaluate(() => location.search.split('/')[3])
    expect(ownerHash, 'owner URL has an owner hash').toBeTruthy()
    expect(await inPeer(guest.page, 'return p.expectedOwner')).toBe(ownerHash)

    await expect(guest.page.getByText(name)).toBeVisible({ timeout: 20000 * SCALE })
    // Only seeded when a session starts with no rooms, so check it arrived in the setup.
    expect(await inPeer(guest.page, 'return Number(p.lab.data.meta.defaultNumberOfRooms)')).toBe(2)
    await probe(guest)
    expect(await inPeer(guest.page, 'return p.role')).toBe('student')
    await expect(guest.page.getByRole('button', { name: 'Settings' })).toHaveCount(0)

    // ── Owner promotes the guest to teacher via the Members tab ──
    dialog = await openSettings(owner.page)
    await dialog.getByRole('tab', { name: 'Members' }).click()
    await dialog.getByLabel(/Teacher IDs/).fill(guest.peerId.split('_')[0])
    await save(dialog)
    expect(await settle(owner), 'a save that keeps the transport does not reload').toBe(false)

    await eventually(guest, `return p.role === 'teacher'`, 'guest became teacher')
    await expect(guest.page.getByRole('button', { name: 'Settings' })).toBeVisible({ timeout: 10000 })

    // ── The guest keeps the signed setup without the owner ──
    await owner.context.close()
    owner = undefined
    await guest.page.reload()
    await expect(guest.page.getByText(name)).toBeVisible({ timeout: 20000 * SCALE })
    await probe(guest)
    await eventually(guest, `return p.role === 'teacher'`, 'guest is still teacher after reload')
  })
})
