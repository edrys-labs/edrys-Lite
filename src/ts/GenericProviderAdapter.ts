import * as Y from 'yjs'
import { GenericProvider } from '@edryslabs/genericprovider'
import Peer from 'simple-peer/simplepeer.min.js'
import { EdrysSimplePeerTransport } from './EdrysSimplePeerTransport'
import { REVERT_INVALID_ORIGIN } from './Utils'

// Pubsub topic for edrys custom messages.
const EDRYS_MSG_TOPIC = 'edrys'

// How long a processed message id is remembered (dedup).
const MESSAGE_EXPIRATION_TIME = 10000

function generateUniqueId(): string {
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 11)
}

/**
 * WebRTC adapter: GenericProvider + EdrysSimplePeerTransport behind the provider
 * API Peer.ts consumes (on/onLeave/onMessage/sendMessage/disconnect/destroy).
 * Cross-tab delivery and dedup are the provider's pubsub; this layer only adds
 * app-level message id/sender stamping.
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
      // Keep local rollback transactions local (revert-filter parity).
      excludeOrigins: [REVERT_INVALID_ORIGIN],
      // Identity for targeted pubsub (publishTo by userid).
      localId: this.userid,
    })

    // ConnectionStatus -> legacy { status } shape.
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
    // Mark own id processed up front, guarding a future echo path.
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
