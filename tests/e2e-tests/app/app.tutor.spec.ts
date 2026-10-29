import { test, expect } from '@playwright/test'
import { joinClassroom, closeSessions, Session } from '../helpers'
import { SCALE, waitForVerified } from '../comm/helpers'
import { openDevClass, askTutor, tutorDrawer } from '../edrys-dev'

/**
 * The student tutor of edrys-dev --tutor, with a stand-in for edrys-dev (see
 * ../edrys-dev.ts): the owner tab offers it, a student asks in its drawer,
 * the owner tab passes the question on and the answer back, and the switch
 * in edrys-dev withdraws the button.
 */

test.describe('App — the student tutor', () => {
  let owner: Session | undefined
  let student: Session | undefined

  test.afterEach(async () => {
    await closeSessions(owner, student)
    owner = student = undefined
  })

  test('a student asks the tutor and gets its answer through the owner tab', async ({ browser }) => {
    const dev = await openDevClass(browser)
    owner = dev.owner
    student = await joinClassroom(browser, dev.joinUrl)
    await waitForVerified(owner, student)
    await waitForVerified(student, owner)

    const button = student.page.locator('[data-test=tutor-button]')
    await expect(button).toBeVisible({ timeout: 30000 * SCALE })
    // the owner offers it; it does not ask itself
    await expect(owner.page.locator('[data-test=tutor-button]')).toHaveCount(0)

    await askTutor(student.page, 'Why does my LED not light?')
    await expect(tutorDrawer(student.page).getByText('Echo: Why does my LED not light?')).toBeVisible({
      timeout: 30000 * SCALE,
    })

    // edrys-dev got it from the owner tab in plain text, with the student and room
    const ask = dev.dev.reports.find((r) => r.type === 'tutor-ask')
    expect(ask).toMatchObject({ text: 'Why does my LED not light?', student: student.peerId.split('_')[0] })
    expect(typeof ask.room).toBe('string')
  })

  test('the tutor switched off in edrys-dev withdraws the button; on, it comes back', async ({ browser }) => {
    const dev = await openDevClass(browser)
    owner = dev.owner
    student = await joinClassroom(browser, dev.joinUrl)
    const button = student.page.locator('[data-test=tutor-button]')
    await expect(button).toBeVisible({ timeout: 45000 * SCALE })

    await dev.dev.setTutor(false)
    await expect(button).toHaveCount(0, { timeout: 30000 * SCALE })
    await dev.dev.setTutor(true)
    await expect(button).toBeVisible({ timeout: 30000 * SCALE })
  })
})
