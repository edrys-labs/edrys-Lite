/**
 * Simple WebRTC streaming using PeerJS
 */

import { Peer } from 'peerjs'

// Stream Server (Station)
export class StreamServer {
  private context: any
  private stream: MediaStream
  private peer: Peer
  private connections: Map<string, any> = new Map() // peerId -> connection

  constructor(context: any, stream: MediaStream, rtcConfig: RTCConfiguration) {
    this.context = context
    this.stream = stream
    
    const peerId = this.getServerID()
    this.peer = new Peer(peerId, {
      config: rtcConfig
    })

    this.setupPeerEvents()
  }

  private getServerID(): string {
    return btoa(this.context.class_id + this.context.liveUser.room)
  }

  private setupPeerEvents() {
    this.peer.on('open', (id) => {
      console.log('Stream server peer opened with ID:', id)
    })

    this.peer.on('connection', (conn) => {
      console.log('Incoming connection from:', conn.peer)
      this.connections.set(conn.peer, conn)
      
      if (this.stream) {
        this.peer.call(conn.peer, this.stream)
        console.log('Calling client with stream:', conn.peer)
      }
      
      conn.on('close', () => {
        console.log('Connection closed from:', conn.peer)
        this.connections.delete(conn.peer)
      })

      conn.on('error', (err) => {
        console.error('Connection error from', conn.peer, ':', err)
        this.connections.delete(conn.peer)
      })
    })

    this.peer.on('error', (err) => {
      console.error('Server peer error:', err)
    })

    this.peer.on('disconnected', () => {
      console.log('Server peer disconnected, attempting to reconnect...')
      if (!this.peer.destroyed) {
        this.peer.reconnect()
      }
    })
  }

  public getServerId(): string {
    return this.getServerID()
  }

  public stop() {
    // Close all active connections
    this.connections.forEach(connection => {
      if (connection && connection.close) {
        connection.close()
      }
    })
    this.connections.clear()

    // Close the peer connection
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy()
    }
  }
}

// Stream Client (Student/Teacher)
export class StreamClient {
  private context: any
  private handler: (stream: MediaStream, settings: any) => void
  private peer: Peer
  private connection: any = null
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 3
  private reconnectTimer: NodeJS.Timeout | null = null

  constructor(
    context: any, 
    handler: (stream: MediaStream, settings: any) => void,
    rtcConfig: RTCConfiguration
  ) {
    this.context = context
    this.handler = handler
    
    this.peer = new Peer({
      config: rtcConfig
    })

    this.setupPeerEvents()
  }

  private getServerID(): string {
    return btoa(this.context.class_id + this.context.liveUser.room)
  }

  private setupPeerEvents() {
    this.peer.on('open', (id) => {
      console.log('Client peer opened with ID:', id)
      this.connectToServer()
    })

    this.peer.on('call', (call) => {
      console.log('Incoming call from server')
      
      call.answer()

      call.on('stream', (remoteStream) => {
        console.log('Received stream from server')
        this.reconnectAttempts = 0 // Reset on successful connection
        this.handler(remoteStream, this.context.module.stationConfig || {})
      })

      call.on('close', () => {
        console.log('Call closed by server')
        this.scheduleReconnect()
      })

      call.on('error', (err) => {
        console.error('Call error:', err)
        this.handleConnectionFailure()
      })
    })

    this.peer.on('error', (err) => {
      console.error('Client peer error:', err)
      
      // Handle specific error types
      if (err.type === 'peer-unavailable') {
        this.handleConnectionFailure()
      } else if (err.type === 'network') {
        this.handleNetworkError()
      }
    })

    this.peer.on('disconnected', () => {
      console.log('Client peer disconnected')
      this.scheduleReconnect()
      
      // Attempt to reconnect peer
      setTimeout(() => {
        if (!this.peer.destroyed) {
          this.peer.reconnect()
        }
      }, 1000)
    })
  }

  private connectToServer() {
    const serverPeerId = this.getServerID()
    
    if (!serverPeerId) {
      console.log('Server peer ID not available, retrying...')
      this.scheduleReconnect()
      return
    }

    if (this.connection) {
      this.connection.close()
      this.connection = null
    }

    console.log('Connecting to server peer:', serverPeerId)
    
    this.connection = this.peer.connect(serverPeerId)

    if (!this.connection) {
      console.error('Failed to create connection')
      this.handleConnectionFailure()
      return
    }

    this.connection.on('open', () => {
      console.log('Data connection established with server')
    })

    this.connection.on('close', () => {
      console.log('Data connection closed by server')
      this.connection = null
      this.scheduleReconnect()
    })

    this.connection.on('error', (err: any) => {
      console.error('Data connection error:', err)
      this.connection = null
      this.handleConnectionFailure()
    })
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    
    this.reconnectTimer = setTimeout(() => {
      if (!this.peer.destroyed) {
        this.connectToServer()
      }
    }, 2000)
  }

  private handleConnectionFailure() {
    this.reconnectAttempts++

    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      const delay = Math.pow(2, this.reconnectAttempts) * 1000 // Exponential backoff
      console.log(`Retrying connection in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)
      
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
      }
      
      this.reconnectTimer = setTimeout(() => {
        if (!this.peer.destroyed) {
          this.connectToServer()
        }
      }, delay)
    } else {
      console.error('Max reconnection attempts reached')
    }
  }

  private handleNetworkError() {
    console.log('Network error detected, will retry when network is available')
    
    // Wait longer for network issues
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }
    
    this.reconnectTimer = setTimeout(() => {
      if (!this.peer.destroyed) {
        this.reconnectAttempts = 0 // Reset attempts for network errors
        this.connectToServer()
      }
    }, 5000)
  }

  public reconnect() {
    this.reconnectAttempts = 0
    this.connectToServer()
  }

  public stop() {
    // Clear any pending reconnect timers
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Close the data connection
    if (this.connection && this.connection.close) {
      this.connection.close()
      this.connection = null
    }

    // Destroy the peer
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy()
    }
  }
}