/**
 * streamhandler.ts
 *
 * Enhanced WebRTC streaming functionality for Edrys with:
 * - Improved ICE candidate handling
 * - Exponential backoff for reconnection
 * - Proper session management and heartbeat/keep-alive mechanism
 */

async function addPendingIceCandidates(
  peerConnection: RTCPeerConnection,
  pendingCandidates: any[]
): Promise<any[]> {
  while (!peerConnection.remoteDescription) {
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (pendingCandidates.length > 0) {
    try {
      await Promise.all(
        pendingCandidates.map((candidate) =>
          peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        )
      )
      pendingCandidates = []
    } catch (error) {
      console.error('Error adding pending ICE candidates:', error)
    }
  }
  return pendingCandidates
}

async function handleIceCandidate(
  peerConnection: RTCPeerConnection,
  candidate: any,
  pendingCandidates: any[]
): Promise<any[]> {
  if (!peerConnection) return pendingCandidates
  try {
    if (peerConnection.remoteDescription) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
    } else {
      pendingCandidates.push(candidate)
    }
  } catch (e) {
    console.log('ICE candidate error:', e)
  }
  return pendingCandidates
}

// Global Map for managing stream sessions
const streamSessions = new Map<string, StreamServer>()

export class StreamServer {
  private context: any
  private stream: MediaStream
  private pendingCandidates = new Map<string, any[]>()
  private peerConnections = new Map<string, RTCPeerConnection>()
  private sessionId: string
  private rtcConfig: RTCConfiguration

  // Session management and heartbeat properties
  private lastActivity: number
  private sessionTimeout: number = 10 * 60 * 1000 // 10 minutes
  private sessionTimeoutTimer: number
  private heartbeatTimer: number

  constructor(context: any, stream: MediaStream, rtcConfig: RTCConfiguration) {
    this.context = context
    this.stream = stream
    this.rtcConfig = rtcConfig
    this.sessionId = Date.now().toString()
    streamSessions.set(this.sessionId, this)

    this.lastActivity = Date.now()
    // Check session activity every minute
    this.sessionTimeoutTimer = window.setInterval(
      () => this.checkSessionTimeout(),
      60000
    )
    // Start heartbeat monitoring (e.g. expect a heartbeat every 5 seconds)
    this.heartbeatTimer = window.setInterval(() => this.checkHeartbeat(), 5000)

    this.setupMessageHandlers()
  }

  private updateActivity() {
    this.lastActivity = Date.now()
  }

  private checkSessionTimeout() {
    if (Date.now() - this.lastActivity > this.sessionTimeout) {
      console.log(`Session ${this.sessionId} timed out due to inactivity.`)
      this.stop()
    }
  }

  // In this example, the server does not actively send heartbeats,
  // but it updates the lastActivity timestamp when a heartbeat is received.
  private checkHeartbeat() {
    // Hier könnte man weitere Logik einbauen, z.B. prüfen, ob einzelne Clients
    // über längere Zeit keinen Heartbeat geschickt haben.
  }

  private setupMessageHandlers() {
    this.context.onMessage(({ subject, from, body }: any) => {
      if (subject === 'requestStream') {
        this.updateActivity()
        this.broadcastStreamInfo(from)
      } else if (subject === 'heartbeat') {
        // Beim Empfang eines Heartbeat wird die Aktivität aktualisiert
        this.updateActivity()
        // Optional: Eine Antwort senden, um den Client zu bestätigen
        this.context.sendMessage('heartbeatAck', { sessionId: this.sessionId })
      }
    })

    this.context.onMessage(async ({ subject, body, from }: any) => {
      if (
        subject === 'webrtc-signal' &&
        body.targetPeerId === this.context.username
      ) {
        if (body.sessionId === this.sessionId || !body.sessionId) {
          this.updateActivity()
          this.handleSignaling(from, body)
        }
      }
    })

    setTimeout(() => {
      this.updateActivity()
      this.broadcastStreamInfo()
    }, 500)
  }

  private broadcastStreamInfo(specific: string | null = null) {
    const message = {
      roomId: this.context.class_id,
      peerId: this.context.username,
      sessionId: this.sessionId,
      settings: {
        mirrorX: this.context.module.stationConfig?.mirrorX ?? false,
        mirrorY: this.context.module.stationConfig?.mirrorY ?? false,
        rotate: this.context.module.stationConfig?.rotate ?? 0,
      },
      stream: {
        id: this.stream.id,
        tracks: this.stream.getTracks().map((track) => ({
          kind: track.kind,
          enabled: track.enabled,
        })),
      },
    }

    if (specific) {
      this.context.sendMessage('streamCredentials', message, specific)
    } else {
      this.context.sendMessage('streamCredentials', message)
    }
  }

