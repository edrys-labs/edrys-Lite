import { WebrtcProvider } from 'y-webrtc'
import { encoding, decoding } from 'lib0'

const MESSAGE_TYPE_CUSTOM = 42
const MESSAGE_TYPE_ID = 43
const MESSAGE_EXPIRATION_TIME = 10000 // 10 seconds

// A simple UUID generator (you could use a library like uuid)
function generateUniqueId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
}

export class EdrysWebrtcProvider extends WebrtcProvider {
  private _messageListener: Function | null = null
  private _setupPeers: Set<string>
  private _peerUserIds: Map<string, string>
  private _userIdToPeer: Map<string, any>
  private _bcChannel: BroadcastChannel
  private _processedMessages: Map<string, number>
  private _cleanupInterval: number | null = null
  private _leaveListener: Function | null = null
  public userid: string

  constructor(roomName: string, doc: any, options: any) {
    super(roomName, doc, options)
    // Map of processed messages: messageId -> receivedTimestamp
    this._processedMessages = new Map()
    // Start periodic cleanup of old messages
    this._cleanupInterval = window.setInterval(
      () => this._cleanupProcessedMessages(),
      MESSAGE_EXPIRATION_TIME
    )

    // Map to store peers we've already set up listeners for
    this._setupPeers = new Set()

    // Map peer IDs to user IDs
    this._peerUserIds = new Map()

    // Map user IDs to peer connections
    this._userIdToPeer = new Map()

    // Initialize BroadcastChannel
    this._bcChannel = new BroadcastChannel(`custom-webrtc-provider-${roomName}`)

    // Listen for BroadcastChannel messages
    this._bcChannelListener = this._bcChannelListener.bind(this)
    this._bcChannel.addEventListener('message', this._bcChannelListener)

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

  _bcChannelListener(event) {
    const message = event.data
    if (this._isDuplicateMessage(message)) return
    if (this._messageListener) {
      this._messageListener(message)
    }
  }

  /**
   * Check if a message is duplicate and mark it as processed if not.
   */
  _isDuplicateMessage(message) {
    if (!message || !message.id) {
      // If there's no ID, treat it as unique. Ideally all messages have IDs.
      return false
    }

    if (this._processedMessages.has(message.id)) {
      return true
    }

    // Mark as processed with the current timestamp
    this._processedMessages.set(message.id, Date.now())
    return false
  }

  /**
   * Periodically cleanup old message IDs to prevent memory bloat.
   * Removes messages older than MESSAGE_EXPIRATION_TIME (10 seconds).
   */
  _cleanupProcessedMessages() {
    const now = Date.now()
    for (const [id, timestamp] of this._processedMessages.entries()) {
      if (now - timestamp > MESSAGE_EXPIRATION_TIME) {
        this._processedMessages.delete(id)
      }
    }
  }

  /**
   * Setup event listeners for a peer connection, including robust error logging.
   * @param {string} peerId - The ID of the peer.
   * @param {number} attempt - The current reconnection attempt count.
   */
  _setupPeerListeners(peerId, attempt = 0) {
    if (!this.room) return

    // Find the connection with the matching remotePeerId
    const conn = Array.from(this.room.webrtcConns.values()).find(
      (connection) => connection.remotePeerId === peerId
    )

    if (conn && conn.peer) {
      const peer = conn.peer

      // Prevent multiple listener setups for the same peer
      if (this._setupPeers.has(peerId)) return
      this._setupPeers.add(peerId)

      peer.on('connect', () => {
        console.log(`Connected to peer ${peerId}`)
        // Reset attempt counter on successful connection.
        attempt = 0
        // Send own unique ID to the peer.
        this._sendOwnId(peer)
      })

      // Monitor ICE state changes and attempt ICE restart if necessary.
      peer.on('iceconnectionstatechange', () => {
        const state = peer.iceConnectionState
        console.log(`ICE state for peer ${peerId} changed to ${state}`)
        if (state === 'failed' || state === 'disconnected') {
          console.log(
            `ICE state for peer ${peerId} is ${state}. Attempting ICE restart...`
          )
          if (peer.restartIce) {
            peer.restartIce()
          }
        }
      })

      // Listen for incoming data.
      peer.on('data', (data) => {
        this._handleIncomingData(data, peerId, peer)
      })

      // Expanded error handler with detailed error logging.
      peer.on('error', (err) => {
        const errorDetails = {
          message: err.message || 'No error message',
          code: err.code || 'No error code',
          stack: err.stack || 'No stack trace available',
          peerId: peerId,
          timestamp: new Date().toISOString(),
        }
        console.error(`Error with peer ${peerId}:`, errorDetails)

        // Optionally, trigger a reconnection or additional cleanup steps here.
      })

      // Handle connection closure and schedule reconnection.
      peer.on('close', () => {
        console.log(`Connection closed with peer ${peerId}`)
        this._setupPeers.delete(peerId)

        const remoteUserId = this._peerUserIds.get(peerId)
        if (remoteUserId) {
          if (this._leaveListener) this._leaveListener(remoteUserId)
          this._peerUserIds.delete(peerId)
          this._userIdToPeer.delete(remoteUserId)
        }

        // Exponential backoff for reconnection: delay doubles each attempt up to a cap.
        const baseDelay = 1000 // 1 second.
        const maxDelay = 30000 // 30 seconds maximum delay.
        const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay)
        console.log(`Reconnection attempt for peer ${peerId} in ${delay}ms`)
        setTimeout(() => {
          this._setupPeerListeners(peerId, attempt + 1)
        }, delay)
      })
    } else {
      // If connection is not yet established, try again shortly with the same attempt count.
      setTimeout(() => this._setupPeerListeners(peerId, attempt), 100)
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
      const decoder = decoding.createDecoder(data)
      const messageType = decoding.readVarUint(decoder)

      if (messageType === MESSAGE_TYPE_CUSTOM) {
        const messageContent = decoding.readVarString(decoder)
        const message = JSON.parse(messageContent)

        // Check for duplicates before processing
        if (this._isDuplicateMessage(message)) return

        if (this._messageListener) {
          this._messageListener(message)
        }
      } else if (messageType === MESSAGE_TYPE_ID) {
        const remoteUserId = decoding.readVarString(decoder)
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
    if (!message.id) {
      message.id = generateUniqueId()
    }

    // Send via BroadcastChannel
    this._bcChannel.postMessage(message)

    // Encode for WebRTC
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_TYPE_CUSTOM)
    encoding.writeVarString(encoder, JSON.stringify(message))
    const encodedMessage = encoding.toUint8Array(encoder)

    if (this.room) {
      if (targetUserId) {
        const peer = this._userIdToPeer.get(targetUserId)
        if (peer && peer.connected) {
          peer.send(encodedMessage)
        }
      } else {
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

    this._bcChannel.removeEventListener('message', this._bcChannelListener)
    this._bcChannel.close()

    this._messageListener = null
    this._leaveListener = null

    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval)
      this._cleanupInterval = null
    }

    this._setupPeers.clear()

    // Clear any other lingering data
    this._processedMessages.clear()
  }
}
