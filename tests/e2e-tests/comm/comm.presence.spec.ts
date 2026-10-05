import { test } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, Session } from '../helpers'
import { eventually } from './helpers'

/**
 * Presence with three peers, checked on every peer's rendered users: who is
 * there, with which role, in which room, and who has left. Two peers can't
 * tell "A relays B's entry" from "A and B talk directly"; a third catches
 * presence that only reaches some peers.
 */
test.describe('Comm — presence (3 peers)', () => {
  let owner: Session | undefined
  let a: Session | undefined
  let b: Session | undefined

  test.beforeEach(async ({ browser }) => {
    const created = await createClassroom(browser)
    owner = created.owner
    a = await joinClassroom(browser, created.joinUrl)
    b = await joinClassroom(browser, created.joinUrl)
    await waitForMesh(owner, a)
    await waitForMesh(owner, b)
    await waitForMesh(a, b)
  })

  test.afterEach(async () => {
    await closeSessions(owner, a, b)
    owner = a = b = undefined
  })

  const all = () => [owner!, a!, b!]
  const name = (s: Session) => (s === owner ? 'owner' : s === a ? 'guest A' : 'guest B')

  test('every peer shows everyone with their role', async () => {
    const expected = JSON.stringify({
      [owner!.peerId]: 'teacher',
      [a!.peerId]: 'student',
      [b!.peerId]: 'student',
    })
    for (const s of all()) {
      await eventually(
        s,
        `const want = ${expected};
         return Object.keys(want).every((id) => v.users[id]?.role === want[id]);`,
        `${name(s)} shows all three peers with their roles`
      )
    }
  })

  test("each guest's room move reaches both other peers", async () => {
    await inPeer(owner!.page, `p.addRoom('Room 1'); p.addRoom('Room 2'); return true`)
    for (const s of all()) {
      await eventually(s, `return 'Room 1' in v.rooms && 'Room 2' in v.rooms`, `${name(s)} shows both rooms`)
    }

    await inPeer(a!.page, `p.gotoRoom('Room 1'); return true`)
    await inPeer(b!.page, `p.gotoRoom('Room 2'); return true`)

    const placed = `return v.users[${JSON.stringify(a!.peerId)}]?.room === 'Room 1' &&
      v.users[${JSON.stringify(b!.peerId)}]?.room === 'Room 2' &&
      v.users[${JSON.stringify(owner!.peerId)}]?.room === 'Lobby'`
    for (const s of all()) {
      await eventually(s, placed, `${name(s)} shows A in Room 1, B in Room 2, owner in Lobby`)
    }
  })

  test('a peer that leaves disappears from both others, who keep each other', async () => {
    const goneId = JSON.stringify(b!.peerId)
    await b!.context.close()
    b = undefined

    const remaining = `return !(${goneId} in v.users) &&
      ${JSON.stringify(owner!.peerId)} in v.users && ${JSON.stringify(a!.peerId)} in v.users`
    await eventually(owner!, remaining, 'owner dropped B and still shows A', 45000)
    await eventually(a!, remaining, 'guest A dropped B and still shows the owner', 45000)
  })
})
