import { test } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, syncWait, Session } from '../helpers'
import { eventually, marker } from './helpers'

/**
 * A peer that republishes a room record must keep syncing afterwards.
 *
 * The republish consumes the writing client's Yjs clock; if it is never
 * sent, every later update from that client lacks its predecessor on the
 * other peers and is parked as pending forever — the peer silently stops
 * propagating. Here a third peer forges an unsigned room and deletes one of
 * the owner's, so the owner republishes it, then both must still see each
 * other's writes.
 */
test.describe('Comm — after a republish', () => {
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

  test('peers keep propagating their own writes after a republish', async () => {
    const kept = JSON.stringify(marker('Kept'))
    await inPeer(owner!.page, `p.addRoom(${kept}); return true`)
    await eventually(guest!, `return ${kept} in v.rooms`, 'guest sees the owner room')
    await eventually(attacker!, `return p.y.roomSigs.has(${kept})`, 'attacker has the owner room')

    await inPeer(
      attacker!.page,
      `const Ctor = p.y.rooms.get('Lobby').constructor;
       p.y.doc.transact(() => {
         p.y.rooms.set('Forged', new Ctor());
         p.y.rooms.delete(${kept});
         p.y.roomSigs.delete(${kept});
       });
       return true`
    )
    await syncWait()
    const intact = `return !('Forged' in v.rooms) && ${kept} in v.rooms && p.y.roomSigs.has(${kept})`
    await eventually(owner!, intact, 'owner republished its room and ignores the forged one')
    await eventually(guest!, intact, 'guest received the republished room')

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
