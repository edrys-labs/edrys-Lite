import { test } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, syncWait, Session } from '../helpers'
import { eventually, marker } from './helpers'

/**
 * A peer that reverts an invalid change must keep syncing afterwards.
 *
 * The revert consumes the reverting client's Yjs clock; if it is never sent,
 * every later update from that client lacks its predecessor on the other
 * peers and is parked as pending forever — the peer silently stops
 * propagating. Here a third peer forges an unsigned edit of the owner's
 * entry, so owner and guest both revert it, then must still see each other.
 */
test.describe('Comm — after a revert', () => {
  let owner: Session | undefined
  let guest: Session | undefined
  let attacker: Session | undefined

  test.beforeEach(async ({ browser }) => {
    const created = await createClassroom(browser)
    owner = created.owner
    guest = await joinClassroom(browser, created.joinUrl)
    attacker = await joinClassroom(browser, created.joinUrl)
    await waitForMesh(owner, guest)
    await waitForMesh(owner, attacker)
    await waitForMesh(guest, attacker)
  })

  test.afterEach(async () => {
    await closeSessions(owner, guest, attacker)
    owner = guest = attacker = undefined
  })

  test('peers that reverted a forged change keep propagating their own writes', async () => {
    const ownerId = JSON.stringify(owner!.peerId)
    await inPeer(attacker!.page, `p.y.doc.transact(() => p.y.users.get(${ownerId}).set('room', 'Forged')); return true`)
    await syncWait()
    const intact = `return p.y.users.get(${ownerId})?.get('room') === 'Lobby'`
    await eventually(owner!, intact, 'owner reverted the forged room')
    await eventually(guest!, intact, 'guest reverted the forged room')

    const room = marker('After')
    await inPeer(owner!.page, `p.addRoom(${JSON.stringify(room)}); return true`)
    await eventually(guest!, `return p.y.rooms.has(${JSON.stringify(room)})`, "guest sees the owner's later room")

    await inPeer(guest!.page, `p.gotoRoom(${JSON.stringify(room)}); return true`)
    await eventually(
      owner!,
      `return p.y.users.get(${JSON.stringify(guest!.peerId)})?.get('room') === ${JSON.stringify(room)}`,
      "owner sees the guest's later move"
    )
  })
})
