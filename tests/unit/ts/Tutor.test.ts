import { describe, test, expect, vi, beforeEach } from 'vitest'
import { sealQuestion, startTutorRelay, tutorAnswer, tutorKeys, tutorPeer, TEXT_MAX } from '../../../src/ts/Tutor'

vi.mock('../../../src/ts/DevBridge', () => ({ report: vi.fn() }))
import { report } from '../../../src/ts/DevBridge'

const OWNER = 'ownerKey=='
const STUDENT = 'studentKey_s1'

describe('tutorPeer', () => {
  test('is the owner\'s tab that offers the tutor with a key, never another peer\'s', async () => {
    const { publicKey } = await tutorKeys()
    const users = {
      'studentKey_s1': { tutor: publicKey, role: 'student' },
      'ownerKey_s2': { role: 'teacher' },
      'ownerKey_s3': { tutor: publicKey, role: 'teacher' },
    }
    expect(tutorPeer(users, OWNER)).toEqual({ id: 'ownerKey_s3', key: publicKey })
    expect(tutorPeer({ 'studentKey_s1': { tutor: publicKey } }, OWNER)).toBeNull()
    expect(tutorPeer(users, undefined)).toBeNull()
    // the announcement before keys, or no key at all
    expect(tutorPeer({ 'ownerKey_s3': { tutor: true } }, OWNER)).toBeNull()
    expect(tutorPeer({ 'ownerKey_s3': { tutor: 'not a key' } }, OWNER)).toBeNull()
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
  const lastSent = () => peer.sendTutor.mock.calls.at(-1) as any[]

  test('a sealed question reaches edrys-dev, its sealed answer the asker only', async () => {
    const relay = startTutorRelay(peer, () => true, () => 'Room 1')
    const ownerKey = await relay.publicKey()
    const { tutor, key } = await sealQuestion(ownerKey, STUDENT, 'q1', 'Why does my LED not light?')
    // the class may relay it to everyone: no text on the wire
    expect(JSON.stringify(tutor)).not.toMatch(/LED/)
    await handler({ from: STUDENT, tutor })

    expect(report).toHaveBeenCalledTimes(1)
    const [type, question] = vi.mocked(report).mock.calls[0] as any[]
    expect(type).toBe('tutor-ask')
    expect(question).toMatchObject({ student: 'studentKey', room: 'Room 1', text: 'Why does my LED not light?' })
    expect(question.id).not.toBe('q1')

    await relay.answer({ id: question.id, student: 'studentKey', text: 'Check the resistor.' })
    const [to, answer] = lastSent()
    expect(to).toBe(STUDENT)
    expect(answer.answer.id).toBe('q1')
    expect(JSON.stringify(answer)).not.toMatch(/resistor/)
    const msg = { from: 'ownerKey_s3', tutor: answer }
    expect(await tutorAnswer(msg, OWNER, STUDENT, 'q1', key)).toEqual({ id: 'q1', text: 'Check the resistor.' })

    // not from the owner, for another question, for another peer, or under another key
    expect(await tutorAnswer({ ...msg, from: 'studentKey_s2' }, OWNER, STUDENT, 'q1', key)).toBeNull()
    expect(await tutorAnswer(msg, OWNER, STUDENT, 'q2', key)).toBeNull()
    expect(await tutorAnswer(msg, OWNER, 'otherKey_s1', 'q1', key)).toBeNull()
    const other = await sealQuestion(ownerKey, STUDENT, 'q1', 'x')
    expect(await tutorAnswer(msg, OWNER, STUDENT, 'q1', other.key)).toBeNull()

    // once only
    await relay.answer({ id: question.id, student: 'studentKey', text: 'Again' })
    await relay.answer({ id: 'unknown', student: 'studentKey', text: 'x' })
    expect(peer.sendTutor).toHaveBeenCalledTimes(1)
    relay.stop()
    expect(peer.onTutor).toHaveBeenLastCalledWith(null)
  })

  test('a question copied off the wire, or sealed for another key, is dropped', async () => {
    const relay = startTutorRelay(peer, () => true, () => 'Lobby')
    const { tutor } = await sealQuestion(await relay.publicKey(), STUDENT, 'q1', 'mine')
    await handler({ from: 'otherKey_s9', tutor })
    // e.g. the owner tab reloaded and has a new key
    const stale = await sealQuestion((await tutorKeys()).publicKey, STUDENT, 'q2', 'old')
    await handler({ from: STUDENT, tutor: stale.tutor })
    // sealed for its own id only
    await handler({ from: STUDENT, tutor: { ask: { ...tutor.ask, id: 'q3' } } })
    expect(report).not.toHaveBeenCalled()
  })

  test('ignores stations, peers not allowed in the class and malformed questions; refuses long ones', async () => {
    const relay = startTutorRelay(peer, (base) => base !== 'outsiderKey', () => 'Lobby')
    const ownerKey = await relay.publicKey()
    const ask = async (from: string, text = 'x') => (await sealQuestion(ownerKey, from, 'q', text)).tutor
    await handler({ from: 'Station lab-pc', tutor: await ask('Station lab-pc') })
    await handler({ from: 'outsiderKey_s1', tutor: await ask('outsiderKey_s1') })
    await handler({ from: STUDENT, tutor: { ask: { id: 'q', text: 'plain' } } })
    await handler({ from: STUDENT, tutor: { ask: { ...(await ask(STUDENT)).ask, key: 'short' } } })
    await handler({ from: STUDENT, tutor: { answer: { id: 'q', text: 'x' } } })
    expect(report).not.toHaveBeenCalled()
    expect(peer.sendTutor).not.toHaveBeenCalled()

    const long = await sealQuestion(ownerKey, STUDENT, 'q', 'x'.repeat(TEXT_MAX + 1))
    await handler({ from: STUDENT, tutor: long.tutor })
    expect(report).not.toHaveBeenCalled()
    const [, answer] = lastSent()
    const opened = await tutorAnswer({ from: 'ownerKey_s1', tutor: answer }, OWNER, STUDENT, 'q', long.key)
    expect(opened?.error).toMatch(/too long/)
  })
})
