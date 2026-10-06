import { signEntry, verifyEntry, canonicalize, Envelope } from './Utils'
import { debug } from '../api/debugHandler'

function LOG(...args: any[]) {
  debug.ts.peer('%c👥 Presence >>>', 'background-color: #003344; font-weight: bold;', ...args)
}

// Field in each client's awareness state that carries its signed presence.
const FIELD = 'presence'

// Re-sign cadence. Every re-sign raises the nonce, which is what keeps an
// entry visible to readers.
export const RESIGN_INTERVAL = 15000
// A reader hides an entry whose nonce hasn't risen for this long, measured on
// the reader's own clock: a replayed copy can never advance its nonce, so it
// drops out without peers having to agree on the time.
export const STALE_AFTER = 40000
const SWEEP_INTERVAL = 5000

export interface PresenceEntry {
  id: string
  payload: any
  envelope: Envelope
}

interface Seen {
  payload: any
  signer: string
  nonce: number
  // Local time the nonce last rose.
  advancedAt: number
}

/**
 * Signed presence on an awareness channel. Every peer publishes
 * `{ id, payload, envelope }` and re-signs it periodically; readers show an
 * entry only if its signature verifies, `authorize(id, signer)` accepts it,
 * its nonce is the newest seen for that id, and that nonce is still rising.
 * Nothing is ever written to correct another peer: invalid entries are
 * simply not shown.
 */
export class SignedPresence {
  private _own: any | null = null
  private _ownEntry: PresenceEntry | null = null
  private _ownNonce = 0
  // Newest verified entry per id. Kept after the entry leaves awareness, so
  // a copy of it re-appearing later doesn't count as fresh.
  private _seen = new Map<string, Seen>()
  // Ids with a verified entry in awareness right now.
  private _present = new Set<string>()
  // Nonce at which an id was reported gone; hidden until it rises past it.
  private _leftAt = new Map<string, number>()
  // Verification results by signed content (a re-sign is a new entry).
  private _verified = new Map<string, boolean>()
  private _visible: Record<string, any> = {}
  private _rebuilding: Promise<void> | null = null
  private _rebuildAgain = false
  private _resignTimer: ReturnType<typeof setInterval> | null = null
  private _sweepTimer: ReturnType<typeof setInterval> | null = null
  private _stopped = false

  constructor(
    private awareness: any,
    private selfId: string,
    private authorize: (id: string, signer: string) => boolean,
    private onChange: () => void
  ) {
    this.awareness.on('change', this._onAwarenessChange)
    this._resignTimer = setInterval(() => this._resign(), RESIGN_INTERVAL)
    this._sweepTimer = setInterval(() => this._refreshVisible(), SWEEP_INTERVAL)
  }

  /** Our own payload as last published, or null before the first publish. */
  get own(): any | null {
    return this._own
  }

  /** Verified, fresh entries by id. Our own entry is always included. */
  get visible(): Record<string, any> {
    return this._visible
  }

  has(id: string): boolean {
    return id in this._visible
  }

  /** Sign and publish `payload` as our presence. */
  async publish(payload: any): Promise<void> {
    if (this._stopped) return
    this._own = payload
    this._ownNonce = Math.max(Date.now(), this._ownNonce + 1)
    const nonce = this._ownNonce
    try {
      const envelope = await signEntry('users', this.selfId, payload, nonce)
      // A later publish already went out; don't overwrite it with this one.
      if (this._stopped || nonce !== this._ownNonce) return
      this._ownEntry = { id: this.selfId, payload, envelope }
      this.awareness.setLocalStateField(FIELD, this._ownEntry)
    } catch (e) {
      LOG('publish failed', e)
    }
    this._refreshVisible()
  }

  /** Hide `id` until it publishes again (transport reported it gone). */
  markLeft(id: string): void {
    const seen = this._seen.get(id)
    if (id === this.selfId || !seen) return
    this._leftAt.set(id, seen.nonce)
    this._refreshVisible()
  }

  /** Re-run authorization, e.g. after the members list changed. */
  reauthorize(): void {
    this._refreshVisible()
  }

  stop(): void {
    this._stopped = true
    this.awareness.off('change', this._onAwarenessChange)
    if (this._resignTimer) clearInterval(this._resignTimer)
    if (this._sweepTimer) clearInterval(this._sweepTimer)
    this._resignTimer = this._sweepTimer = null
    try {
      this.awareness.setLocalStateField(FIELD, null)
    } catch {}
  }

  private _onAwarenessChange = () => this._rebuild()

  private _resign(): void {
    if (this._own) this.publish(this._own)
  }

  /** Coalesce rebuilds: at most one in flight plus one queued. */
  private _rebuild(): void {
    if (this._rebuilding) {
      this._rebuildAgain = true
      return
    }
    this._rebuilding = this._collect().finally(() => {
      this._rebuilding = null
      if (this._rebuildAgain) {
        this._rebuildAgain = false
        this._rebuild()
      }
    })
  }

  private async _collect(): Promise<void> {
    const now = Date.now()
    const present = new Set<string>()
    const states: Map<number, any> = this.awareness.getStates()
    for (const [clientID, state] of states) {
      const entry = state?.[FIELD]
      if (clientID === this.awareness.clientID) {
        // A remote peer can overwrite our state in its awareness copy; put
        // ours back so the next broadcast carries it.
        if (this._ownEntry && canonicalize(entry ?? null) !== canonicalize(this._ownEntry)) {
          this.awareness.setLocalStateField(FIELD, this._ownEntry)
        }
        continue
      }
      if (!(await this._accept(entry))) continue
      const { id, payload, envelope } = entry as PresenceEntry
      present.add(id)
      const seen = this._seen.get(id)
      if (!seen || envelope.nonce > seen.nonce) {
        this._seen.set(id, { payload, signer: envelope.signer, nonce: envelope.nonce, advancedAt: now })
      }
    }
    this._present = present
    this._refreshVisible()
  }

  private async _accept(entry: any): Promise<boolean> {
    if (!entry || typeof entry.id !== 'string' || entry.id === this.selfId) return false
    const envelope = entry.envelope as Envelope | undefined
    if (!envelope || typeof envelope.signature !== 'string') return false
    const key = canonicalize({ id: entry.id, payload: entry.payload, envelope })
    let ok = this._verified.get(key)
    if (ok === undefined) {
      ok = await verifyEntry('users', entry.id, entry.payload, envelope, Number.POSITIVE_INFINITY)
      this._verified.set(key, ok)
      // Bounded: every peer adds one signature per re-sign.
      if (this._verified.size > 2000) {
        this._verified.delete(this._verified.keys().next().value as string)
      }
    }
    if (!ok) LOG('rejected (bad signature)', entry.id)
    return ok
  }

  /** Recompute the visible set; notify only if it changed. */
  private _refreshVisible(): void {
    const now = Date.now()
    const next: Record<string, any> = {}
    if (this._own) next[this.selfId] = this._own
    for (const [id, seen] of this._seen) {
      if (!this._present.has(id) || now - seen.advancedAt > STALE_AFTER) continue
      if (!this.authorize(id, seen.signer)) continue
      const leftAt = this._leftAt.get(id)
      if (leftAt !== undefined) {
        if (seen.nonce <= leftAt) continue
        this._leftAt.delete(id)
      }
      next[id] = seen.payload
    }
    if (JSON.stringify(next) === JSON.stringify(this._visible)) return
    this._visible = next
    this.onChange()
  }
}
