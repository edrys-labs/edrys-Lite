import { describe, test, expect, vi } from 'vitest'

// Unit tests for the pure authorization rules exported from Peer.ts.
// The rules themselves are pure; the Database mock just lets Peer.ts import
// cleanly in the test harness.
async function freshPeerHelpers() {
  vi.resetModules()
  vi.doMock('../../../../src/ts/Database', () => ({
    Database: vi.fn(() => ({
      getPublicKeyRaw: vi.fn().mockResolvedValue(null),
      getPrivateKey: vi.fn().mockResolvedValue(null),
      setPublicKeyRaw: vi.fn(),
      setPrivateKey: vi.fn(),
    })),
  }))
  return import('../../../../src/ts/Peer')
}

// ---------------------------------------------------------------------------
// y.users authorization rule (isAuthorizedUserSigner)
// ---------------------------------------------------------------------------
describe('isAuthorizedUserSigner', () => {
  test('human peer: signer matching pubkey prefix is authorized', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers()
    const pubkey = 'BGdxv12345abc'
    const id = `${pubkey}_sess001`
    expect(isAuthorizedUserSigner(id, pubkey, 'owner-pk', [])).toBe(true)
  })

  test('human peer: signer with different pubkey is rejected (spoofing)', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers()
    const id = 'BGdxv12345abc_sess001'
    expect(isAuthorizedUserSigner(id, 'attacker-pk', 'owner-pk', [])).toBe(false)
  })

  test('human peer: base64 padding (=) is ignored when matching', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers()
    const id = 'BGdxv12345abc==_sess001'
    expect(isAuthorizedUserSigner(id, 'BGdxv12345abc', 'owner-pk', [])).toBe(true)
    expect(isAuthorizedUserSigner(id, 'BGdxv12345abc==', 'owner-pk', [])).toBe(true)
  })

  test('human peer: missing session separator is rejected', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers()
    expect(isAuthorizedUserSigner('NoSeparator', 'NoSeparator', 'owner-pk', [])).toBe(false)
  })

  test('station peer: owner signature is authorized', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers()
    const id = 'Station myStn1'
    const owner = 'owner-pk'
    expect(isAuthorizedUserSigner(id, owner, owner, [])).toBe(true)
  })

  test('station peer: teacher signature is authorized', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers()
    const id = 'Station myStn1'
    expect(isAuthorizedUserSigner(id, 'teacher-pk', 'owner-pk', ['teacher-pk'])).toBe(true)
  })

  test('station peer: random participant is rejected', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers()
    const id = 'Station myStn1'
    expect(isAuthorizedUserSigner(id, 'random-pk', 'owner-pk', ['teacher-pk'])).toBe(false)
  })

  test('empty signer is rejected', async () => {
    const { isAuthorizedUserSigner } = await freshPeerHelpers()
    expect(isAuthorizedUserSigner('any_id', '', 'owner', [])).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// y.rooms authorization rule (isAuthorizedRoomSigner)
// ---------------------------------------------------------------------------
describe('isAuthorizedRoomSigner', () => {
  test('default room "Lobby" is creatable by any signer (bootstrap)', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Lobby', 'any-student-pk', 'owner-pk', [])).toBe(true)
  })

  test('"Room N" requires owner or teacher (not any signer)', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Room 1', 'student-pk', 'owner-pk', [])).toBe(false)
    expect(isAuthorizedRoomSigner('Room 42', 'student-pk', 'owner-pk', [])).toBe(false)
    expect(isAuthorizedRoomSigner('Room 1', 'owner-pk', 'owner-pk', [])).toBe(true)
    expect(isAuthorizedRoomSigner('Room 1', 'teacher-pk', 'owner-pk', ['teacher-pk'])).toBe(true)
  })

  test('non-default room: owner is authorized', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Discussion', 'owner-pk', 'owner-pk', [])).toBe(true)
  })

  test('non-default room: teacher is authorized', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Discussion', 'teacher-pk', 'owner-pk', ['teacher-pk'])).toBe(true)
  })

  test('non-default room: random participant is rejected', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Discussion', 'student-pk', 'owner-pk', ['teacher-pk'])).toBe(false)
  })

  test('station room: owner is authorized', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Station myStn', 'owner-pk', 'owner-pk', [])).toBe(true)
  })

  test('station room: teacher is authorized', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Station myStn', 'teacher-pk', 'owner-pk', ['teacher-pk'])).toBe(true)
  })

  test('station room: random participant is rejected', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Station myStn', 'random-pk', 'owner-pk', ['teacher-pk'])).toBe(false)
  })

  test('base64 padding (=) is ignored when matching owner/teacher', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Discussion', 'owner-pk==', 'owner-pk', [])).toBe(true)
    expect(isAuthorizedRoomSigner('Discussion', 'teacher-pk', 'owner-pk', ['teacher-pk=='])).toBe(true)
  })

  test('empty signer is rejected', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Discussion', '', 'owner-pk', ['teacher-pk'])).toBe(false)
  })

  test('room name that looks like default but isn\'t (e.g., "Room foo") requires owner/teacher', async () => {
    const { isAuthorizedRoomSigner } = await freshPeerHelpers()
    expect(isAuthorizedRoomSigner('Room foo', 'student-pk', 'owner-pk', [])).toBe(false)
    expect(isAuthorizedRoomSigner('Room foo', 'owner-pk', 'owner-pk', [])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Members allowlist gating (binds `members.student` to authz)
// ---------------------------------------------------------------------------
describe('members allowlist gating', () => {
  describe('isAuthorizedUserSigner with allowlist', () => {
    test('listed student signing own entry is accepted', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      const id = 'student-pk_sess001'
      expect(
        isAuthorizedUserSigner(id, 'student-pk', 'owner-pk', [], ['student-pk'])
      ).toBe(true)
    })

    test('non-member signing own (valid id prefix) entry is rejected', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      const id = 'random-pk_sess001'
      expect(
        isAuthorizedUserSigner(id, 'random-pk', 'owner-pk', [], ['alice-pk', 'bob-pk'])
      ).toBe(false)
    })

    test('owner always passes even when not explicitly listed', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      const id = 'owner-pk_sess001'
      expect(
        isAuthorizedUserSigner(id, 'owner-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(true)
    })

    test('teacher always passes even when not explicitly listed', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      const id = 'teacher-pk_sess001'
      expect(
        isAuthorizedUserSigner(id, 'teacher-pk', 'owner-pk', ['teacher-pk'], ['alice-pk'])
      ).toBe(true)
    })

    test('station record from non-member teacher is rejected', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedUserSigner(
          'Station S1',
          'rogue-teacher-pk',
          'owner-pk',
          ['rogue-teacher-pk'],
          ['alice-pk']
        )
      ).toBe(true)
      // sanity: rogue teacher is in teachers list so membership passes
      expect(
        isAuthorizedUserSigner('Station S1', 'random-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(false)
    })

    test('wildcard student list preserves permissive behaviour', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      const id = 'random-pk_sess001'
      expect(
        isAuthorizedUserSigner(id, 'random-pk', 'owner-pk', [], ['*'])
      ).toBe(true)
    })

    test('empty student list preserves permissive behaviour', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      const id = 'random-pk_sess001'
      expect(
        isAuthorizedUserSigner(id, 'random-pk', 'owner-pk', [], [])
      ).toBe(true)
    })

    test('listed student spoofing another student id is still rejected by prefix rule', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      // alice tries to write bob's record — id prefix doesn't match her pubkey
      expect(
        isAuthorizedUserSigner(
          'bob-pk_sess001',
          'alice-pk',
          'owner-pk',
          [],
          ['alice-pk', 'bob-pk']
        )
      ).toBe(false)
    })

    test('base64 padding is ignored when matching against students list', async () => {
      const { isAuthorizedUserSigner } = await freshPeerHelpers()
      const id = 'alice-pk==_sess001'
      expect(
        isAuthorizedUserSigner(id, 'alice-pk', 'owner-pk', [], ['alice-pk=='])
      ).toBe(true)
    })
  })

  describe('isAuthorizedRoomSigner with allowlist', () => {
    test('listed student can create Lobby', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Lobby', 'alice-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(true)
    })

    test('non-member can still create Lobby (Lobby is always open)', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Lobby', 'random-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(true)
    })

    test('"Room N" requires owner or teacher even with allowlist', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Room 1', 'alice-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(false)
      expect(
        isAuthorizedRoomSigner('Room 1', 'owner-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(true)
    })

    test('non-member cannot create "Room N"', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Room 5', 'random-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(false)
    })

    test('listed student cannot create a named room (owner/teacher only)', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Discussion', 'alice-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(false)
    })

    test('owner always permitted under allowlist', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Discussion', 'owner-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(true)
      expect(
        isAuthorizedRoomSigner('Station S1', 'owner-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(true)
    })

    test('teacher always permitted under allowlist', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Discussion', 'teacher-pk', 'owner-pk', ['teacher-pk'], ['alice-pk'])
      ).toBe(true)
    })

    test('non-member cannot create a station room', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Station S1', 'random-pk', 'owner-pk', [], ['alice-pk'])
      ).toBe(false)
    })

    test('wildcard student list preserves permissive default-room behaviour', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Lobby', 'random-pk', 'owner-pk', [], ['*'])
      ).toBe(true)
      expect(
        isAuthorizedRoomSigner('Room 1', 'random-pk', 'owner-pk', [], ['*'])
      ).toBe(false)
    })

    test('empty student list preserves the no-allowlist behaviour', async () => {
      const { isAuthorizedRoomSigner } = await freshPeerHelpers()
      expect(
        isAuthorizedRoomSigner('Lobby', 'random-pk', 'owner-pk', [], [])
      ).toBe(true)
      expect(
        isAuthorizedRoomSigner('Discussion', 'random-pk', 'owner-pk', [], [])
      ).toBe(false)
    })
  })
})
