import { WebrtcProvider } from 'y-webrtc'
import { encoding, decoding } from 'lib0'

const MESSAGE_TYPE_CUSTOM = 42
const MESSAGE_TYPE_ID = 43

export class EdrysWebrtcProvider extends WebrtcProvider {
  private _messageListener: Function | null = null
  private _setupPeers: Set<string>
  private _peerUserIds: Map<string, string>
  private _userIdToPeer: Map<string, any>
  private _bcChannel: BroadcastChannel
  private _leaveListener: Function | null = null
  public userid: string

  constructor(roomName: string, doc: any, options: any) {
    super(roomName, doc, options)

    // Map to store peers we've already set up listeners for
    this._setupPeers = new Set()

    // Map peer IDs to user IDs
    this._peerUserIds = new Map()

    // Map user IDs to peer connections
    this._userIdToPeer = new Map()

    // Initialize BroadcastChannel
    this._bcChannel = new BroadcastChannel(`custom-webrtc-provider-${roomName}`)

    // Listen for BroadcastChannel messages
    this._bcChannel.addEventListener('message', (event) => {
      if (this._messageListener) {
        this._messageListener(event.data)
      }
    })

    // Listen for new peer connections
    this.on('peers', (event) => {
      const { added } = event
      added.forEach((peerId) => {
        this._setupPeerListeners(peerId)
      })
    })

    // Assign own unique user ID
    this.userid = options.userid || this.doc.clientID.toString()
  }

  /**
   * Setup event listeners for a peer connection.
   * @param {string} peerId - The ID of the peer.
   */
  _setupPeerListeners(peerId) {
    if (!this.room) return

    // Find the connection with the matching remotePeerId
    const conn = Array.from(this.room.webrtcConns.values()).find(
      (connection) => connection.remotePeerId === peerId
    )

    if (conn && conn.peer) {
      const peer = conn.peer

      // Ensure we don't add multiple listeners
      if (this._setupPeers.has(peerId)) return

      this._setupPeers.add(peerId)

      peer.on('connect', () => {
        console.log(`Connected to peer ${peerId}`)
        // Send own unique ID to the peer
        this._sendOwnId(peer)
      })

      peer.on('data', (data) => {
        this._handleIncomingData(data, peerId, peer)
      })

      peer.on('error', (err) => {
        console.error(`Error with peer ${peerId}:`, err)
      })

      peer.on('close', () => {
        console.log(`Connection closed with peer ${peerId}`)
        this._setupPeers.delete(peerId)

        const remoteUserId = this._peerUserIds.get(peerId)
        if (remoteUserId) {
          // Invoke all registered leave callbacks with the remoteUserId
          if (this._leaveListener) this._leaveListener(remoteUserId)

          // Remove mappings
          this._peerUserIds.delete(peerId)
          this._userIdToPeer.delete(remoteUserId)
        }
      })
    } else {
      // Retry after a delay if the connection is not yet established
      setTimeout(() => this._setupPeerListeners(peerId), 100)
    }
  }

  /**
   * Send own unique ID to the peer.
   * @param {any} peer - The peer connection.
   */
  _sendOwnId(peer) {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_TYPE_ID) // Message type for ID exchange
    encoding.writeVarString(encoder, this.userid) // Your own unique ID
    const encodedMessage = encoding.toUint8Array(encoder)
    peer.send(encodedMessage)
  }

  /**
   * Handle incoming data from peers.
   * @param {Uint8Array} data - The data received.
   * @param {string} senderId - The ID of the sender.
   * @param {any} peer - The peer connection.
   */
  _handleIncomingData(data, senderId, peer) {
    try {
      // y-webrtc encodes messages with a message type
      const decoder = decoding.createDecoder(data)
      const messageType = decoding.readVarUint(decoder)

      if (messageType === MESSAGE_TYPE_CUSTOM) {
        const messageContent = decoding.readVarString(decoder)
        const message = JSON.parse(messageContent)

        // Invoke all registered listeners with the message
        if (this._messageListener) this._messageListener(message)
      } else if (messageType === MESSAGE_TYPE_ID) {
        const remoteUserId = decoding.readVarString(decoder)
        // Map the remoteUserId to the peer
        this._peerUserIds.set(senderId, remoteUserId)
        this._userIdToPeer.set(remoteUserId, peer)
      }
    } catch (e) {
      console.error('Failed to parse incoming message:', e)
    }
  }

  /**
   * Register a callback to handle when peers leave.
   * @param {function(userid: string): void} callback
   */
  onLeave(callback) {
    this._leaveListener = callback
  }

  /**
   * Send a custom JSON message to connected peers.
   * @param {string} message - The topic of the message.
   * @param {string} [targetUserId=null] - The target user's ID. If null, broadcast to all.
   */

  sendMessage(message: any, targetUserId: string | null = null) {
    // Send via BroadcastChannel
    this._bcChannel.postMessage(message)

    // Encode the message for WebRTC peers
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_TYPE_CUSTOM) // Custom message type
    encoding.writeVarString(encoder, JSON.stringify(message))
    const encodedMessage = encoding.toUint8Array(encoder)

    // Send the message to the specified peer or broadcast to all
    if (this.room) {
      if (targetUserId) {
        // Send to specific peer
        const peer = this._userIdToPeer.get(targetUserId)
        if (peer && peer.connected) {
          peer.send(encodedMessage)
        }
      } else {
        // Broadcast to all peers
        this.room.webrtcConns.forEach((conn) => {
          const peer = conn.peer
          if (peer && peer.connected) {
            peer.send(encodedMessage)
          }
        })
      }
    }
  }

  /**
   * Register a callback to handle incoming custom messages.
   * @param {function({topic: string, body: any, userid: string}): void} callback
   */
  onMessage(callback) {
    this._messageListener = callback
  }

  /**
   * Clean up resources when the provider is destroyed.
   */
  destroy() {
    super.destroy()
    this._bcChannel.close()
    this._messageListener = null
    this._leaveListener = null
  }
}