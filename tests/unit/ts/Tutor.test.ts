import { describe, test, expect, vi, beforeEach } from 'vitest'
import { startTutorRelay, tutorAnswer, tutorPeer, TEXT_MAX } from '../../../src/ts/Tutor'

vi.mock('../../../src/ts/DevBridge', () => ({ report: vi.fn() }))
import { report } from '../../../src/ts/DevBridge'

const OWNER = 'ownerKey=='

describe('tutorPeer', () => {
  test('is the owner\'s tab that offers the tutor, never another peer\'s', () => {
    const users = {
      'studentKey_s1': { tutor: true, role: 'student' },
      'ownerKey_s2': { role: 'teacher' },
      'ownerKey_s3': { tutor: true, role: 'teacher' },
    }
    expect(tutorPeer(users, OWNER)).toBe('ownerKey_s3')
    expect(tutorPeer({ 'studentKey_s1': { tutor: true } }, OWNER)).toBeNull()
    expect(tutorPeer(users, undefined)).toBeNull()
  })
})

describe('tutorAnswer', () => {
  test('takes answers from the class owner only', () => {
    const answer = { answer: { id: 'q1', text: 'hint' } }
    expect(tutorAnswer({ from: 'ownerKey_s3', tutor: answer }, OWNER)).toEqual({ id: 'q1', text: 'hint' })
    expect(tutorAnswer({ from: 'studentKey_s1', tutor: answer }, OWNER)).toBeNull()
    expect(tutorAnswer({ from: 'ownerKey_s3', tutor: { answer: { id: 'q1', error: 'busy' } } }, OWNER)).toEqual({ id: 'q1', error: 'busy' })
    expect(tutorAnswer({ from: 'ownerKey_s3', tutor: { ask: { id: 'q1', text: 'x' } } }, OWNER)).toBeNull()
  })
})

describe('startTutorRelay', () => {
  let handler: any
  const peer = {
    onTutor: vi.fn((callback) => (handler = callback)),
    sendTutor: vi.fn(),
  }
  beforeEach(() => {
    vi.mocked(report).mockClear()
    peer.sendTutor.mockClear()
  })

  test('passes a question on to edrys-dev and its answer back to the asker', () => {
    const relay = startTutorRelay(peer, () => true, () => 'Room 1')
    handler({ from: 'studentKey_s1', tutor: { ask: { id: 'q1', text: 'Why?' } } })

    expect(report).toHaveBeenCalledTimes(1)
    const [type, question] = vi.mocked(report).mock.calls[0] as any[]
    expect(type).toBe('tutor-ask')
    expect(question).toMatchObject({ student: 'studentKey', room: 'Room 1', text: 'Why?' })
    expect(question.id).not.toBe('q1')

    relay.answer({ id: question.id, student: 'studentKey', text: 'Because.' })
    expect(peer.sendTutor).toHaveBeenCalledWith('studentKey_s1', { answer: { id: 'q1', text: 'Because.' } })
    // once only
    relay.answer({ id: question.id, student: 'studentKey', text: 'Again' })
    relay.answer({ id: 'unknown', student: 'studentKey', text: 'x' })
    expect(peer.sendTutor).toHaveBeenCalledTimes(1)
    relay.stop()
    expect(peer.onTutor).toHaveBeenLastCalledWith(null)
  })

  test('ignores stations, peers not allowed in the class and malformed questions; refuses long ones', () => {
    startTutorRelay(peer, (base) => base !== 'outsiderKey', () => 'Lobby')
    handler({ from: 'Station lab-pc', tutor: { ask: { id: 'q', text: 'x' } } })
    handler({ from: 'outsiderKey_s1', tutor: { ask: { id: 'q', text: 'x' } } })
    handler({ from: 'studentKey_s1', tutor: { ask: { id: 1, text: 'x' } } })
    handler({ from: 'studentKey_s1', tutor: { answer: { id: 'q', text: 'x' } } })
    expect(report).not.toHaveBeenCalled()

    handler({ from: 'studentKey_s1', tutor: { ask: { id: 'q', text: 'x'.repeat(TEXT_MAX + 1) } } })
    expect(report).not.toHaveBeenCalled()
    expect(peer.sendTutor).toHaveBeenCalledWith('studentKey_s1', { answer: { id: 'q', error: expect.stringMatching(/too long/) } })
  })
})
