import * as Y from 'yjs'
import { GenericProvider } from '@edryslabs/genericprovider'
import { WebSocketTransport } from '@edryslabs/genericprovider/providers/websocket'
import { debug } from '../api/debugHandler'
import { signChallenge, verifyChallenge, getPeerID, REVERT_INVALID_ORIGIN } from './Utils'

// Awareness field carrying a custom message.
const CUSTOM_MESSAGE_FIELD = 'customMessage'

// How long a processed message id is remembered (dedup).
const MESSAGE_EXPIRATION_TIME = 10000

// Heartbeat cadence; window after which a silent peer counts as gone.
const HEARTBEAT_INTERVAL = 5000
const PEER_TIMEOUT = 15000

function generateUniqueId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11)
}

/**
 * WebSocket adapter: GenericProvider + stock WebSocketTransport behind the
 * provider API Peer.ts consumes.
 *
 * PROTOCOL CONSTRAINT (why it diverges from the WebRTC adapter): a stock
 * y-websocket server only relays sync (0) and awareness (1) opcodes; pubsub
 * (2/4) and verified-sync (3) are dropped. Hence the three provider options
 * below, and identity + custom messages ride awareness (not pubsub).
 *
 * Identity: each client publishes {id, publicKey, signature, heartbeat} into
 * awareness; a peer is trusted only after verifyChallenge() passes, and a stale
 * heartbeat counts as a leave (WS has no per-peer disconnect). Custom messages
 * are accepted only from verified peers.
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
      // Keep local rollback transactions local (revert-filter parity).
      excludeOrigins: [REVERT_INVALID_ORIGIN],
      // Use plain sync opcode (0), relayed; verified-sync (3) would be dropped.
      verifyUpdates: false,
      // Pull-only on connect: adopt the server's authoritative doc instead of
      // pushing our pre-seeded local copy (else signed-state revert can't
      // reconcile over the relay → self-only divergence on reload).
      syncMode: 'pull',
    })
    this.awareness = this.provider.awareness

    // ConnectionStatus -> legacy { status } shape.
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
    // Remember our own id so its awareness echo isn't re-delivered.
    this._processedMessages.set(message.id, Date.now())

    // Publish into awareness (broadcast — no targeting on this transport;
    // Peer.broadcast() fans out one copy per recipient anyway).
    const local = this.awareness.getLocalState() || {}
    this.awareness.setLocalState({
      ...local,
      user: { ...(local.user || {}), id: this.userid },
      [CUSTOM_MESSAGE_FIELD]: message,
    })

    // Clear it shortly after — awareness state is sticky and would re-send.
    setTimeout(() => {
      const current = this.awareness.getLocalState() || {}
      if (current[CUSTOM_MESSAGE_FIELD]?.id === message.id) {
        this.awareness.setLocalState({ ...current, [CUSTOM_MESSAGE_FIELD]: null })
      }
    }, 1000)
  }

  // Verify new peers, refresh heartbeats, deliver messages from verified peers.
  private _onAwarenessUpdate = ({ added, updated }: any) => {
    const states = this.awareness.getStates()
    for (const clientId of [...added, ...updated]) {
      const state = states.get(clientId)
      const user = state?.user
      if (!user || !user.id || user.id === this.userid) continue

      this._verifyPeer(user)
      this._lastHeartbeats.set(user.id, Date.now())

      // Deliver a message only from a verified peer, once.
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
