import { test, expect, type Page } from '@playwright/test'
import { BASE_URL, createClassroom, joinClassroom, waitForMesh, closeSessions, Session } from '../helpers'
import { SCALE, waitForVerified } from '../comm/helpers'

/**
 * The class design: the owner picks it in Settings → Design, everyone in the
 * class sees it once it is saved, each person's Light/Dark choice still
 * picks the half, and pages outside the class are Standard again.
 */
test.describe('App — class design', () => {
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

  const design = (page: Page) => page.evaluate(() => document.documentElement.dataset.design)
  const half = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme)
  // the Vuetify theme on screen, e.g. playful-dark
  const theme = (page: Page) =>
    page.evaluate(() => /v-theme--([a-z]+-(?:light|dark))/.exec(document.querySelector('.v-application')!.className)?.[1])
  // a theme color as Vuetify writes it, e.g. "45,106,79"
  const color = (page: Page, name: string) =>
    page.evaluate(
      (name) =>
        getComputedStyle(document.querySelector('.v-application')!)
          .getPropertyValue(`--v-theme-${name}`)
          .replace(/\s/g, ''),
      name
    )

  /** Opens Settings → Design on the owner's page. */
  async function openDesign() {
    const page = owner!.page
    await page.getByRole('button', { name: 'Settings' }).click()
    const dialog = page
      .locator('.v-overlay--active .v-card')
      .filter({ has: page.getByRole('tab', { name: 'Members' }) })
    await dialog.getByRole('tab', { name: 'Design' }).click()
    return dialog
  }

  async function saveAndClose(dialog: ReturnType<Page['locator']>) {
    await dialog.getByRole('button', { name: /^Save( Badge)?$/ }).click()
    await dialog.getByRole('button', { name: 'Close' }).first().click()
    await expect(dialog).toBeHidden()
  }

  test('a design tried in Settings shows only to the owner until it is saved', async () => {
    const dialog = await openDesign()
    await dialog.getByRole('radio', { name: 'Compact' }).check()
    await expect.poll(() => design(owner!.page)).toBe('compact')

    // closing without saving goes back, and the guest never saw it
    await dialog.getByRole('button', { name: 'Close' }).first().click()
    await expect(dialog).toBeHidden()
    await expect.poll(() => design(owner!.page)).toBe('standard')
    expect(await design(guest!.page)).toBe('standard')
  })

  test('a saved design shows to everyone, in each person\'s own Light or Dark', async () => {
    await guest!.page.emulateMedia({ colorScheme: 'light' })
    const dialog = await openDesign()
    await dialog.getByRole('radio', { name: 'Playful' }).check()
    await saveAndClose(dialog)

    const page = guest!.page
    await expect.poll(() => design(page), { timeout }).toBe('playful')
    expect(await theme(page)).toBe('playful-light')
    await expect(page.locator('.edrys-bar .v-toolbar__content')).toHaveCSS('height', '68px')
    expect(await page.evaluate(() => getComputedStyle(document.body).fontFamily)).toContain('Fredoka')

    // the guest's system goes dark: the same design, its dark half
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect.poll(() => half(page)).toBe('dark')
    expect(await theme(page)).toBe('playful-dark')

    // the start page is Standard again
    await page.goto(BASE_URL)
    await expect(page.getByText('Create a class')).toBeVisible()
    expect(await design(page)).toBe('standard')
    expect(await theme(page)).toBe('standard-dark')
  })

  test('a class\'s own design file: good entries show to everyone, bad ones are left out', async () => {
    const dialog = await openDesign()
    await dialog.getByRole('radio', { name: 'Custom' }).check()
    const file = [
      'name: Forest',
      'base: compact',
      'light:',
      '  colors:',
      "    primary: '#2d6a4f'",
      '    background: url(https://example.com/track.png)',
    ].join('\n')
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'forest.yml',
      mimeType: 'application/yaml',
      buffer: Buffer.from(file),
    })
    await expect(dialog.locator('.custom-current')).toHaveText('Forest · based on Compact')
    await expect(dialog.locator('.custom-ignored')).toContainText('light.colors.background')
    await expect(dialog.locator('.custom-more a')).toHaveAttribute('href', /README\.md#Design-file$/)
    await saveAndClose(dialog)

    const page = guest!.page
    await page.emulateMedia({ colorScheme: 'light' })
    await expect.poll(() => theme(page), { timeout }).toBe('custom-light')
    expect(await design(page)).toBe('compact') // its base's look
    expect(await color(page, 'primary')).toBe('45,106,79')
    // the bad background is not used: Compact's own
    expect(await color(page, 'background')).toBe('236,238,241')
  })
})
