import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { encoding, decoding } from 'lib0'

const MESSAGE_TYPE_CUSTOM = 42
const MESSAGE_TYPE_ID = 43
const MESSAGE_EXPIRATION_TIME = 10000 // 10 seconds
const MAX_MESSAGES = 50
const CUSTOM_MESSAGE_FIELD = 'customMessage'

function generateUniqueId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
}

export class EdrysWebsocketProvider {
  private _messageListener: Function | null = null
  private _bcChannel: BroadcastChannel
  private _processedMessages: Map<string, number>
  private _cleanupInterval: number | null = null
  private _leaveListener: Function | null = null
  private _syncedListener: Function | null = null 
  private _statusListener: Function | null = null 
  public userid: string
  private provider: WebsocketProvider
  private doc: Y.Doc
  private _messageHistory: any[] = [] // Array to store message history
  private _hasBeenConnected: boolean = false // Track if we've ever been connected

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

      // Forward status event to listeners
      if (this._statusListener) {
        this._statusListener(event)
      }

      if (event.status === 'connected') {
        this._hasBeenConnected = true

        // Trigger synced event after connected 
        setTimeout(() => {
          if (this._syncedListener) {
            //console.log('WebSocket provider emitting synced event')
            this._syncedListener({ synced: true })
          }
        }, 1000)
      }
    })

    // Handle sync events
    this.provider.on('sync', (isSynced: boolean) => {
      //console.log(`WebSocket provider sync state: ${isSynced ? 'synced' : 'not synced'}`)

      if (isSynced && this._hasBeenConnected) {
        if (this._syncedListener) {
          //console.log('WebSocket provider emitting synced event after sync')
          this._syncedListener({ synced: true })
        }
      }
    })
  }

  // Add event handler for custom events
  on(eventName: string, callback: Function) {
    if (eventName === 'status') {
      this._statusListener = callback
    } else if (eventName === 'synced') {
      this._syncedListener = callback

      // If we're already connected, trigger synced event immediately
      if (this._hasBeenConnected) {
        setTimeout(() => {
          if (this._syncedListener) {
            //console.log('WebSocket provider emitting immediate synced event')
            this._syncedListener({ synced: true })
          }
        }, 500)
      }
    }
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

  /**
   * Send a custom JSON message to the server.
   * @param {string} message - The topic of the message.
   * @param {string} [targetUserId=null] - The target user's ID. If null, broadcast to all.
   */
  sendMessage(message: any, targetUserId: string | null = null) {
    // Ensure each message has a unique ID based on timestamp
    message.id = Date.now().toString() + '-' + generateUniqueId()

    // Add message to history
    this._addMessageToHistory(message)

    // Send via BroadcastChannel for other tabs
    this._bcChannel.postMessage(message)

    // Update awareness state with the message
    const awareness = this.provider.awareness
    const localState = awareness.getLocalState() || {}
    awareness.setLocalState({
      ...localState,
      [CUSTOM_MESSAGE_FIELD]: message,
    })
  }

  /**
   * Adds a message to the history and maintains the message limit.
   * @param {any} message - The message to add.
   */
  _addMessageToHistory(message: any) {
    this._messageHistory.push(message)
    if (this._messageHistory.length > MAX_MESSAGES) {
      this._messageHistory.shift() // Remove the oldest message
    }
  }

  /**
   * Gets the message history.
   * @returns {any[]} - The array of messages.
   */
  getMessageHistory() {
    return this._messageHistory
  }

  /**
   * Register a callback to handle incoming custom messages.
   * @param {function({topic: string, body: any, userid: string}): void} callback
   */
  onMessage(callback) {
    this._messageListener = callback

    // Listen for awareness updates
    this.provider.awareness.on(
      'update',
      ({ added, updated, removed }, origin) => {
        // Process updates only if they originate from a remote client
        if (origin !== this.provider) {
          const states = this.provider.awareness.getStates()
          states.forEach((state, clientID) => {
            if (clientID !== this.doc.clientID && state[CUSTOM_MESSAGE_FIELD]) {
              const message = state[CUSTOM_MESSAGE_FIELD]

              if (this._isDuplicateMessage(message)) return

              // Add message to history
              this._addMessageToHistory(message)

              if (this._messageListener) {
                this._messageListener(message)
              }

              // Clear the custom message field after processing
              const awareness = this.provider.awareness
              const localState = awareness.getLocalState() || {}
              awareness.setLocalState({
                ...localState,
                [CUSTOM_MESSAGE_FIELD]: null,
              })
            }
          })
        }
      }
    )
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
