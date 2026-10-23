import { test, expect } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, closeSessions, sleep, Session } from '../helpers'
import {
  SCALE,
  eventually,
  waitForVerified,
  tapMessages,
  received,
  sendModuleMessage,
  marker,
  enableTransportDebug,
  transportLog,
} from './helpers'

/**
 * Module messages (the `broadcast` path Modules.vue uses). Peer.broadcast turns
 * even a room-wide send into one targeted send per recipient, so this covers
 * the userid → peer translation that once left messages reaching only the
 * sender. Three peers so "only the target receives it" is observable.
 */
test.describe('Comm — module messages', () => {
  let owner: Session | undefined
  let a: Session | undefined
  let b: Session | undefined
  let log: ReturnType<typeof transportLog>

  test.beforeEach(async ({ browser }) => {
    log = transportLog()
    const opts = { initScript: enableTransportDebug }
    const created = await createClassroom(browser, opts)
    owner = created.owner
    log.watch('owner', owner)
    a = await joinClassroom(browser, created.joinUrl, opts)
    log.watch('a', a)
    b = await joinClassroom(browser, created.joinUrl, opts)
    log.watch('b', b)
    await waitForMesh(owner, a)
    await waitForMesh(owner, b)
    await waitForMesh(a, b)
    for (const [x, y] of [[owner, a], [owner, b], [a, owner], [a, b], [b, owner], [b, a]] as const) {
      await waitForVerified(x!, y!)
    }
    for (const s of [owner!, a!, b!]) {
      await eventually(s, 'return p.connected === true', `${s.peerId} connected`)
      await tapMessages(s)
    }
  })

  test.afterEach(async ({}, info) => {
    await log.attachIfFailed(info)
    await closeSessions(owner, a, b)
    owner = a = b = undefined
  })

  test('a room-wide message from the owner reaches every guest', async () => {
    const subj = marker('owner-all')
    await sendModuleMessage(owner!, subj, 'hi all')
    await expect.poll(() => received(a!, subj), { timeout: 10000 * SCALE }).toEqual(['hi all'])
    await expect.poll(() => received(b!, subj), { timeout: 10000 * SCALE }).toEqual(['hi all'])
  })

  test('a room-wide message from a guest reaches the owner and the other guest', async () => {
    const subj = marker('guest-all')
    await sendModuleMessage(a!, subj, 'from a')
    await expect.poll(() => received(owner!, subj), { timeout: 10000 * SCALE }).toEqual(['from a'])
    await expect.poll(() => received(b!, subj), { timeout: 10000 * SCALE }).toEqual(['from a'])
  })

  test('a targeted message reaches only its target', async () => {
    const subj = marker('targeted')
    await sendModuleMessage(owner!, subj, 'only a', a!.peerId)
    await expect.poll(() => received(a!, subj), { timeout: 10000 * SCALE }).toEqual(['only a'])
    await sleep(3000 * SCALE)
    expect(await received(b!, subj)).toEqual([])
  })

  test('a burst of messages arrives complete', async () => {
    const subj = marker('burst')
    const N = 20
    for (let i = 0; i < N; i++) await sendModuleMessage(owner!, subj, i)
    const all = Array.from({ length: N }, (_, i) => i)
    await expect
      .poll(async () => [...(await received(a!, subj))].sort((x, y) => x - y), { timeout: 15000 * SCALE })
      .toEqual(all)
    await expect
      .poll(async () => [...(await received(b!, subj))].sort((x, y) => x - y), { timeout: 15000 * SCALE })
      .toEqual(all)
  })
})
