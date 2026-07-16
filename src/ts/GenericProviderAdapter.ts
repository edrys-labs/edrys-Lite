import * as Y from 'yjs'
import { GenericProvider } from 'genericprovider'
import Peer from 'simple-peer/simplepeer.min.js'
import { EdrysSimplePeerTransport } from './EdrysSimplePeerTransport'
import { REVERT_INVALID_ORIGIN } from './Utils'

// Topic used for edrys custom messages carried over the provider's pubsub.
const EDRYS_MSG_TOPIC = 'edrys'

// How long a processed message id is remembered before it's forgotten.
const MESSAGE_EXPIRATION_TIME = 10000

function generateUniqueId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11)
}

/**
 * Adapter that presents a GenericProvider + EdrysSimplePeerTransport behind the
 * legacy provider API that Peer.ts consumes (on/onLeave/onMessage/sendMessage/
 * disconnect/destroy). Temporary scaffolding for the y-generic migration: E4
 * will fold this into Peer.ts directly. Cross-tab delivery and per-transport
 * dedup are handled by the provider's pubsub itself; this layer only adds the
 * app-level message id/sender stamping and dedup edrys callers expect.
 */
export class GenericWebrtcProviderAdapter {
  public userid: string
  private provider: GenericProvider
  private transport: EdrysSimplePeerTransport
  private _statusListener: ((event: { status: string }) => void) | null = null
  private _syncedListener: ((event: any) => void) | null = null
  private _messageUnsub: (() => void) | null = null
  private _processedMessages = new Map<string, number>()
  private _cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(room: string, doc: Y.Doc, options: any) {
    this.userid = options.userid || doc.clientID.toString()

    this.transport = new EdrysSimplePeerTransport({
      peer: Peer,
      signaling: options.signaling,
      password: options.password || 'password',
      classroomId: options.classroomId || room,
      peerOpts: options.peerOpts,
    })

    this.provider = new GenericProvider(doc, this.transport, {
      // Local rollback transactions must stay local (revert-filter parity).
      excludeOrigins: [REVERT_INVALID_ORIGIN],
      // Identity for targeted pubsub (publishTo by userid).
      localId: this.userid,
    })

    // Map GenericProvider's ConnectionStatus -> legacy { status } shape.
    this.provider.on('status', (status: any) => {
      if (status?.state === 'connected' && this._statusListener) {
        this._statusListener({ status: 'connected' })
      }
    })
    this.provider.on('synced', (isSynced: boolean) => {
      if (isSynced && this._syncedListener) {
        this._syncedListener({ synced: true })
      }
    })

    this.provider.connect({ room }).catch((e) => {
      console.error('GenericProvider connect failed:', e)
    })

    this._cleanupInterval = setInterval(
      () => this._cleanupProcessedMessages(),
      MESSAGE_EXPIRATION_TIME
    )
  }

  on(eventName: string, callback: (event: any) => void) {
    if (eventName === 'status') this._statusListener = callback
    else if (eventName === 'synced') this._syncedListener = callback
  }

  onLeave(callback: (userid: string) => void) {
    this.transport.onLeave(callback)
  }

  onMessage(callback: (msg: any) => void) {
    this._messageUnsub?.()
    this._messageUnsub = this.provider.pubsub.subscribe(EDRYS_MSG_TOPIC, (msg) => {
      if (this._isDuplicateMessage(msg)) return
      callback(msg)
    })
  }

  sendMessage(message: any, targetUserId: string | null = null) {
    if (!message.id) {
      message.id = generateUniqueId()
    }
    if (!message.sender) {
      message.sender = this.userid
    }
    // Own sends never round-trip back through pubsub.subscribe, so mark them
    // processed up front in case a future echo path (e.g. relay fallback)
    // ever delivers our own message back to us.
    this._processedMessages.set(message.id, Date.now())

    if (targetUserId) {
      // localId filtering delivers to exactly the target userid.
      this.provider.pubsub.publishTo(targetUserId, EDRYS_MSG_TOPIC, message)
    } else {
      this.provider.pubsub.publish(EDRYS_MSG_TOPIC, message)
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
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval)
      this._cleanupInterval = null
    }
    this._processedMessages.clear()
    this.provider.destroy()
  }
}
