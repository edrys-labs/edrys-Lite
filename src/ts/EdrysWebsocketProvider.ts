import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { encoding, decoding } from 'lib0'

const MESSAGE_TYPE_CUSTOM = 42
const MESSAGE_TYPE_ID = 43
const MESSAGE_EXPIRATION_TIME = 10000 // 10 seconds

function generateUniqueId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
}

export class EdrysWebsocketProvider {
  private _messageListener: Function | null = null
  private _bcChannel: BroadcastChannel
  private _processedMessages: Map<string, number>
  private _cleanupInterval: number | null = null
  private _leaveListener: Function | null = null
  public userid: string
  private provider: WebsocketProvider
  private doc: Y.Doc

  constructor(roomName: string, doc: Y.Doc, options: any) {
    this.doc = doc
    this.userid = options.userid || this.doc.clientID.toString()

    // Initialize Y-WebSocket provider
    this.provider = new WebsocketProvider(
      options.serverUrl || 'wss://demos.yjs.dev',
      roomName,
      this.doc,
      {
        connect: true,
        params: { userid: this.userid }, // Pass userid as a query parameter
      }
    )

    // Map of processed messages: messageId -> receivedTimestamp
    this._processedMessages = new Map()
    // Start periodic cleanup of old messages
    this._cleanupInterval = window.setInterval(
      () => this._cleanupProcessedMessages(),
      MESSAGE_EXPIRATION_TIME
    )

    // Initialize BroadcastChannel for tab communication
    this._bcChannel = new BroadcastChannel(`custom-ws-provider-${roomName}`)

    // Listen for BroadcastChannel messages
    this._bcChannelListener = this._bcChannelListener.bind(this)
    this._bcChannel.addEventListener('message', this._bcChannelListener)

    // Handle provider connection status
    this.provider.on('status', (event: { status: string }) => {
      console.log(`Y-WebSocket status: ${event.status}`)
      if (event.status === 'connected') {
        // Send initial user ID message after connection
        this._sendOwnId()
      }
    })
  }

  _bcChannelListener(event) {
    const message = event.data
    if (this._isDuplicateMessage(message)) return
    if (this._messageListener) {
      this._messageListener(message)
    }
  }

  _isDuplicateMessage(message) {
    if (!message || !message.id) {
      return false
    }

    if (this._processedMessages.has(message.id)) {
      return true
    }

    this._processedMessages.set(message.id, Date.now())
    return false
  }

  _cleanupProcessedMessages() {
    const now = Date.now()
    for (const [id, timestamp] of this._processedMessages.entries()) {
      if (now - timestamp > MESSAGE_EXPIRATION_TIME) {
        this._processedMessages.delete(id)
      }
    }
  }

  _sendOwnId() {
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_TYPE_ID)
    encoding.writeVarString(encoder, this.userid)
    const encodedMessage = encoding.toUint8Array(encoder)

    // Send the message through the Y-WebSocket provider's connection
    if (this.provider.ws) {
      this.provider.ws.send(encodedMessage)
    } else {
      console.warn('WebSocket connection not available to send ID.')
    }
  }

  /**
   * Send a custom JSON message to the server.
   * @param {string} message - The topic of the message.
   * @param {string} [targetUserId=null] - The target user's ID. If null, broadcast to all.
   */
  sendMessage(message: any, targetUserId: string | null = null) {
    if (!message.id) {
      message.id = generateUniqueId()
    }

    // Send via BroadcastChannel for other tabs
    this._bcChannel.postMessage(message)

    // Encode for WebSocket
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_TYPE_CUSTOM)
    encoding.writeVarString(encoder, JSON.stringify(message))
    const encodedMessage = encoding.toUint8Array(encoder)

    // Send the message through the Y-WebSocket provider's connection
    if (this.provider.ws) {
      this.provider.ws.send(encodedMessage)
    } else {
      console.warn('WebSocket connection not available to send message.')
    }
  }

  /**
   * Register a callback to handle incoming custom messages.
   * @param {function({topic: string, body: any, userid: string}): void} callback
   */
  onMessage(callback) {
    this._messageListener = callback

    // Override the providers message callback
    this.provider.on('message', (messageEvent: MessageEvent) => {
      try {
        const decoder = decoding.createDecoder(
          new Uint8Array(messageEvent.data)
        )
        const messageType = decoding.readVarUint(decoder)

        if (messageType === MESSAGE_TYPE_CUSTOM) {
          const messageContent = decoding.readVarString(decoder)
          const message = JSON.parse(messageContent)

          if (this._isDuplicateMessage(message)) return

          if (this._messageListener) {
            this._messageListener(message)
          }
        } else if (messageType === MESSAGE_TYPE_ID) {
          // Handle user ID messages if needed
          const remoteUserId = decoding.readVarString(decoder)
          console.log(`Received user ID: ${remoteUserId}`)
        }
      } catch (e) {
        console.error('Failed to parse incoming message:', e)
      }
    })
  }

  /**
   * Register a callback to handle when peers leave.
   * @param {function(userid: string): void} callback
   */
  onLeave(callback) {
    this._leaveListener = callback
  }

  /**
   * Disconnects the provider
   */
  disconnect() {
    this.provider.disconnect()
  }

  /**
   * Connects the provider
   */
  connect() {
    this.provider.connect()
  }

  /**
   * Clean up resources when the provider is destroyed.
   */
  destroy() {
    this.disconnect()

    this._bcChannel.removeEventListener('message', this._bcChannelListener)
    this._bcChannel.close()

    this._messageListener = null
    this._leaveListener = null

    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval)
      this._cleanupInterval = null
    }

    this._processedMessages.clear()
  }
}
