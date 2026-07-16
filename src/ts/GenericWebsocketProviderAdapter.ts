import * as Y from 'yjs'
import { GenericProvider } from 'genericprovider'
// Vite/vitest resolve this exports subpath; Parcel can't, so package.json's
// "alias" maps it to the concrete dist file for the parcel build.
import { WebSocketTransport } from 'genericprovider/providers/websocket'
import { debug } from '../api/debugHandler'
import { signChallenge, verifyChallenge, getPeerID, REVERT_INVALID_ORIGIN } from './Utils'

// Awareness field carrying a custom message (see messaging note below).
const CUSTOM_MESSAGE_FIELD = 'customMessage'

// How long a processed message id is remembered before it's forgotten.
const MESSAGE_EXPIRATION_TIME = 10000

// Heartbeat cadence and the window after which a silent peer is considered gone.
const HEARTBEAT_INTERVAL = 5000
const PEER_TIMEOUT = 15000

function generateUniqueId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11)
}

/**
 * edrys WebSocket adapter: GenericProvider + the stock WebSocketTransport behind
 * the legacy provider API that Peer.ts consumes (on/onLeave/onMessage/
 * sendMessage/disconnect/destroy).
 *
 * PROTOCOL CONSTRAINT (why this diverges from the WebRTC adapter): a stock
 * y-websocket server only relays two message opcodes — sync (0) and awareness
 * (1). GenericProvider's other opcodes (pubsub 2/4, verified-sync 3) are
 * silently dropped by such a server. So this adapter:
 *   - sets `verifyUpdates: false`, forcing doc updates onto the plain sync
 *     opcode (0) the server relays, instead of the verified-sync opcode (3);
 *   - rides **Yjs awareness** for both the identity gate AND custom messages
 *     (the WebRTC adapter uses pubsub for messages, but pubsub opcodes don't
 *     survive a y-websocket relay), exactly like the old EdrysWebsocketProvider;
 *   - sets `syncMode: 'pull'` so it does not push its full local doc on connect.
 *     edrys seeds the doc (initUser/initRooms) before connecting; pushing that
 *     on a relay (where the server holds authoritative state) makes peers fight
 *     over competing copies via the signed-state revert gate — one-sided
 *     self-only divergence on reload. Pulling lets a peer adopt server state.
 *
 * Identity: each client publishes {id, publicKey, signature, heartbeat} in its
 * awareness state; a peer is trusted only once verifyChallenge() passes, and a
 * peer whose heartbeat goes stale is treated as having left (WS has no per-peer
 * disconnect signal). Custom messages are only accepted from verified peers.
 */
export class GenericWebsocketProviderAdapter {
  public userid: string
  private provider: GenericProvider
  private transport: WebSocketTransport
  private awareness: any
  private _classroomId: string

  private _statusListener: ((event: { status: string }) => void) | null = null
  private _syncedListener: ((event: any) => void) | null = null
  private _leaveListener: ((userid: string) => void) | null = null
  private _messageListener: ((msg: any) => void) | null = null

  // userids that passed signature verification.
  private _verifiedUsers = new Set<string>()
  // userid -> last heartbeat timestamp, for leave-by-timeout detection.
  private _lastHeartbeats = new Map<string, number>()

  private _processedMessages = new Map<string, number>()
  private _cleanupInterval: ReturnType<typeof setInterval> | null = null
  private _heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private _timeoutInterval: ReturnType<typeof setInterval> | null = null

  constructor(room: string, doc: Y.Doc, options: any) {
    this.userid = options.userid || doc.clientID.toString()
    this._classroomId = options.classroomId || room

    this.transport = new WebSocketTransport()

    this.provider = new GenericProvider(doc, this.transport, {
      // Local rollback transactions must stay local (revert-filter parity).
      excludeOrigins: [REVERT_INVALID_ORIGIN],
      // Plain sync opcode (0) so a stock y-websocket server relays our updates;
      // the verified-sync opcode (3) would be dropped. See class note.
      verifyUpdates: false,
      // Pull-only on connect: the y-websocket server holds authoritative room
      // state; a reconnecting peer must ADOPT it, not push its freshly
      // initialized local copy (initUser/initRooms run before connect). Pushing
      // feeds edrys's signed-state revert gate competing state it can't
      // reconcile over a relay, causing self-only divergence on reload.
      syncMode: 'pull',
    })
    this.awareness = this.provider.awareness

    // Map GenericProvider's ConnectionStatus -> legacy { status } shape.
    this.provider.on('status', (status: any) => {
      if (status?.state === 'connected' && this._statusListener) {
        this._statusListener({ status: 'connected' })
      }
    })
    this.provider.on('synced', (isSynced: boolean) => {
      if (isSynced && this._syncedListener) this._syncedListener({ synced: true })
    })

    // Awareness carries the identity handshake, heartbeats, and custom messages.
    this.awareness.on('update', this._onAwarenessUpdate)

    this.provider
      .connect({
        room,
        serverUrl: options.serverUrl || 'wss://demos.yjs.dev',
      })
      .catch((e) => console.error('GenericProvider (ws) connect failed:', e))

    this._cleanupInterval = setInterval(
      () => this._cleanupProcessedMessages(),
      MESSAGE_EXPIRATION_TIME
    )
    this._heartbeatInterval = setInterval(() => this._sendHeartbeat(), HEARTBEAT_INTERVAL)
    this._timeoutInterval = setInterval(() => this._checkHeartbeats(), PEER_TIMEOUT / 2)
  }

