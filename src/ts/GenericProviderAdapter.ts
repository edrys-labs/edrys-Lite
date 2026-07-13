import * as Y from 'yjs'
import { GenericProvider } from 'genericprovider'
import Peer from 'simple-peer/simplepeer.min.js'
import { EdrysSimplePeerTransport } from './EdrysSimplePeerTransport'
import { REVERT_INVALID_ORIGIN } from './Utils'

// Topic used for edrys custom messages carried over the provider's pubsub.
const EDRYS_MSG_TOPIC = 'edrys'

/**
 * Adapter that presents a GenericProvider + EdrysSimplePeerTransport behind the
 * legacy provider API that Peer.ts consumes (on/onLeave/onMessage/sendMessage/
 * disconnect/destroy). Temporary scaffolding for the y-generic migration: E4
 * will fold this into Peer.ts directly, and E3 will replace the minimal pubsub
 * messaging here with the full dedup/history/BroadcastChannel implementation.
 */
export class GenericWebrtcProviderAdapter {
  public userid: string
  private provider: GenericProvider
  private transport: EdrysSimplePeerTransport
  private _statusListener: ((event: { status: string }) => void) | null = null
  private _syncedListener: ((event: any) => void) | null = null
  private _messageUnsub: (() => void) | null = null

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
      callback(msg)
    })
  }

  sendMessage(message: any, targetUserId: string | null = null) {
    if (targetUserId) {
      // localId filtering delivers to exactly the target userid.
      this.provider.pubsub.publishTo(targetUserId, EDRYS_MSG_TOPIC, message)
    } else {
      this.provider.pubsub.publish(EDRYS_MSG_TOPIC, message)
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
    this.provider.destroy()
  }
}
