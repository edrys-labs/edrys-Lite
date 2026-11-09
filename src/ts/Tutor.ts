/**
 * The student tutor of edrys-dev --tutor. The owner tab of a class served by
 * edrys-dev announces it in its signed presence, with a public key
 * (`tutor: key`). A student sends a question to that tab as a signed message
 * only it should receive; the tab passes it on to edrys-dev, which runs a
 * local agent without tools, and sends the answer back to that student alone.
 *
 *   question  { tutor: { ask: { id, key, iv, data } } }   student → owner tab
 *   answer    { tutor: { answer: { id, iv, data } } }     owner tab → student
 *
 * Questions and answers are sealed for the two ends: a WebSocket server
 * relays every message to the whole class, and WebRTC does too while it does
 * not know the addressee's connection yet. Per question the student makes a
 * key pair and derives an AES-GCM key from it and the owner tab's key (ECDH
 * P-256, HKDF); `key` is its public half. The answer comes back under the same
 * key. The signature of the message still tells who sent it.
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

const ECDH = { name: 'ECDH', namedCurve: 'P-256' }
// a raw P-256 public key, in base64
const KEY = /^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]{2}$/

const toBase64 = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const utf8 = (text: string) => new TextEncoder().encode(text)

/** The owner tab's key pair; the private half never leaves the browser. */
export async function tutorKeys(): Promise<{ publicKey: string; privateKey: CryptoKey }> {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])
  return { publicKey: toBase64(await crypto.subtle.exportKey('raw', pair.publicKey)), privateKey: pair.privateKey }
}

// the AES key of one question, bound to both public keys
async function sharedKey(privateKey: CryptoKey, other: string, ownerKey: string, studentKey: string) {
  const publicKey = await crypto.subtle.importKey('raw', fromBase64(other), ECDH, false, [])
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const hkdf = await crypto.subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(), info: utf8(`edrys-tutor ${ownerKey} ${studentKey}`) },
    hkdf,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

// `what` (ask or answer, the id and the student's peer id) is authenticated
// too: a sealed answer cannot pass for a question or for the answer to another
// one, and a question copied off the wire cannot be sent again by another peer
async function seal(key: CryptoKey, what: string, value: any) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(what) },
    key,
    utf8(JSON.stringify(value))
  )
  return { iv: toBase64(iv), data: toBase64(data) }
}

/** The sealed value, or null if it was not sealed with `key` for `what`. */
async function unseal(key: CryptoKey, what: string, sealed: any): Promise<any> {
  if (typeof sealed?.iv !== 'string' || typeof sealed.data !== 'string') return null
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.iv), additionalData: utf8(what) },
      key,
      fromBase64(sealed.data)
    )
    return JSON.parse(new TextDecoder().decode(plain))
  } catch {
    return null
  }
}

/**
 * The class owner's tab that offers the tutor, with its key, if one is
 * present. Only the owner's: anyone can put `tutor` into their own presence.
 */
export function tutorPeer(
  users: Record<string, any> | undefined,
  owner: string | undefined
): { id: string; key: string } | null {
  if (!owner) return null
  for (const [id, user] of Object.entries(users || {})) {
    if (typeof user?.tutor === 'string' && KEY.test(user.tutor) && sameKey(getBasePeerID(id), owner)) {
      return { id, key: user.tutor }
    }
  }
  return null
}

/**
 * A question of the peer `from` sealed for the owner tab's `ownerKey`, to send
 * with sendTutor, and the key its answer will come under.
 */
export async function sealQuestion(ownerKey: string, from: string, id: string, text: string) {
  const pair = await crypto.subtle.generateKey(ECDH, false, ['deriveBits'])
  const studentKey = toBase64(await crypto.subtle.exportKey('raw', pair.publicKey))
  const key = await sharedKey(pair.privateKey, ownerKey, ownerKey, studentKey)
  return { tutor: { ask: { id, key: studentKey, ...(await seal(key, `ask ${id} ${from}`, { text })) } }, key }
}

/**
 * The answer in `msg`, if it is one from `owner` to the question `id` of the
 * peer `to`, sealed with its `key` (the student only trusts the class owner's
 * tab).
 */
export async function tutorAnswer(
  msg: { from: string; tutor: any },
  owner: string | undefined,
  to: string,
  id: string,
  key: CryptoKey
): Promise<{ id: string; text?: string; error?: string } | null> {
  const answer = msg.tutor?.answer
  if (!owner || !sameKey(getBasePeerID(msg.from), owner)) return null
  if (answer?.id !== id) return null
  const value = await unseal(key, `answer ${id} ${to}`, answer)
  if (typeof value?.text === 'string') return { id, text: value.text }
  if (typeof value?.error === 'string') return { id, error: value.error }
  return null
}

/**
 * In the owner tab: passes the questions of peers who may take part in the
 * class on to edrys-dev, and its answers back to the asker, sealed. `room`
 * gives the room of a peer, `username` its chosen name. Returns `publicKey` (to announce), `answer` for
 * edrys-dev's `tutor-answer` events and `stop`.
 */
export function startTutorRelay(
  peer: Peer,
  allowed: (base: string) => boolean,
  room: (id: string) => string,
  username: (id: string) => string | null | undefined = () => null
) {
  const keys = tutorKeys()
  const waiting = new Map<string, { to: string; id: string; key: CryptoKey; t: number }>()

  const sealed = async (to: string, id: string, key: CryptoKey, result: { text: string } | { error: string }) =>
    peer.sendTutor(to, { answer: { id, ...(await seal(key, `answer ${id} ${to}`, result)) } })

  peer.onTutor(async (msg) => {
    const ask = msg.tutor?.ask
    if (typeof ask?.id !== 'string' || typeof ask.key !== 'string' || !KEY.test(ask.key)) return
    const student = getBasePeerID(msg.from)
    // stations are run by teachers; their modules have no one to ask for
    if (msg.from.startsWith('Station ') || !allowed(student)) return

    const { publicKey, privateKey } = await keys
    let key: CryptoKey
    try {
      key = await sharedKey(privateKey, ask.key, publicKey, ask.key)
    } catch {
      return
    }
    // sealed for an older key of ours (before a reload), or not for us at all
    const value = await unseal(key, `ask ${ask.id} ${msg.from}`, ask)
    if (typeof value?.text !== 'string') return
    const answer = (result: { text: string } | { error: string }) => sealed(msg.from, ask.id, key, result)
    if (value.text.length > TEXT_MAX) return answer({ error: `The question is too long (at most ${TEXT_MAX} characters).` })

    const now = Date.now()
    for (const [relayId, entry] of waiting) if (entry.t < now - RELAY_MS) waiting.delete(relayId)
    const relay = infoHash(12)
    waiting.set(relay, { to: msg.from, id: ask.id, key, t: now })
    const short = getShortPeerID(msg.from)
    const chosen = username(msg.from)
    // The short ID stays: chosen names aren't unique
    const name = chosen ? `${chosen} · ${short}` : short
    report('tutor-ask', { id: relay, student, name, room: room(msg.from), text: value.text })
  })

  return {
    publicKey: async () => (await keys).publicKey,
    answer({ id, text, error }: { id: string; student?: string; text?: string; error?: string }) {
      const entry = waiting.get(id)
      if (!entry) return
      waiting.delete(id)
      const result = typeof text === 'string' ? { text } : { error: String(error ?? 'no answer') }
      return sealed(entry.to, entry.id, entry.key, result)
    },
    stop() {
      peer.onTutor(null)
      waiting.clear()
    },
  }
}
