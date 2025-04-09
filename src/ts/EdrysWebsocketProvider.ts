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
  private _processedMessageIds = new Set<string>() // Optimize duplicate detection
  private _cleanupInterval: number | null = null
  private _leaveListener: Function | null = null
  public userid: string
  private provider: WebsocketProvider
  private doc: Y.Doc
  private _messageHistory: any[] = [] // Array to store message history

  constructor(roomName: string, doc: Y.Doc, options: any) {
    this.doc = doc
    this.userid = options.userid || this.doc.clientID.toString()

    // Initialize Y-WebSocket provider with improved options
    this.provider = new WebsocketProvider(
      options.serverUrl || 'wss://demos.yjs.dev',
      roomName,
      this.doc,
      {
        connect: true,
        params: { userid: this.userid },
        // Reduce awareness sync interval from default 30s

        resyncInterval: 5000, // How often to resync state (ms)
        maxBackoffTime: 2000, // Max reconnection delay (ms)
      }
    )

    // Immediately set basic awareness to trigger presence detection
    this._initializeAwareness()

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
        //this._sendOwnId() // No longer needed
      }
    })
  }

  // New method to immediately set awareness
  private _initializeAwareness() {
    const awareness = this.provider.awareness
    const localState = awareness.getLocalState() || {}

    // Set minimum required state to make client visible immediately
    awareness.setLocalState({
      ...localState,
      user: {
        id: this.userid,
        name: this.userid,
      },
    })
  }

  _bcChannelListener(event: MessageEvent): void {
    const message = event.data
    // Only process messages that have an ID
    if (!message || !message.id) return

    if (this._isDuplicateMessage(message)) return

    // Add message to history before processing
    this._addMessageToHistory(message)

    if (this._messageListener) {
      this._messageListener(message)
    }
  }

  _isDuplicateMessage(message: any): boolean {
    if (!message || !message.id) {
      return false
    }

    // Faster lookup with Set
    if (this._processedMessageIds.has(message.id)) {
      return true
    }

    // Store only ID, not timestamp for better memory usage
    this._processedMessageIds.add(message.id)
    return false
  }

  _cleanupProcessedMessages() {
    // If size exceeds threshold, clear half of the oldest messages
    // This avoids iterating through the entire set every cleanup cycle
    if (this._processedMessageIds.size > 1000) {
      const idsToKeep = Array.from(this._processedMessageIds).slice(-500)
      this._processedMessageIds = new Set(idsToKeep)
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
  onMessage(callback: Function): void {
    this._messageListener = callback

    // More efficient awareness update handling
    this.provider.awareness.on('update', ({ added, updated }) => {
      if (added.length === 0 && updated.length === 0) return

      const states = this.provider.awareness.getStates()
      // Only process clients that were just added or updated
      const changedClients = [...added, ...updated]

      for (const clientID of changedClients) {
        // Skip our own client
        if (clientID === this.doc.clientID) continue

        const state = states.get(clientID)
        if (
          !state ||
          !state[CUSTOM_MESSAGE_FIELD] ||
          !state[CUSTOM_MESSAGE_FIELD].id
        )
          continue

        const message = state[CUSTOM_MESSAGE_FIELD]
        if (this._isDuplicateMessage(message)) continue

        this._addMessageToHistory(message)

        if (this._messageListener) {
          this._messageListener(message)
        }
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

    this._processedMessageIds.clear()
  }
}
