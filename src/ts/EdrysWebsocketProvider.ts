import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { encoding, decoding } from 'lib0'
import { debug } from '../api/debugHandler'

const MESSAGE_TYPE_CUSTOM = 42
const MESSAGE_TYPE_ID = 43
const MESSAGE_EXPIRATION_TIME = 10000 // 10 seconds
const MAX_MESSAGES = 50
const CUSTOM_MESSAGE_FIELD = 'customMessage'
const HEARTBEAT_INTERVAL = 5000 // 5 seconds for heartbeat
const PEER_TIMEOUT = 15000 // 15 seconds to consider a peer disconnected

function generateUniqueId() {
  return Math.random().toString(36).substr(2, 9) + Date.now().toString(36)
}

export class EdrysWebsocketProvider {
  private _messageListener: Function | null = null
  private _bcChannel: BroadcastChannel
  private _processedMessages: Map<string, number>
  private _cleanupInterval: number | null = null
  private _heartbeatInterval: number | null = null
  private _leaveListener: Function | null = null
  private _syncedListener: Function | null = null 
  private _statusListener: Function | null = null 
  private _lastHeartbeats: Map<string, number> = new Map() // Track last heartbeat time for each user
  public userid: string
  private provider: WebsocketProvider
  private doc: Y.Doc
  private _messageHistory: any[] = [] // Array to store message history
  private _hasBeenConnected: boolean = false // Track if we've ever been connected
  private _connectedUsers: Set<string> = new Set() // Track connected users

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

    // Start heartbeat mechanism
    this._heartbeatInterval = window.setInterval(
      () => this._sendHeartbeat(),
      HEARTBEAT_INTERVAL
    )

    // Initialize BroadcastChannel for tab communication
    this._bcChannel = new BroadcastChannel(`custom-ws-provider-${roomName}`)

    // Listen for BroadcastChannel messages
    this._bcChannelListener = this._bcChannelListener.bind(this)
    this._bcChannel.addEventListener('message', this._bcChannelListener)

    // Handle provider connection status
    this.provider.on('status', (event: { status: string }) => {
      debug.ts.edrysWebsocketProvider(`Y-WebSocket status: ${event.status}`)

      // Forward status event to listeners
      if (this._statusListener) {
        this._statusListener(event)
      }

      if (event.status === 'connected') {
        this._hasBeenConnected = true

        // Trigger synced event after connected 
        setTimeout(() => {
          if (this._syncedListener) {
            this._syncedListener({ synced: true })
          }
        }, 1000)
      }
    })

    this.provider.on('sync', (isSynced: boolean) => {
      if (isSynced && this._hasBeenConnected) {
        if (this._syncedListener) {
          this._syncedListener({ synced: true })
        }
      }
    })

    // Dedicated handler for custom messages to avoid processing the same message multiple times
    let lastMessageProcessed: string | null = null;

