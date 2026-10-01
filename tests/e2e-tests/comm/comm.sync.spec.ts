import { test } from '@playwright/test'
import { createClassroom, joinClassroom, waitForMesh, inPeer, closeSessions, Session } from '../helpers'
import { eventually, waitForVerified, marker } from './helpers'

/**
 * Shared Yjs state reaches every peer, in both directions: presence, rooms,
 * room moves, chat — and a peer joining late receives all of it.
 */
test.describe('Comm — shared state', () => {
  let owner: Session | undefined
  let guest: Session | undefined
  let late: Session | undefined
  let joinUrl = ''

  test.beforeEach(async ({ browser }) => {
    const created = await createClassroom(browser)
    owner = created.owner
    joinUrl = created.joinUrl
    guest = await joinClassroom(browser, created.joinUrl)
    await waitForMesh(owner, guest)
  })

  test.afterEach(async () => {
    await closeSessions(owner, guest, late)
    owner = guest = late = undefined
  })

  test('peers see each other with a verified identity', async () => {
    await waitForVerified(owner!, guest!)
    await waitForVerified(guest!, owner!)
  })

  test('room created by the owner reaches the guest; guest moving is seen by the owner', async () => {
    await inPeer(owner!.page, `p.addRoom('Room 1'); return true`)
    await eventually(guest!, `return p.y.rooms.has('Room 1')`, 'guest sees Room 1')

    await inPeer(guest!.page, `p.gotoRoom('Room 1'); return true`)
    await eventually(
      owner!,
      `return p.y.users.toJSON()[${JSON.stringify(guest!.peerId)}]?.room === 'Room 1'`,
      'owner sees guest in Room 1'
    )
  })

  test('chat messages arrive in both directions and stay visible', async () => {
    const fromOwner = marker('owner-chat')
    const fromGuest = marker('guest-chat')
    await inPeer(owner!.page, `p.sendMessage(${JSON.stringify(fromOwner)}); return true`)
    await inPeer(guest!.page, `p.sendMessage(${JSON.stringify(fromGuest)}); return true`)

    const bothVisible = `
      const visible = p.y.chat.toArray()
        .filter((_, i) => !p._invalidChatIndices.has(i))
        .map((m) => m.msg);
      return visible.includes(${JSON.stringify(fromOwner)}) && visible.includes(${JSON.stringify(fromGuest)});
    `
    await eventually(owner!, bothVisible, 'owner shows both chat messages')
    await eventually(guest!, bothVisible, 'guest shows both chat messages')
  })

  test('a late joiner receives rooms, chat and everyone present', async ({ browser }) => {
    const chat = marker('before-late')
    await inPeer(owner!.page, `p.addRoom('Room 1'); return true`)
    await inPeer(owner!.page, `p.sendMessage(${JSON.stringify(chat)}); return true`)
    await eventually(guest!, `return p.y.rooms.has('Room 1')`, 'guest sees Room 1')

    late = await joinClassroom(browser, joinUrl)
    const ids = JSON.stringify([owner!.peerId, guest!.peerId])
    await eventually(
      late,
      `
      const users = Object.keys(p.y.users.toJSON());
      const chat = p.y.chat.toArray().filter((_, i) => !p._invalidChatIndices.has(i)).map((m) => m.msg);
      return p.y.rooms.has('Room 1') && chat.includes(${JSON.stringify(chat)}) &&
        ${ids}.every((id) => users.includes(id));
    `,
      'late joiner has room, chat and both peers'
    )
    // And the existing peers see the newcomer.
    const lateId = JSON.stringify(late.peerId)
    await eventually(owner!, `return p.y.users.has(${lateId})`, 'owner sees late joiner')
    await eventually(guest!, `return p.y.users.has(${lateId})`, 'guest sees late joiner')
  })
})
