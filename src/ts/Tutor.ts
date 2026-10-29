/**
 * The student tutor of edrys-dev --tutor. The owner tab of a class served by
 * edrys-dev announces it in its signed presence (`tutor: true`). A student
 * sends a question to that tab as a signed message only it receives; the tab
 * passes it on to edrys-dev, which runs a local agent without tools, and sends
 * the answer back to that student alone.
 *
 *   question  { tutor: { ask: { id, text } } }             student → owner tab
 *   answer    { tutor: { answer: { id, text | error } } }  owner tab → student
 */
import { getBasePeerID, getShortPeerID, infoHash, sameKey } from './Utils'
import { report } from './DevBridge'

export const TEXT_MAX = 2000
// a question edrys-dev did not answer by then is forgotten
const RELAY_MS = 5 * 60_000

type Peer = {
  onTutor(callback: ((msg: { from: string; tutor: any }) => void) | null): void
  sendTutor(to: string, tutor: any): void
}

/**
 * The peer id of the class owner's tab that offers the tutor, if one is
 * present. Only the owner's: anyone can put `tutor` into their own presence.
 */
export function tutorPeer(users: Record<string, any> | undefined, owner: string | undefined): string | null {
  if (!owner) return null
  for (const [id, user] of Object.entries(users || {})) {
    if (user?.tutor === true && sameKey(getBasePeerID(id), owner)) return id
  }
  return null
}

/** An answer, if `msg` is one from `owner` (the student only trusts the class owner's tab). */
export function tutorAnswer(msg: { from: string; tutor: any }, owner: string | undefined) {
  const answer = msg.tutor?.answer
  if (!owner || !sameKey(getBasePeerID(msg.from), owner)) return null
  if (typeof answer?.id !== 'string') return null
  if (typeof answer.text === 'string') return { id: answer.id, text: answer.text }
  if (typeof answer.error === 'string') return { id: answer.id, error: answer.error }
  return null
}

/**
 * In the owner tab: passes the questions of peers who may take part in the
 * class on to edrys-dev, and its answers back to the asker. `room` gives the
 * room of a peer. Returns `answer` for edrys-dev's `tutor-answer` events and
 * `stop`.
 */
export function startTutorRelay(peer: Peer, allowed: (base: string) => boolean, room: (id: string) => string) {
  const waiting = new Map<string, { to: string; id: string; t: number }>()

  peer.onTutor((msg) => {
    const ask = msg.tutor?.ask
    if (typeof ask?.id !== 'string' || typeof ask.text !== 'string') return
    const student = getBasePeerID(msg.from)
    // stations are run by teachers; their modules have no one to ask for
    if (msg.from.startsWith('Station ') || !allowed(student)) return
    const answer = (result: { text: string } | { error: string }) =>
      peer.sendTutor(msg.from, { answer: { id: ask.id, ...result } })
    if (ask.text.length > TEXT_MAX) return answer({ error: `The question is too long (at most ${TEXT_MAX} characters).` })

    const now = Date.now()
    for (const [key, entry] of waiting) if (entry.t < now - RELAY_MS) waiting.delete(key)
    const relay = infoHash(12)
    waiting.set(relay, { to: msg.from, id: ask.id, t: now })
    report('tutor-ask', { id: relay, student, name: getShortPeerID(msg.from), room: room(msg.from), text: ask.text })
  })

  return {
    answer({ id, text, error }: { id: string; student?: string; text?: string; error?: string }) {
      const entry = waiting.get(id)
      if (!entry) return
      waiting.delete(id)
      const result = typeof text === 'string' ? { text } : { error: String(error ?? 'no answer') }
      peer.sendTutor(entry.to, { answer: { id: entry.id, ...result } })
    },
    stop() {
      peer.onTutor(null)
      waiting.clear()
    },
  }
}
