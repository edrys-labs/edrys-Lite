import { test } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, Session } from '../helpers'
import { eventually, marker } from './helpers'

/**
 * App awareness (module cursors/presence) — the channel kept separate from the
 * identity handshake. Over WS this depends on the relay forwarding the channel
 * byte intact, so a server/client wire mismatch shows up here first.
 */
test.describe('Comm — app awareness', () => {
  let owner: Session | undefined
  let guest: Session | undefined

  test.beforeEach(async ({ browser }) => {
    const created = await createClassroom(browser)
    owner = created.owner
    guest = await joinClassroom(browser, created.joinUrl)
    await waitForMesh(owner, guest)
  })

  test.afterEach(async () => {
    await closeSessions(owner, guest)
    owner = guest = undefined
  })

  const set = (s: Session, value: string) =>
    inPeer(s.page, `p.getAwareness().setLocalStateField('e2e', ${JSON.stringify(value)}); return true`)

  // Expression: some remote/local awareness state carries `value`.
  const has = (value: string) =>
    `Array.from(p.getAwareness().getStates().values()).some((st) => st && st.e2e === ${JSON.stringify(value)})`

  test('awareness state propagates in both directions', async () => {
    const fromOwner = marker('owner-cursor')
    const fromGuest = marker('guest-cursor')
    await set(owner!, fromOwner)
    await set(guest!, fromGuest)
    await eventually(guest!, `return ${has(fromOwner)}`, 'guest sees owner awareness')
    await eventually(owner!, `return ${has(fromGuest)}`, 'owner sees guest awareness')
  })

  test('awareness updates and removal propagate', async () => {
    const first = marker('first')
    const second = marker('second')
    await set(owner!, first)
    await eventually(guest!, `return ${has(first)}`, 'guest sees first value')

    await set(owner!, second)
    await eventually(guest!, `return ${has(second)} && !${has(first)}`, 'guest sees only the updated value')

    await inPeer(owner!.page, `p.getAwareness().setLocalState(null); return true`)
    await eventually(guest!, `return !${has(second)}`, 'guest drops removed state')
  })
})
