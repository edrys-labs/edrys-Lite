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

  private _messageBuffer: Map<
    string,
    Array<{ timestamp: number; message: Uint8Array }>
  > = new Map()

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

        // Check if buffered messages for this peer exist
        this._flushBufferedMessages(peerId, peer)
      })

      peer.on('data', (data) => {
        this._handleIncomingData(data, peerId, peer)
      })

      peer.on('error', (err) => {
        console.error(`Error with peer ${peerId}:`, err)
      })

      peer.on('iceconnectionstatechange', () => {
        console.warn(`ICE state for peer ${peerId}:`, peer.iceConnectionState)
      })

      peer.on('close', (msg) => {
        console.log(`Connection closed with peer ${peerId}`, msg)
      })
    } else {
      // Retry after a delay if the connection is not yet established
      setTimeout(() => this._setupPeerListeners(peerId), 100)
    }
  }

  removePeer(peerId: string) {
    this._setupPeers.delete(peerId)

    this._cleanBuffer(peerId)

    const remoteUserId = this._peerUserIds.get(peerId)
    if (remoteUserId) {
      // Invoke all registered leave callbacks with the remoteUserId
      if (this._leaveListener) this._leaveListener(remoteUserId)

      // Remove mappings
      this._peerUserIds.delete(peerId)
      this._userIdToPeer.delete(remoteUserId)
    }
  }

  /**
   * Cleans up the buffered messages for a given dropped peer.
   * This method removes all buffered messages associated with the target user
   * corresponding to the dropped peer.
   *
   * @param peerId - The ID of the dropped peer.
   */
  private _cleanBuffer(peerId: string): void {
    // Retrieve the target user ID for the given peer.
    const targetUserId = this._peerUserIds.get(peerId)
    if (!targetUserId) {
      console.warn(
        `No target user associated with peer ${peerId}. Buffer cleanup skipped.`
      )
      return
    }

    // If there are any buffered messages for the target user, delete them.
    if (this._messageBuffer.has(targetUserId)) {
      this._messageBuffer.delete(targetUserId)
      console.log(
        `Buffered messages for user ${targetUserId} have been cleared after dropping peer ${peerId}.`
      )
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
        } else {
          this._bufferMessage(targetUserId, encodedMessage)
        }
      } else {
        this.room.webrtcConns.forEach((conn) => {
          const peer = conn.peer
          if (peer && peer.connected) {
            peer.send(encodedMessage)
          } else {
            this._bufferMessage(
              this._peerUserIds.get(conn.remotePeerId),
              encodedMessage
            )
          }
        })
      }
    }
  }

  /**
   * Buffers a message for a target user if the peer is not connected.
   * @param targetUserId - user ID of the target user.
   * @param encodedMessage - the encoded message to buffer.
   */
  private _bufferMessage(
    targetUserId: string,
    encodedMessage: Uint8Array
  ): void {
    const timestamp = Date.now()

    // Create a buffer for the target user if it doesn't exist
    if (!this._messageBuffer.has(targetUserId)) {
      this._messageBuffer.set(targetUserId, [])
    }

    // Push the message to the buffer
    this._messageBuffer
      .get(targetUserId)!
      .push({ timestamp, message: encodedMessage })

    console.log(
      `Buffered message for user ${targetUserId} - Size: ${
        this._messageBuffer.get(targetUserId)!.length
      }`
    )
  }

  /**
   * Flushes any buffered messages for a given peer once the connection is re-established.
   *
   * @param peerId - The ID of the peer whose connection is now active.
   * @param peer - The active peer connection object.
   */
  private _flushBufferedMessages(peerId: string, peer: any): void {
    // Retrieve the target user ID associated with this peer.
    const targetUserId = this._peerUserIds.get(peerId)
    if (!targetUserId) {
      console.warn(
        `No target user ID found for peer ${peerId}. Unable to flush buffered messages.`
      )
      return
    }

    // Retrieve any buffered messages for this target user.
    const bufferedMessages = this._messageBuffer.get(targetUserId)
    if (bufferedMessages && bufferedMessages.length > 0) {
      console.log(
        `Flushing ${bufferedMessages.length} buffered message(s) for user ${targetUserId}.`
      )

      // Iterate over each buffered message and send it.
      bufferedMessages.forEach(({ message }) => {
        if (peer.connected) {
          peer.send(message)
        } else {
          console.warn(`Peer ${peerId} is no longer connected. Aborting flush.`)
        }
      })

      // Clear the buffer for this target user after successfully sending the messages.
      this._messageBuffer.delete(targetUserId)
    } else {
      console.log(`No buffered messages for user ${targetUserId}.`)
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

    this._messageBuffer.clear()
  }
}