    this.provider.awareness.on('update', ({ added, updated, removed }) => {
      added.forEach(clientId => {
        const state = this.provider.awareness.getStates().get(clientId)
        if (state && state.user && state.user.id !== this.userid) {
          this._connectedUsers.add(state.user.id)
          this._lastHeartbeats.set(state.user.id, Date.now())
        }
      })

      // Process updates to detect heartbeats and custom messages
      updated.forEach(clientId => {
        const state = this.provider.awareness.getStates().get(clientId)
        if (state) {
          // Track heartbeat for this user
          if (state.user && state.user.id !== this.userid) {
            this._lastHeartbeats.set(state.user.id, Date.now())
            this._connectedUsers.add(state.user.id)
          }

          // Process custom message if present and not from this client
          if (state[CUSTOM_MESSAGE_FIELD] && 
              state.user && 
              state.user.id !== this.userid) {
            const message = state[CUSTOM_MESSAGE_FIELD]
            
            // Skip if we've already processed this message or if it's a duplicate
            if (message.id && 
                message.id !== lastMessageProcessed && 
                !this._isDuplicateMessage(message)) {
              
              lastMessageProcessed = message.id;
              this._addMessageToHistory(message)
              
              if (this._messageListener) {
                this._messageListener(message)
              }
            }
          }
        }
      })

      // Handle removed users
      removed.forEach(clientId => {
        const states = this.provider.awareness.getStates()
        if (!states.has(clientId)) {
          // Find the user ID if it exists in our tracking
          const userIdToRemove = Array.from(this._lastHeartbeats.keys()).find(
            userId => {
              // Try to find the user ID associated with this client ID
              // This is approximate since we don't have a direct clientId -> userId mapping
              const matchingState = Array.from(states.entries()).find(
                ([otherClientId, state]) => 
                  state.user && state.user.id === userId
              )
              return !matchingState // If no state with this userId exists, it might be the one to remove
            }
          )

          if (userIdToRemove) {
            this._lastHeartbeats.delete(userIdToRemove)
            this._connectedUsers.delete(userIdToRemove)
            
            // Notify about user leaving
            if (this._leaveListener) {
              this._leaveListener(userIdToRemove)
            }
          }
        }
      })
    })

    // Set up disconnect detection through heartbeats
    setInterval(() => this._checkHeartbeats(), PEER_TIMEOUT / 2)
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
            this._syncedListener({ synced: true })
          }
        }, 500)
      }
    }
  }

  /**
   * Sends a heartbeat to let other peers know we're still connected
   */
  _sendHeartbeat() {
    const awareness = this.provider.awareness
    const localState = awareness.getLocalState() || {}
    
    // Update our state with current timestamp for heartbeat
    awareness.setLocalState({
      ...localState,
      user: {
        ...(localState.user || {}),
        id: this.userid,
        heartbeat: Date.now()
      }
    })
  }

  /**
   * Checks for peers that haven't sent a heartbeat recently and considers them disconnected
   */
  _checkHeartbeats() {
    const now = Date.now()
    const disconnectedUsers: string[] = []
    
    this._lastHeartbeats.forEach((lastTime, userId) => {
      if (now - lastTime > PEER_TIMEOUT) {
        disconnectedUsers.push(userId)
      }
    })
    
    // Process disconnected users
    disconnectedUsers.forEach(userId => {
      this._lastHeartbeats.delete(userId)
      this._connectedUsers.delete(userId)
      
      // Notify about user leaving
      if (this._leaveListener && userId !== this.userid) {
        this._leaveListener(userId)
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
    
    // Check message history for duplicates
    for (const historyMsg of this._messageHistory) {
      if (historyMsg.id === message.id) {
        return true
      }
    }
    
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
    if (!message.id) {
      message.id = Date.now().toString() + '-' + generateUniqueId()
    }

    if (!message.sender) {
      message.sender = this.userid
    }

    this._addMessageToHistory(message)

    this._bcChannel.postMessage(message)

    const awareness = this.provider.awareness
    const localState = awareness.getLocalState() || {}
    
    awareness.setLocalState({
      ...localState,
      user: {
        ...(localState.user || {}),
        id: this.userid,
      },
      [CUSTOM_MESSAGE_FIELD]: message,
    })

    // Remove the message from awareness after a short delay
    // This prevents the message from being resent on future awareness updates
    setTimeout(() => {
      const currentState = awareness.getLocalState() || {}
      if (currentState[CUSTOM_MESSAGE_FIELD]?.id === message.id) {
        awareness.setLocalState({
          ...currentState,
          [CUSTOM_MESSAGE_FIELD]: null,
        })
      }
    }, 1000)
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

    if (this._heartbeatInterval) {
      clearInterval(this._heartbeatInterval)
      this._heartbeatInterval = null
    }

    this._processedMessages.clear()
    this._lastHeartbeats.clear()
    this._connectedUsers.clear()
    this._messageHistory = []
  }
}
