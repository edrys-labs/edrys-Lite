/**
 * Simple WebRTC streaming using simple-peer
 */

import Peer from 'simple-peer'

// Global session management to prevent conflicts
const activeServerSessions = new Map<string, string>()

// Stream Server (Station)
export class StreamServer {
  private context: any
  private stream: MediaStream
  private peers: Map<string, any> = new Map() // clientId -> peer
  private sessionId: string
  private rtcConfig: RTCConfiguration

  constructor(context: any, stream: MediaStream, rtcConfig: RTCConfiguration) {
    this.context = context
    this.stream = stream
    this.rtcConfig = rtcConfig
    
    // Check if there's already an active session for this user
    const existingSessionId = activeServerSessions.get(this.context.username)
    if (existingSessionId) {
      this.sessionId = existingSessionId
    } else {
      this.sessionId = Date.now().toString()
      activeServerSessions.set(this.context.username, this.sessionId)
    }
    
    this.context.onMessage(({ subject, body, from }: any) => {
      if (subject === 'stream-request') {
        if (!this.peers.has(from) || this.peers.get(from).destroyed) {
          this.broadcastAvailability(from)
          this.startConnection(from)
        }
      }
      if (subject === 'stream-signal' && body.sessionId === this.sessionId) {
        this.handleSignal(from, body.signal)
      }
    })

    this.broadcastAvailability()
  }

  private broadcastAvailability(specific?: string) {
    const message = {
      sessionId: this.sessionId,
      peerId: this.context.username
    }
    
    if (specific) {
      this.context.sendMessage('stream-available', message, specific)
    } else {
      this.context.sendMessage('stream-available', message)
    }
  }

  private startConnection(clientId: string) {
    if (this.peers.has(clientId)) {
      const existingPeer = this.peers.get(clientId)
      if (!existingPeer.destroyed) {
        return
      }
      existingPeer.destroy()
      this.peers.delete(clientId)
    }

    const peer = new Peer({ 
      initiator: true,
      stream: this.stream,
      trickle: false,
      config: this.rtcConfig
    })

    this.peers.set(clientId, peer)

    peer.on('signal', (data) => {
      this.context.sendMessage('stream-signal', {
        signal: data,
        sessionId: this.sessionId
      }, clientId)
    })

    peer.on('connect', () => {
      console.log('Server peer connected to', clientId)
    })

    peer.on('error', (err) => {
      console.error('Server peer error for', clientId, ':', err)
      this.peers.delete(clientId)
    })

    peer.on('close', () => {
      this.peers.delete(clientId)
    })
  }

  private handleSignal(clientId: string, signal: any) {
    const peer = this.peers.get(clientId)
    if (peer && !peer.destroyed) {
      try {
        peer.signal(signal)
      } catch (err) {
        console.error('Error processing signal for', clientId, ':', err)
        peer.destroy()
        this.peers.delete(clientId)
      }
    }
  }

  public stop() {
    this.peers.forEach(peer => peer.destroy())
    this.peers.clear()
    activeServerSessions.delete(this.context.username)
  }
}

// Stream Client (Student/Teacher)
export class StreamClient {
  private context: any
  private handler: (stream: MediaStream, settings: any) => void
  private peer: any = null
  private sessionId: string = ''
  private hasRequestedStream: boolean = false
  private rtcConfig: RTCConfiguration
  private peerReady: boolean = false
  private processingOffer: boolean = false

  constructor(
    context: any, 
    handler: (stream: MediaStream, settings: any) => void,
    rtcConfig: RTCConfiguration
    ) {
        this.context = context
        this.handler = handler
        this.rtcConfig = rtcConfig
        
        this.context.onMessage(({ subject, body }: any) => {
        if (subject === 'stream-available') {
            if (!this.hasRequestedStream && !this.sessionId) {
                this.sessionId = body.sessionId
                this.hasRequestedStream = true
                // Small delay to ensure proper initialization
                setTimeout(() => this.createPeer(), 100)
            }
        }
        if (subject === 'stream-signal' && body.sessionId === this.sessionId) {
            this.handleSignal(body.signal)
        }
        })

        this.context.sendMessage('stream-request')
  }

  private createPeer() {
    if (this.peer) {
      this.peer.destroy()
    }

    this.peerReady = false
    this.processingOffer = false

    this.peer = new Peer({ 
      initiator: false,
      trickle: false,
      config: this.rtcConfig
    })

    this.peer.on('signal', (data) => {
      this.context.sendMessage('stream-signal', {
        signal: data,
        sessionId: this.sessionId
      })
    })

    this.peer.on('connect', () => {
      console.log('Client connected to stream')
    })

    this.peer.on('stream', (stream) => {
      this.handler(stream, this.context.module.stationConfig || {})
    })

    this.peer.on('error', (err) => {
      console.error('Client peer error:', err)
      this.peer = null
      this.peerReady = false
      this.processingOffer = false
      this.hasRequestedStream = false
      this.sessionId = ''
      
      setTimeout(() => {
        this.context.sendMessage('stream-request')
      }, 3000)
    })

    this.peer.on('close', () => {
      this.peerReady = false
      this.processingOffer = false
      this.hasRequestedStream = false
      this.sessionId = ''
    })

    // Mark peer as ready after a short delay
    setTimeout(() => {
      this.peerReady = true
    }, 200)
  }

  private handleSignal(signal: any) {
    if (this.peer && !this.peer.destroyed && this.peerReady) {
      try {
        // Don't process answer signals (clients send answers, don't receive them)
        if (signal.type === 'answer') {
          return
        }
        
        // Prevent duplicate offer processing
        if (signal.type === 'offer') {
          if (this.processingOffer) {
            console.log('Already processing an offer, ignoring duplicate')
            return
          }
          this.processingOffer = true
        }
        
        this.peer.signal(signal)
        
        // Reset processing flag when we successfully handle an answer (sent by us)
        if (signal.type === 'offer') {
          // The peer will automatically create and send an answer
          setTimeout(() => {
            this.processingOffer = false
          }, 1000)
        }
        
      } catch (err) {
        console.error('Error processing signal:', err)
        this.processingOffer = false
      }
    } else if (!this.peerReady) {
      console.log('Peer not ready yet, signal will be ignored')
    }
  }

  public stop() {
    if (this.peer) {
      this.peer.destroy()
      this.peer = null
    }
  }
}