  on(eventName: string, callback: (event: any) => void) {
    if (eventName === 'status') this._statusListener = callback
    else if (eventName === 'synced') this._syncedListener = callback
  }

  onLeave(callback: (userid: string) => void) {
    this._leaveListener = callback
  }

  onMessage(callback: (msg: any) => void) {
    this._messageListener = callback
  }

  sendMessage(message: any, _targetUserId: string | null = null) {
    if (!message.id) message.id = generateUniqueId()
    if (!message.sender) message.sender = this.userid
    // Remember our own id so an echo of it via awareness isn't re-delivered.
    this._processedMessages.set(message.id, Date.now())

    // Publish the message into awareness; targeting is not supported on this
    // transport (awareness is broadcast), matching the old WS provider — the
    // recipient-fan-out that Peer.broadcast() does still routes each copy here.
    const local = this.awareness.getLocalState() || {}
    this.awareness.setLocalState({
      ...local,
      user: { ...(local.user || {}), id: this.userid },
      [CUSTOM_MESSAGE_FIELD]: message,
    })

    // Clear the message shortly after so it isn't re-sent on future awareness
    // updates (old provider's hack — awareness state is sticky).
    setTimeout(() => {
      const current = this.awareness.getLocalState() || {}
      if (current[CUSTOM_MESSAGE_FIELD]?.id === message.id) {
        this.awareness.setLocalState({ ...current, [CUSTOM_MESSAGE_FIELD]: null })
      }
    }, 1000)
  }

  /**
   * Awareness update: verify newly-seen peers, refresh their heartbeat clocks,
   * and deliver any custom message a verified peer is carrying.
   */
  private _onAwarenessUpdate = ({ added, updated }: any) => {
    const states = this.awareness.getStates()
    for (const clientId of [...added, ...updated]) {
      const state = states.get(clientId)
      const user = state?.user
      if (!user || !user.id || user.id === this.userid) continue

      this._verifyPeer(user)
      this._lastHeartbeats.set(user.id, Date.now())

      // Deliver a custom message only from a verified peer, once.
      const message = state[CUSTOM_MESSAGE_FIELD]
      if (message && this._verifiedUsers.has(user.id) && !this._isDuplicateMessage(message)) {
        if (this._messageListener) this._messageListener(message)
      }
    }
  }

  /** Verify a remote peer's signed challenge once; trust it only if it passes. */
  private _verifyPeer(user: any) {
    const { id: remoteId, publicKey, signature } = user
    if (publicKey && signature && !this._verifiedUsers.has(remoteId)) {
      verifyChallenge(this._classroomId, publicKey, signature)
        .then((valid) => {
          if (valid) {
            this._verifiedUsers.add(remoteId)
          } else {
            debug.ts.edrysWebsocketProvider(`Peer ${remoteId} failed handshake — ignoring`)
          }
        })
        .catch((e) => console.error('WebSocket handshake verification error:', e))
    }
  }

  /** Publish our signed identity + a fresh heartbeat into awareness. */
  private _sendHeartbeat() {
    const local = this.awareness.getLocalState() || {}
    signChallenge(this._classroomId)
      .then((signature) => {
        this.awareness.setLocalState({
          ...local,
          user: {
            ...(local.user || {}),
            id: this.userid,
            publicKey: getPeerID(false),
            signature,
            heartbeat: Date.now(),
          },
        })
      })
      .catch(() => {
        this.awareness.setLocalState({
          ...local,
          user: { ...(local.user || {}), id: this.userid, heartbeat: Date.now() },
        })
      })
  }

  /** Treat peers whose heartbeat has gone stale as having left. */
  private _checkHeartbeats() {
    const now = Date.now()
    for (const [userid, last] of this._lastHeartbeats.entries()) {
      if (now - last > PEER_TIMEOUT) {
        this._lastHeartbeats.delete(userid)
        this._verifiedUsers.delete(userid)
        if (userid !== this.userid && this._leaveListener) this._leaveListener(userid)
      }
    }
  }

  private _isDuplicateMessage(message: any): boolean {
    if (!message || !message.id) return false
    if (this._processedMessages.has(message.id)) return true
    this._processedMessages.set(message.id, Date.now())
    return false
  }

  private _cleanupProcessedMessages() {
    const now = Date.now()
    for (const [id, timestamp] of this._processedMessages.entries()) {
      if (now - timestamp > MESSAGE_EXPIRATION_TIME) {
        this._processedMessages.delete(id)
      }
    }
  }

  disconnect() {
    this.provider.disconnect()
  }

  destroy() {
    this._statusListener = null
    this._syncedListener = null
    this._leaveListener = null
    this._messageListener = null
    this.awareness.off('update', this._onAwarenessUpdate)
    for (const t of [this._cleanupInterval, this._heartbeatInterval, this._timeoutInterval]) {
      if (t) clearInterval(t)
    }
    this._cleanupInterval = this._heartbeatInterval = this._timeoutInterval = null
    this._processedMessages.clear()
    this._verifiedUsers.clear()
    this._lastHeartbeats.clear()
    this.provider.destroy()
  }
}