  private async handleSignaling(from: string, body: any) {
    let peerConnection = this.peerConnections.get(from)

    try {
      if (body.type === 'offer') {
        peerConnection = this.createNewPeerConnection(from)

        await peerConnection
          .setRemoteDescription(new RTCSessionDescription(body.sdp))
          .catch((err) => {
            console.error(`Error setting remote description: ${err}`)
            throw err
          })

        this.pendingCandidates.set(
          from,
          await addPendingIceCandidates(
            peerConnection,
            this.pendingCandidates.get(from) || []
          )
        )

        const answer = await peerConnection.createAnswer().catch((err) => {
          console.error(`Error creating answer: ${err}`)
          throw err
        })

        await peerConnection.setLocalDescription(answer).catch((err) => {
          console.error(`Error setting local description: ${err}`)
          throw err
        })

        this.context.sendMessage('webrtc-signal', {
          type: 'answer',
          sdp: answer,
          sessionId: this.sessionId,
          targetPeerId: from,
          fromPeerId: this.context.username,
        })
      } else if (body.type === 'ice-candidate') {
        if (!peerConnection) {
          peerConnection = this.createNewPeerConnection(from)
        }
        if (!this.pendingCandidates.has(from)) {
          this.pendingCandidates.set(from, [])
        }
        this.pendingCandidates.set(
          from,
          await handleIceCandidate(
            peerConnection,
            body.candidate,
            this.pendingCandidates.get(from) || []
          )
        )
      }
    } catch (err) {
      console.error(`Error in server signal handling for peer ${from}:`, err)
      this.context.sendMessage('webrtc-signal', {
        type: 'reconnect',
        sessionId: this.sessionId,
        targetPeerId: from,
        fromPeerId: this.context.username,
      })
    }
  }

  private createNewPeerConnection(peerId: string): RTCPeerConnection {
    if (this.peerConnections.has(peerId)) {
      const oldConnection = this.peerConnections.get(peerId)
      if (oldConnection) {
        try {
          oldConnection.close()
        } catch (e) {
          console.warn(`Error closing old connection: ${e}`)
        }
      }
    }
    const peerConnection = new RTCPeerConnection(this.rtcConfig)
    this.peerConnections.set(peerId, peerConnection)
    this.pendingCandidates.set(peerId, [])

    this.stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, this.stream)
    })

    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.context.sendMessage('webrtc-signal', {
          type: 'ice-candidate',
          candidate: event.candidate,
          sessionId: this.sessionId,
          targetPeerId: peerId,
          fromPeerId: this.context.username,
        })
      }
    }

    peerConnection.oniceconnectionstatechange = () => {
      if (
        peerConnection.iceConnectionState === 'failed' ||
        peerConnection.iceConnectionState === 'disconnected'
      ) {
        // Statt sofortigem Reconnect kann man hier zunächst abwarten
        // und den Heartbeat abwarten, um sicherzustellen, dass die Verbindung wirklich tot ist.
        peerConnection.restartIce()
        if (peerConnection.iceConnectionState === 'disconnected') {
          this.context.sendMessage('webrtc-signal', {
            type: 'reconnect',
            sessionId: this.sessionId,
            targetPeerId: peerId,
            fromPeerId: this.context.username,
          })
        }
      }
    }

    peerConnection.onsignalingstatechange = () => {
      // Optional: Logging des Signaling-Zustands
    }

    peerConnection.onconnectionstatechange = () => {
      if (
        peerConnection.connectionState === 'failed' ||
        peerConnection.connectionState === 'disconnected'
      ) {
        this.context.sendMessage('webrtc-signal', {
          type: 'reconnect',
          sessionId: this.sessionId,
          targetPeerId: peerId,
          fromPeerId: this.context.username,
        })
      }
    }

    return peerConnection
  }

  public stop() {
    this.peerConnections.forEach((conn, peerId) => {
      try {
        conn.close()
      } catch (e) {
        console.warn(`Error closing connection: ${e}`)
      }
    })
    this.peerConnections.clear()
    this.pendingCandidates.clear()

    this.context.sendMessage('streamStopped', {
      peerId: this.context.username,
      sessionId: this.sessionId,
    })

    clearInterval(this.sessionTimeoutTimer)
    clearInterval(this.heartbeatTimer)
    streamSessions.delete(this.sessionId)
  }
}

export class StreamClient {
  private context: any
  private handler: (stream: MediaStream, settings: any) => void
  private peerConnection: RTCPeerConnection | null = null
  private pendingIceCandidates: any[] = []
  private sessionId: string | undefined
  private peerId: string | undefined
  private reconnectTimer: number | undefined
  private reconnectAttempts: number = 0
  private rtcConfig: RTCConfiguration
  private heartbeatTimer: number | undefined
  private heartbeatInterval: number = 5000 // 5 seconds

  constructor(
    context: any,
    handler: (stream: MediaStream, settings: any) => void,
    rtcConfig: RTCConfiguration
  ) {
    this.context = context
    this.handler = handler
    this.rtcConfig = rtcConfig

    this.setupMessageHandlers()
    this.requestStream()
    this.startHeartbeat()
  }

