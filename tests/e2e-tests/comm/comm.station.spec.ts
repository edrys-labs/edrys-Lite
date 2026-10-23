import { test } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, Session } from '../helpers'
import { openStationAsOwner, stationUrl } from '../load/helpers'
import { eventually, enableTransportDebug, transportLog } from './helpers'

/**
 * Station lifecycle: its room and presence reach other peers, a participant
 * entering is visible to the station, and shutting it down (clearing its
 * presence) removes the station everywhere.
 *
 * Over WS the station joins with an empty doc (pull-only sync); this is where
 * seeding Lobby before sync used to trigger a revert that froze the guest.
 */
test.describe('Comm — station', () => {
  let owner: Session | undefined
  let guest: Session | undefined
  let station: Session | undefined
  let log: ReturnType<typeof transportLog>

  test.beforeEach(async ({ browser }) => {
    log = transportLog()
    const opts = { initScript: enableTransportDebug }
    const created = await createClassroom(browser, opts)
    owner = created.owner
    log.watch('owner', owner)
    guest = await joinClassroom(browser, created.joinUrl, opts)
    log.watch('guest', guest)
    await waitForMesh(owner, guest)

    const match = created.joinUrl.match(/\/classroom\/([^/]+)\/([^/?#]+)/)
    if (!match) throw new Error(`could not parse classroom id/owner out of ${created.joinUrl}`)
    station = await openStationAsOwner(owner, stationUrl(match[1], match[2]))
    log.watch('station', station)
  })

  test.afterEach(async ({}, info) => {
    await log.attachIfFailed(info)
    // station shares owner.context
    await closeSessions(owner, guest)
    owner = guest = station = undefined
  })

  test('station appears, sees participants, and its shutdown propagates', async () => {
    const sid = JSON.stringify(station!.peerId)
    const present = `return ${sid} in v.rooms && ${sid} in v.users`
    await eventually(owner!, present, 'owner sees station room + user')
    await eventually(guest!, present, 'guest sees station room + user')

    await inPeer(guest!.page, `p.gotoRoom(${sid}); return true`)
    await eventually(
      station!,
      `return v.users[${JSON.stringify(guest!.peerId)}]?.room === ${sid}`,
      'station sees guest in its room'
    )

    await inPeer(station!.page, `p.stop(); return true`)
    const gone = `return !(${sid} in v.rooms) && !(${sid} in v.users)`
    await eventually(owner!, gone, 'owner dropped the station')
    await eventually(guest!, gone, 'guest dropped the station')
  })
})
