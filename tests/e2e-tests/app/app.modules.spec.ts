import { test, expect } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, Session } from '../helpers'
import { SCALE, eventually, marker, waitForVerified } from '../comm/helpers'
import { routeProbeModule, ownerAddProbeModule, probe, inProbe, probeReceived } from './probe-module'

/**
 * Modules running in their real iframes. comm/ drives the Peer directly; here
 * every send and every assertion happens inside the probe module, so the
 * postMessage bridge (Module.vue / Modules.vue <-> edrys.js) is on the path:
 * messages, app awareness, and shared Yjs state incl. after a reload.
 */
test.describe('App — modules in iframes', () => {
  let owner: Session | undefined
  let guest: Session | undefined

  test.beforeEach(async ({ browser }) => {
    const opts = { prepare: routeProbeModule }
    const created = await createClassroom(browser, opts)
    owner = created.owner
    guest = await joinClassroom(browser, created.joinUrl, opts)
    await waitForMesh(owner, guest)
    await waitForVerified(owner, guest)
    await waitForVerified(guest, owner)

    // The module list reaches the guest through the signed setup.
    await ownerAddProbeModule(owner)
    await probe(owner)
    await probe(guest)
  })

  test.afterEach(async () => {
    await closeSessions(owner, guest)
    owner = guest = undefined
  })

  const send = (s: Session, subject: string, body: any, user?: string) =>
    inProbe(s, ([subj, b, u]) => (window as any).Edrys.sendMessage(subj, b, u), [subject, body, user] as const)

  test('module messages arrive in both directions, and targeted ones reach their target', async () => {
    const fromOwner = marker('owner-msg')
    const fromGuest = marker('guest-msg')
    const targeted = marker('targeted')

    // Non-string body: exercises the msgpack encode/decode in edrys.js.
    await send(owner!, fromOwner, { n: 1, s: 'hi' })
    await expect.poll(() => probeReceived(guest!, fromOwner), { timeout: 10000 * SCALE }).toEqual([{ n: 1, s: 'hi' }])

    await send(guest!, fromGuest, 'from guest')
    await expect.poll(() => probeReceived(owner!, fromGuest), { timeout: 10000 * SCALE }).toEqual(['from guest'])

    await send(owner!, targeted, 'only guest', guest!.peerId)
    await expect.poll(() => probeReceived(guest!, targeted), { timeout: 10000 * SCALE }).toEqual(['only guest'])
  })

  test('module awareness propagates in both directions and is removed', async () => {
    const set = (s: Session, v: string) =>
      inProbe(s, (val) => (window as any).__probe.aw.setLocalStateField('cursor', val), v)
    const sees = (s: Session, v: string) =>
      inProbe(
        s,
        (val) => Array.from((window as any).__probe.aw.getStates().values()).some((st: any) => st?.cursor === val),
        v
      ).catch(() => false)

    const o = marker('owner-cursor')
    const g = marker('guest-cursor')
    await set(owner!, o)
    await set(guest!, g)
    await expect.poll(() => sees(guest!, o), { timeout: 15000 * SCALE }).toBe(true)
    await expect.poll(() => sees(owner!, g), { timeout: 15000 * SCALE }).toBe(true)

    await inProbe(owner!, () => (window as any).__probe.aw.setLocalState(null))
    await expect.poll(() => sees(guest!, o), { timeout: 15000 * SCALE }).toBe(false)
  })

  test('shared module text syncs both ways and survives a reload', async () => {
    test.setTimeout(test.info().timeout + 60000 * SCALE)
    const KEY = 'e2e-text'
    const text = (s: Session) =>
      inProbe(s, (k) => (window as any).Edrys.getState(k)?.toString() ?? null, KEY).catch(() => null)
    const append = (s: Session, v: string) =>
      inProbe(s, ([k, val]) => {
        const t = (window as any).Edrys.getState(k, 'Text')
        t.insert(t.length, val)
      }, [KEY, v] as const)

    // Owner creates the Y.Text; the guest only writes once it has it, so the
    // two never race to create competing instances under the same key.
    await append(owner!, 'A')
    await expect.poll(() => text(guest!), { timeout: 15000 * SCALE }).toBe('A')

    await append(guest!, 'B')
    await expect.poll(() => text(owner!), { timeout: 15000 * SCALE }).toBe('AB')

    await append(owner!, 'C')
    await expect.poll(() => text(guest!), { timeout: 15000 * SCALE }).toBe('ABC')

    // Reload: new session id, module re-inits from the local doc + resync.
    const oldId = guest!.peerId
    await guest!.page.reload()
    await expect
      .poll(() => inPeer<string>(guest!.page, 'return p.peerID').catch(() => oldId), { timeout: 30000 * SCALE })
      .not.toBe(oldId)
    guest!.peerId = await inPeer<string>(guest!.page, 'return p.peerID')
    await eventually(owner!, `return ${JSON.stringify(guest!.peerId)} in v.users`, 'owner sees reloaded guest')

    await expect.poll(() => text(guest!), { timeout: 30000 * SCALE }).toBe('ABC')

    // Writes after the reload still propagate both ways.
    await append(guest!, 'D')
    await expect.poll(() => text(owner!), { timeout: 15000 * SCALE }).toBe('ABCD')
    await append(owner!, 'E')
    await expect.poll(() => text(guest!), { timeout: 15000 * SCALE }).toBe('ABCDE')
  })
})