  private setupMessageHandlers() {
    this.context.onMessage(({ subject, body }: any) => {
      if (subject === 'streamCredentials') {
        this.sessionId = body.sessionId
        this.peerId = body.peerId
        this.connectToPeer(body)
      } else if (
        subject === 'streamStopped' &&
        body.peerId === this.peerId &&
        body.sessionId === this.sessionId
      ) {
        this.cleanupAndReconnect()
      } else if (
        subject === 'webrtc-signal' &&
        body.targetPeerId === this.context.username
      ) {
        if (body.sessionId === this.sessionId) {
          if (body.type === 'reconnect') {
            this.cleanupAndReconnect()
          } else {
            this.handleSignaling(body)
          }
        }
      } else if (subject === 'heartbeatAck') {
        // On receiving a heartbeat acknowledgment, we might reset some connection timers if needed.
      }
    })
  }

  // Heartbeat: send a keep-alive message at regular intervals.
  private startHeartbeat() {
    this.heartbeatTimer = window.setInterval(() => {
      this.context.sendMessage('heartbeat', {
        timestamp: Date.now(),
        sessionId: this.sessionId,
      })
    }, this.heartbeatInterval)
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private cleanupAndReconnect() {
    if (this.peerConnection) {
      try {
        this.peerConnection.close()
      } catch (e) {
        console.error('Error closing connection:', e)
      }
      this.peerConnection = null
    }
    this.pendingIceCandidates = []
    this.stopHeartbeat()

    this.reconnectAttempts++
    const delay = Math.min(2 ** this.reconnectAttempts * 1000, 30000)
    console.log(
      `Reconnecting in ${delay} ms (attempt ${this.reconnectAttempts})`
    )

    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = window.setTimeout(() => {
      this.requestStream()
      this.startHeartbeat()
    }, delay)
  }

  private resetReconnectAttempts() {
    this.reconnectAttempts = 0
  }

  private requestStream() {
    this.context.sendMessage('requestStream')
  }

  private handleSignaling(body: any) {
    if (!this.peerConnection) return

    try {
      if (body.type === 'answer') {
        if (this.peerConnection.signalingState === 'have-local-offer') {
          this.peerConnection
            .setRemoteDescription(new RTCSessionDescription(body.sdp))
            .then(() =>
              addPendingIceCandidates(
                this.peerConnection as RTCPeerConnection,
                this.pendingIceCandidates
              )
            )
            .then(() => {
              this.pendingIceCandidates = []
            })
            .catch((err) => {
              console.error('Error handling answer:', err)
            })
        }
      } else if (body.type === 'ice-candidate') {
        if (this.peerConnection.remoteDescription) {
          this.peerConnection
            .addIceCandidate(new RTCIceCandidate(body.candidate))
            .catch((e) => console.warn('Failed to add ICE candidate:', e))
        } else {
          this.pendingIceCandidates.push(body.candidate)
        }
      }
    } catch (err) {
      console.error('Client error handling signal:', err)
    }
  }

  private async connectToPeer({ roomId, peerId, settings, sessionId }: any) {
    if (this.peerConnection) {
      try {
        this.peerConnection.close()
      } catch (e) {
        console.error('Error closing existing connection:', e)
      }
      this.pendingIceCandidates = []
    }

    try {
      this.peerConnection = new RTCPeerConnection(this.rtcConfig)
      this.setupConnectionStateHandlers(settings)

      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      })
      await this.peerConnection.setLocalDescription(offer)

      this.context.sendMessage('webrtc-signal', {
        type: 'offer',
        sdp: offer,
        sessionId: sessionId,
        targetPeerId: peerId,
        fromPeerId: this.context.username,
      })

      this.resetReconnectAttempts()
    } catch (err) {
      console.error('Error in connectToPeer:', err)
      this.cleanupAndReconnect()
    }
  }

  private setupConnectionStateHandlers(settings: any) {
    const pc = this.peerConnection as RTCPeerConnection

    pc.onsignalingstatechange = () => {
      // Optional: Logging des Signaling-Zustands
    }

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === 'failed' ||
        pc.connectionState === 'disconnected'
      ) {
        this.cleanupAndReconnect()
      }
    }

    pc.oniceconnectionstatechange = () => {
      if (
        pc.iceConnectionState === 'failed' ||
        pc.iceConnectionState === 'disconnected'
      ) {
        this.cleanupAndReconnect()
      }
    }

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.context.sendMessage('webrtc-signal', {
          type: 'ice-candidate',
          candidate: event.candidate,
          sessionId: this.sessionId,
          targetPeerId: this.peerId,
          fromPeerId: this.context.username,
        })
      }
    }

    pc.ontrack = (event) => {
      this.handler(event.streams[0], settings)
    }
  }

  public stop() {
    clearTimeout(this.reconnectTimer)
    this.stopHeartbeat()
    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
    }
  }
}
