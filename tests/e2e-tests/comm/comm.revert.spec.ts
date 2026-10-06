import { test } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, syncWait, Session } from '../helpers'
import { eventually, marker } from './helpers'

/**
 * A peer that reverts an invalid change must keep syncing afterwards.
 *
 * The revert consumes the reverting client's Yjs clock; if it is never sent,
 * every later update from that client lacks its predecessor on the other
 * peers and is parked as pending forever — the peer silently stops
 * propagating. Here a third peer forges an unsigned room, so owner and
 * guest both revert it, then must still see each other's writes.
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
    await inPeer(
      attacker!.page,
      `const Ctor = p.y.rooms.get('Lobby').constructor;
       p.y.doc.transact(() => p.y.rooms.set('Forged', new Ctor()));
       return true`
    )
    await syncWait()
    const intact = `return !p.y.rooms.has('Forged') && !('Forged' in v.rooms)`
    await eventually(owner!, intact, 'owner reverted the forged room')
    await eventually(guest!, intact, 'guest reverted the forged room')

    const room = marker('After')
    await inPeer(owner!.page, `p.addRoom(${JSON.stringify(room)}); return true`)
    await eventually(guest!, `return ${JSON.stringify(room)} in v.rooms`, "guest sees the owner's later room")

    await inPeer(guest!.page, `p.gotoRoom(${JSON.stringify(room)}); return true`)
    await eventually(
      owner!,
      `return v.users[${JSON.stringify(guest!.peerId)}]?.room === ${JSON.stringify(room)}`,
      "owner sees the guest's later move"
    )
  })
})
