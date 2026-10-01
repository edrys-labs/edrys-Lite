import { describe, test, expect, vi } from 'vitest'

// Unit tests for the pure authorization rules exported from Peer.ts.
// The mocks only let Peer.ts import cleanly in the test harness.
vi.mock('../../../../src/ts/Database', () => ({
  Database: vi.fn(() => ({
    getPublicKeyRaw: vi.fn().mockResolvedValue(null),
    getPrivateKey: vi.fn().mockResolvedValue(null),
    setPublicKeyRaw: vi.fn(),
    setPrivateKey: vi.fn(),
  })),
}))
vi.mock('../../../../src/ts/GenericProviderAdapter', () => ({ GenericWebrtcProviderAdapter: vi.fn() }))
vi.mock('../../../../src/ts/GenericWebsocketProviderAdapter', () => ({ GenericWebsocketProviderAdapter: vi.fn() }))

import { isAuthorizedUserSigner, isAuthorizedRoomSigner } from '../../../../src/ts/Peer'

const OWNER = 'owner-pk'
const TEACHERS = ['teacher-pk']

// [case, id, signer, teachers, students (allowlist; omitted = none), expected]
describe('isAuthorizedUserSigner (y.users writes)', () => {
  test.each([
    // Human peers: id is "<pubkey>_<session>" and only that pubkey may sign it.
    ['own entry', 'BGdxv12345abc_sess001', 'BGdxv12345abc', [], undefined, true],
    ['someone else signs it (spoofing)', 'BGdxv12345abc_sess001', 'attacker-pk', [], undefined, false],
    ['id padded, signer not', 'BGdxv12345abc==_sess001', 'BGdxv12345abc', [], undefined, true],
    ['both padded', 'BGdxv12345abc==_sess001', 'BGdxv12345abc==', [], undefined, true],
    ['id without a session separator', 'NoSeparator', 'NoSeparator', [], undefined, false],
    ['empty signer', 'any_id', '', [], undefined, false],
    // Stations: only the owner or a teacher may sign them.
    ['station signed by the owner', 'Station myStn1', OWNER, [], undefined, true],
    ['station signed by a teacher', 'Station myStn1', 'teacher-pk', TEACHERS, undefined, true],
    ['station signed by anyone else', 'Station myStn1', 'random-pk', TEACHERS, undefined, false],
    // With a student allowlist, the signer must also be a member.
    ['listed student, own entry', 'student-pk_sess001', 'student-pk', [], ['student-pk'], true],
    ['non-member, own entry', 'random-pk_sess001', 'random-pk', [], ['alice-pk', 'bob-pk'], false],
    ['owner, not listed', 'owner-pk_sess001', OWNER, [], ['alice-pk'], true],
    ['teacher, not listed', 'teacher-pk_sess001', 'teacher-pk', TEACHERS, ['alice-pk'], true],
    ['station signed by an unlisted teacher', 'Station S1', 'rogue-teacher-pk', ['rogue-teacher-pk'], ['alice-pk'], true],
    ['station signed by a non-member', 'Station S1', 'random-pk', [], ['alice-pk'], false],
    ['listed student writing another student\'s entry', 'bob-pk_sess001', 'alice-pk', [], ['alice-pk', 'bob-pk'], false],
    ['allowlist entry padded', 'alice-pk==_sess001', 'alice-pk', [], ['alice-pk=='], true],
    ['wildcard allowlist', 'random-pk_sess001', 'random-pk', [], ['*'], true],
    ['empty allowlist', 'random-pk_sess001', 'random-pk', [], [], true],
  ])('%s', (_case, id, signer, teachers, students, expected) => {
    expect(isAuthorizedUserSigner(id, signer, OWNER, teachers as string[], students as string[] | undefined)).toBe(expected)
  })
})

// [case, room, signer, teachers, students (allowlist; omitted = none), expected]
describe('isAuthorizedRoomSigner (y.rooms writes)', () => {
  test.each([
    // Lobby is the bootstrap room: anyone may create it.
    ['Lobby by a student', 'Lobby', 'any-student-pk', [], undefined, true],
    ['Lobby by a listed student', 'Lobby', 'alice-pk', [], ['alice-pk'], true],
    ['Lobby by a non-member', 'Lobby', 'random-pk', [], ['alice-pk'], true],
    ['Lobby, wildcard allowlist', 'Lobby', 'random-pk', [], ['*'], true],
    ['Lobby, empty allowlist', 'Lobby', 'random-pk', [], [], true],
    // Every other room needs the owner or a teacher.
    ['"Room 1" by a student', 'Room 1', 'student-pk', [], undefined, false],
    ['"Room 42" by a student', 'Room 42', 'student-pk', [], undefined, false],
    ['"Room 1" by the owner', 'Room 1', OWNER, [], undefined, true],
    ['"Room 1" by a teacher', 'Room 1', 'teacher-pk', TEACHERS, undefined, true],
    ['"Room foo" by a student', 'Room foo', 'student-pk', [], undefined, false],
    ['"Room foo" by the owner', 'Room foo', OWNER, [], undefined, true],
    ['named room by the owner', 'Discussion', OWNER, [], undefined, true],
    ['named room by a teacher', 'Discussion', 'teacher-pk', TEACHERS, undefined, true],
    ['named room by anyone else', 'Discussion', 'student-pk', TEACHERS, undefined, false],
    ['named room, empty signer', 'Discussion', '', TEACHERS, undefined, false],
    ['station room by the owner', 'Station myStn', OWNER, [], undefined, true],
    ['station room by a teacher', 'Station myStn', 'teacher-pk', TEACHERS, undefined, true],
    ['station room by anyone else', 'Station myStn', 'random-pk', TEACHERS, undefined, false],
    ['owner signer padded', 'Discussion', 'owner-pk==', [], undefined, true],
    ['teacher list padded', 'Discussion', 'teacher-pk', ['teacher-pk=='], undefined, true],
    // Membership in the allowlist doesn't grant room creation.
    ['"Room 1" by a listed student', 'Room 1', 'alice-pk', [], ['alice-pk'], false],
    ['"Room 1" by the owner, allowlist set', 'Room 1', OWNER, [], ['alice-pk'], true],
    ['"Room 5" by a non-member', 'Room 5', 'random-pk', [], ['alice-pk'], false],
    ['named room by a listed student', 'Discussion', 'alice-pk', [], ['alice-pk'], false],
    ['named room by the owner, allowlist set', 'Discussion', OWNER, [], ['alice-pk'], true],
    ['station room by the owner, allowlist set', 'Station S1', OWNER, [], ['alice-pk'], true],
    ['named room by a teacher, allowlist set', 'Discussion', 'teacher-pk', TEACHERS, ['alice-pk'], true],
    ['station room by a non-member', 'Station S1', 'random-pk', [], ['alice-pk'], false],
    ['"Room 1", wildcard allowlist', 'Room 1', 'random-pk', [], ['*'], false],
    ['named room, empty allowlist', 'Discussion', 'random-pk', [], [], false],
  ])('%s', (_case, name, signer, teachers, students, expected) => {
    expect(isAuthorizedRoomSigner(name, signer, OWNER, teachers as string[], students as string[] | undefined)).toBe(expected)
  })
})
