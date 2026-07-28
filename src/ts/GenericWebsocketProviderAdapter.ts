import * as Y from 'yjs'
import { GenericProvider } from '@edryslabs/genericprovider'
import { WebSocketTransport } from '@edryslabs/genericprovider/providers/websocket'
import { debug } from '../api/debugHandler'
import { signChallenge, verifyChallenge, getPeerID, REVERT_INVALID_ORIGIN } from './Utils'

// Pubsub topic for edrys custom messages (matches the WebRTC adapter).
const EDRYS_MSG_TOPIC = 'edrys'

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
 * PROTOCOL CONSTRAINT (why it diverges from the WebRTC adapter): the server
 * relays sync (0), awareness (1) and pubsub (2/4), but verified-sync (3) is
 * still dropped — hence verifyUpdates:false and syncMode:'pull' below.
 * REQUIRES a server that relays opcodes 2/4 verbatim (edrys websocket-server
 * >= "relay pubsub frames"); against a stock y-websocket server custom
 * messages are silently dropped.
 *
 * Identity: each client publishes {id, publicKey, signature, heartbeat} into
 * awareness; a peer is trusted only after verifyChallenge() passes, and a stale
 * heartbeat counts as a leave (WS has no per-peer disconnect). Custom messages
 * ride pubsub (one frame each, order preserved) and are accepted only from
 * verified peers.
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
  private _messageUnsub: (() => void) | null = null

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
      // Identity for targeted pubsub (publishTo by userid).
      localId: this.userid,
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

    // Awareness carries the identity handshake and heartbeats.
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

  /** App Awareness for modules (cursors/presence); isolated from the handshake. */
  getAwareness(): any {
    return this.provider.appAwareness
  }

  onLeave(callback: (userid: string) => void) {
    this._leaveListener = callback
  }

  onMessage(callback: (msg: any) => void) {
    this._messageUnsub?.()
    this._messageUnsub = this.provider.pubsub.subscribe(EDRYS_MSG_TOPIC, (msg: any) => {
      // Same trust boundary as before: only verified peers may deliver.
      if (!msg?.sender || !this._verifiedUsers.has(msg.sender)) return
      if (this._isDuplicateMessage(msg)) return
      callback(msg)
    })
  }

  sendMessage(message: any, targetUserId: string | null = null) {
    if (!message.id) message.id = generateUniqueId()
    if (!message.sender) message.sender = this.userid
    this._processedMessages.set(message.id, Date.now())

    // Pubsub, not awareness: each message is its own frame, so ordering and
    // every message in a burst survive.
    if (targetUserId) {
      this.provider.pubsub.publishTo(targetUserId, EDRYS_MSG_TOPIC, message)
    } else {
      this.provider.pubsub.publish(EDRYS_MSG_TOPIC, message)
    }
  }

  // Verify new peers and refresh their heartbeats.
  private _onAwarenessUpdate = ({ added, updated }: any) => {
    const states = this.awareness.getStates()
    for (const clientId of [...added, ...updated]) {
      const state = states.get(clientId)
      const user = state?.user
      if (!user || !user.id || user.id === this.userid) continue

      this._verifyPeer(user)
      this._lastHeartbeats.set(user.id, Date.now())
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

  /**
   * Publish our signed identity + a fresh heartbeat into awareness.
   * Re-reads local state after the async sign so anything written meanwhile
   * isn't clobbered by a stale snapshot.
   */
  private _sendHeartbeat() {
    signChallenge(this._classroomId)
      .then((signature) => {
        const local = this.awareness.getLocalState() || {}
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
        const local = this.awareness.getLocalState() || {}
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
    this._messageUnsub?.()
    this._messageUnsub = null
    this._statusListener = null
    this._syncedListener = null
    this._leaveListener = null
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
