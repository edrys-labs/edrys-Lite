// Vite/vitest resolve this exports subpath; Parcel can't, so package.json's
// "alias" maps it to the concrete dist file for the parcel build.
import { SimplePeerTransport } from 'genericprovider/providers/simple-peer'
import type { SimplePeerTransportOptions } from 'genericprovider/providers/simple-peer'
import { encoding, decoding } from 'lib0'
import { debug } from '../api/debugHandler'
import { signChallenge, verifyChallenge, getPeerID } from './Utils'

// Control-frame types (ride MSG_TYPE_CONTROL, not the CRC-verified data pipe).
const CTRL_ID = 1
const CTRL_HANDSHAKE = 2

// Drop a peer that hasn't completed its signed handshake within this window.
const HANDSHAKE_TIMEOUT = 30000

interface PendingPeer {
  userid: string
  expiresAt: number
}

/**
 * edrys WebRTC transport: stock SimplePeerTransport + a crypto identity gate.
 * Each peer sends its `userid` (pubkey + session) plus a signature over the
 * classroom nonce; the userid is registered only after verifyChallenge()
 * passes, so a peer can't claim an identity it lacks the private key for.
 * (RE_ANNOUNCE_INTERVAL wasn't re-ported — the stock 5s re-announce subsumes it.)
 */
export class EdrysSimplePeerTransport extends SimplePeerTransport {
  private _classroomId: string
  // Verified: transport peerId -> edrys userid, and the reverse.
  private _peerUserIds = new Map<string, string>()
  private _userIdToPeer = new Map<string, string>()
  // Peers that announced a userid but haven't passed verification yet.
  private _pending = new Map<string, PendingPeer>()
  private _leaveListener: ((userid: string) => void) | null = null
  private _timeoutSweep: ReturnType<typeof setInterval> | null = null

  constructor(options: SimplePeerTransportOptions & { classroomId: string }) {
    super(options)
    this._classroomId = options.classroomId

    // Incoming control frames: ID announcement + signed handshake.
    this.onControlFrame((peerId, payload) => this._handleControl(peerId, payload))

    // On channel open, announce our own identity to the new peer.
    this.onPeerConnect((peerId) => this._sendOwnIdentity(peerId))

    // On disconnect, forget the mapping and notify the leave listener.
    this.onPeerDisconnect((peerId) => this._handleDisconnect(peerId))

    // Drop peers that never complete the handshake.
    this._timeoutSweep = setInterval(() => this._sweepPending(), HANDSHAKE_TIMEOUT)
  }

  /** Register a callback fired when a verified peer leaves. */
  onLeave(callback: (userid: string) => void): void {
    this._leaveListener = callback
  }

  /** Resolve a verified userid to its current transport peerId (for sendTo). */
  peerIdForUser(userid: string): string | undefined {
    return this._userIdToPeer.get(userid)
  }

  // publishTo targets by userid; base sendTo wants a peerId. Translate, else
  // broadcast (receivers drop by the frame's embedded target id).
  sendTo(userid: string, data: Uint8Array): void {
    const peerId = this._userIdToPeer.get(userid)
    if (peerId) {
      super.sendTo(peerId, data)
    } else {
      this.send(data)
    }
  }

  private _sendOwnIdentity(peerId: string): void {
    // Announce userid; the receiver holds it pending until the handshake verifies.
    const idEnc = encoding.createEncoder()
    encoding.writeVarUint(idEnc, CTRL_ID)
    encoding.writeVarString(idEnc, getPeerID(true))
    this.sendControl(peerId, encoding.toUint8Array(idEnc))

    signChallenge(this._classroomId)
      .then((signature) => {
        const hsEnc = encoding.createEncoder()
        encoding.writeVarUint(hsEnc, CTRL_HANDSHAKE)
        encoding.writeVarString(hsEnc, getPeerID(false)) // base pubkey
        encoding.writeVarString(hsEnc, signature)
        this.sendControl(peerId, encoding.toUint8Array(hsEnc))
      })
      .catch((e) => console.error('Failed to send handshake:', e))
  }

  private _handleControl(peerId: string, payload: Uint8Array): void {
    try {
      const decoder = decoding.createDecoder(payload)
      const type = decoding.readVarUint(decoder)

      if (type === CTRL_ID) {
        const userid = decoding.readVarString(decoder)
        // Hold pending until the handshake signature verifies it.
        this._pending.set(peerId, { userid, expiresAt: Date.now() + HANDSHAKE_TIMEOUT })
      } else if (type === CTRL_HANDSHAKE) {
        const publicKeyBase64 = decoding.readVarString(decoder)
        const signature = decoding.readVarString(decoder)
        const pending = this._pending.get(peerId)
        if (!pending) return

        // userid is `<pubkey>_<session>`; its base must equal the signing key.
        const claimedBase = pending.userid.split('_')[0]
        if (claimedBase !== publicKeyBase64) {
          debug.ts.edrysSimplePeerTransport(
            `Peer ${peerId} userid/pubkey mismatch — rejecting`
          )
          this._rejectPeer(peerId)
          return
        }

        verifyChallenge(this._classroomId, publicKeyBase64, signature)
          .then((valid) => {
            const stillPending = this._pending.get(peerId)
            if (!stillPending || stillPending.userid !== pending.userid) return
            if (!valid) {
              debug.ts.edrysSimplePeerTransport(
                `Peer ${peerId} failed handshake verification — rejecting`
              )
              this._rejectPeer(peerId)
              return
            }
            this._peerUserIds.set(peerId, pending.userid)
            this._userIdToPeer.set(pending.userid, peerId)
            this._pending.delete(peerId)
            debug.ts.edrysSimplePeerTransport(
              `Peer ${peerId} verified as ${pending.userid}`
            )
          })
          .catch((e) => {
            console.error('Handshake verification error:', e)
            this._rejectPeer(peerId)
          })
      }
    } catch (e) {
      console.error('Failed to parse control frame:', e)
    }
  }

  private _rejectPeer(peerId: string): void {
    this._pending.delete(peerId)
    // Tearing down the peer connection triggers onPeerDisconnect cleanup.
    this.disconnectPeer(peerId)
  }

  private _handleDisconnect(peerId: string): void {
    this._pending.delete(peerId)
    const userid = this._peerUserIds.get(peerId)
    if (userid) {
      this._peerUserIds.delete(peerId)
      this._userIdToPeer.delete(userid)
      if (this._leaveListener) this._leaveListener(userid)
    }
  }

  private _sweepPending(): void {
    const now = Date.now()
    for (const [peerId, pending] of this._pending.entries()) {
      if (now > pending.expiresAt) {
        debug.ts.edrysSimplePeerTransport(`Handshake timeout for peer ${peerId} — dropping`)
        this._rejectPeer(peerId)
      }
    }
  }

  disconnect(): void {
    super.disconnect()
    if (this._timeoutSweep) {
      clearInterval(this._timeoutSweep)
      this._timeoutSweep = null
    }
    this._peerUserIds.clear()
    this._userIdToPeer.clear()
    this._pending.clear()
  }
}
