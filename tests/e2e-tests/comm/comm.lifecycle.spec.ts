import { test, expect } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, sleep, Session, TRANSPORT } from '../helpers'
import { SCALE, eventually, waitForVerified } from './helpers'

/**
 * Peers leaving and reloading.
 *
 * - Leave: closing a context skips beforeunload, so no graceful `stop()` runs;
 *   the owner must notice via the transport (WebRTC peer disconnect / WS
 *   heartbeat timeout) and drop the entry.
 * - Reload: the reloaded peer comes back under a new session id and must
 *   reappear at the owner each time, without a ghost of the old session
 *   lingering. Over WS this is where the pull-on-connect divergence and the
 *   session-swap false "has left" showed up.
 *
 * The owner runs with the `ts:peer` debug namespace on so "has left" lines are
 * observable in its console.
 */

const ROUNDS = Number(process.env.ROUNDS || 3)
const LEFT = 'has left the room'

test.describe('Comm — leave and reload', () => {
  let owner: Session | undefined
  let guest: Session | undefined
  let ownerLog: string[] = []

  test.beforeEach(async ({ browser }) => {
    const created = await createClassroom(browser, {
      initScript: () => localStorage.setItem('debug', 'ts:peer'),
    })
    owner = created.owner
    ownerLog = []
    owner.page.on('console', (m) => ownerLog.push(m.text()))
    guest = await joinClassroom(browser, created.joinUrl)
    await waitForMesh(owner, guest)
  })

  test.afterEach(async () => {
    await closeSessions(owner, guest)
    owner = guest = undefined
  })

  test('a peer that disappears is detected as left', async () => {
    const id = guest!.peerId
    // Leave detection keys off the identity handshake (WS: first heartbeat).
    await waitForVerified(owner!, guest!)
    await guest!.context.close()
    await eventually(owner!, `return !p.y.users.has(${JSON.stringify(id)})`, 'owner dropped the closed peer', 45000)
    expect(ownerLog.some((l) => l.includes(LEFT) && l.includes(id)), 'owner logged the leave').toBe(true)
    guest = undefined
  })

  test('a peer that disappears right after joining is detected as left', async () => {
    // No wait for verification: over WS the leave timer only starts once the
    // peer's first identity heartbeat arrived, so it must go out on connect.
    const id = guest!.peerId
    await guest!.context.close()
    await eventually(owner!, `return !p.y.users.has(${JSON.stringify(id)})`, 'owner dropped the closed peer', 45000)
    guest = undefined
  })

  test(`a reloading peer reconverges at the owner (x${ROUNDS})`, async () => {
    test.setTimeout((30000 + ROUNDS * 45000) * SCALE)
    const base = guest!.peerId.split('_')[0]
    const sessionsOfGuest = `return Object.keys(p.y.users.toJSON()).filter((id) => id.split('_')[0] === ${JSON.stringify(base)})`

    for (let round = 1; round <= ROUNDS; round++) {
      const oldId = guest!.peerId
      await guest!.page.reload()
      let newId = ''
      for (let i = 0; i < 30 && (!newId || newId === oldId); i++) {
        newId = await inPeer<string>(guest!.page, 'return p.peerID').catch(() => '')
        if (!newId || newId === oldId) await sleep(1000)
      }
      expect(newId, `round ${round}: guest got a new session id`).not.toBe(oldId)
      guest!.peerId = newId

      await eventually(owner!, `return p.y.users.has(${JSON.stringify(newId)})`, `round ${round}: owner sees reloaded guest`)
      await eventually(guest!, `return p.y.users.has(${JSON.stringify(owner!.peerId)})`, `round ${round}: reloaded guest sees owner`)
    }

    // Old sessions are reaped: exactly one entry for the guest's pubkey remains.
    await expect
      .poll(() => inPeer<string[]>(owner!.page, sessionsOfGuest), { timeout: 30000 * SCALE })
      .toEqual([guest!.peerId])

    // WebRTC really disconnects on reload, so a "has left" there is truthful.
    // On WS the old session's heartbeat timeout fires after the new one is
    // present, and must be swallowed as a session swap.
    if (TRANSPORT === 'ws') {
      expect(ownerLog.filter((l) => l.includes(LEFT) && l.includes(base))).toEqual([])
    }
  })
})
