/**
 * streamhandler.ts
 *
 * WebRTC and WebSocket streaming functionality for Edrys with:
 * - WebRTC streaming using PeerJS
 * - Reconnection logic
 * - Support for both WebRTC and WebSocket streaming methods
*/

import { debug } from './debugHandler'
import { Peer } from 'peerjs'

function generateStreamPeerID(context: any, streamName: string): string {
  const baseId = `${context.class_id}_${context.liveUser.room}_${streamName}`
  const cleanId = baseId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `stream_${cleanId}`.substring(0, 50)
}

// Namespaced handshake subjects (won't collide with module messages).
const STREAM_READY = '__edrys_stream_ready'
const STREAM_REQUEST = '__edrys_stream_request'

// Helper to build PeerJS options from config
function getPeerOptions(rtcConfig: RTCConfiguration, peerServerConfig?: any) {
  const baseOptions: any = { config: rtcConfig }
  
  // If custom peer server config is provided, use it
  if (peerServerConfig?.host) {
    baseOptions.host = peerServerConfig.host
    baseOptions.port = peerServerConfig.port || 443
    baseOptions.path = peerServerConfig.path || '/'
    baseOptions.secure = peerServerConfig.secure !== undefined ? peerServerConfig.secure : true
  }
  // Otherwise, PeerJS will use its default cloud service
  
  return baseOptions
}

// Stream Server (Station)
export class StreamServer {
  private context: any
  private stream: MediaStream
  private peer: Peer
  private streamName: string
  private connectedClients: Set<string> = new Set()

  constructor(
    context: any, 
    stream: MediaStream, 
    rtcConfig: RTCConfiguration, 
    streamName?: string, 
    peerServerConfig?: any
  ) {
    this.context = context
    this.stream = stream
    this.streamName = streamName || `${this.context.username}-stream`
    
    const peerId = generateStreamPeerID(context, this.streamName)
    const peerOptions = getPeerOptions(rtcConfig, peerServerConfig)
    this.peer = new Peer(peerId, peerOptions)
    this.setupPeerEvents()
  }

  private setupPeerEvents() {
    this.peer.on('open', () => {
      // Announce readiness so clients can connect without guessing timers.
      this.announceReady()
    })

    // Re-announce when a client asks for this stream (handles late joiners).
    this.context.onMessage(({ subject, body }: any) => {
      if (subject === STREAM_REQUEST && body?.streamName === this.streamName) {
        this.announceReady()
      }
    })

    this.peer.on('connection', (conn) => {
      this.connectedClients.add(conn.peer)
      this.callClient(conn.peer)

      conn.on('close', () => {
        this.connectedClients.delete(conn.peer)
      })

      conn.on('error', (err: any) => {
        debug.api.general('StreamServer connection error:', err?.type || err)
        this.connectedClients.delete(conn.peer)
      })
    })

    this.peer.on('error', (err: any) => {
      debug.api.general('StreamServer peer error:', err?.type || err)
    })

    this.peer.on('disconnected', () => {
      if (!this.peer.destroyed) {
        this.peer.reconnect()
      }
    })
  }

  private announceReady() {
    this.context.sendMessage(STREAM_READY, { streamName: this.streamName })
  }

  private callClient(clientPeerId: string) {
    if (this.stream) {
      const call = this.peer.call(clientPeerId, this.stream)
      
      if (!call) {
        this.connectedClients.delete(clientPeerId)
        return
      }
      
      call.on('error', (err: any) => {
        debug.api.general('StreamServer call error:', err?.type || err)
        this.connectedClients.delete(clientPeerId)
      })
    }
  }

  public updateStream(newStream: MediaStream) {
    this.stream = newStream
    
    // Call all connected clients with the new stream
    this.connectedClients.forEach(clientPeerId => {
      this.callClient(clientPeerId)
    })
  }

  public stop() {
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy()
    }
  }
}

// Stream Client (Student/Teacher)
export class StreamClient {
  private context: any
  private handler: (stream: MediaStream, settings: any, metadata?: any) => void
  private peer: Peer
  private currentConnection: any = null
  private defaultStreamName?: string
  private reconnectAttempts: number = 0
  private maxReconnectAttempts: number = 3
  private reconnectDelay: number = 3000
  private isInitialConnection: boolean = true
  private connectionTimeout: any = null

  constructor(
    context: any, 
    handler: (stream: MediaStream, settings: any, metadata?: any) => void,
    rtcConfig: RTCConfiguration,
    defaultStreamName?: string,
    peerServerConfig?: any
  ) {
    this.context = context
    this.handler = handler
    this.defaultStreamName = defaultStreamName
    
    const peerOptions = getPeerOptions(rtcConfig, peerServerConfig)
    this.peer = new Peer(peerOptions)
    this.setupPeerEvents()
  }

  private setupPeerEvents() {
    this.peer.on('open', () => {
      // Connect when the server announces it's ready; also ping in case it's already live.
      this.context.onMessage(({ subject, body }: any) => {
        if (
          subject === STREAM_READY &&
          body?.streamName === this.defaultStreamName &&
          this.currentStreamName !== this.defaultStreamName
        ) {
          this.selectStream(this.defaultStreamName!)
        }
      })

      if (this.defaultStreamName) {
        this.context.sendMessage(STREAM_REQUEST, {
          streamName: this.defaultStreamName,
        })
      }
    })

    this.peer.on('call', (call) => {
      call.answer()

      call.on('stream', (remoteStream) => {
        const metadata = {
          streamName: this.currentStreamName || 'unknown',
          room: this.context.liveUser?.room
        }
        this.handler(remoteStream, this.context.module.stationConfig || {}, metadata)
      })
    })

    this.peer.on('error', (err) => {
      debug.api.general('StreamClient peer error:', err?.type || err)

      // Safety net only: if a connect attempt raced the server registration,
      // retry briefly. The handshake is the primary connection path.
      if (err.type === 'peer-unavailable' || err.message?.includes('Could not connect to peer')) {
        if (this.currentStreamName && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          this.connectionTimeout = setTimeout(() => {
            if (!this.peer.destroyed && this.currentStreamName) {
              this.selectStream(this.currentStreamName!)
            }
          }, this.reconnectDelay)
        }
      }
    })

    this.peer.on('disconnected', () => {
      if (!this.peer.destroyed) {
        this.peer.reconnect()
      }
    })
  }

  private currentStreamName?: string

  public selectStream(streamName: string) {
    // Clear any pending connection attempts
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }
    
    const streamPeerID = generateStreamPeerID(this.context, streamName)
    this.currentStreamName = streamName
    
    // Close existing connection if any
    if (this.currentConnection) {
      this.currentConnection.close()
      this.currentConnection = null
    }
    
    // Wait for peer to be ready or make connection immediately
    if (!this.peer.open) {
      this.peer.on('open', () => {
        this.makeConnection(streamPeerID)
      })
    } else {
      this.makeConnection(streamPeerID)
    }
  }

  private makeConnection(streamPeerID: string) {
    try {
      this.currentConnection = this.peer.connect(streamPeerID)
      
      if (!this.currentConnection) {
        this.handleConnectionFailure()
        return
      }
      
      this.currentConnection.on('open', () => {
        this.reconnectAttempts = 0
        this.isInitialConnection = false
      })

      this.currentConnection.on('close', () => {
        this.currentConnection = null
      })

      this.currentConnection.on('error', (err: any) => {
        debug.api.general('StreamClient connection error:', err?.type || err)
        this.currentConnection = null
        this.handleConnectionFailure()
      })

    } catch (error: any) {
      debug.api.general('StreamClient makeConnection error:', error?.message || error)
      this.handleConnectionFailure()
    }
  }

  private handleConnectionFailure() {
    if (this.currentStreamName && this.reconnectAttempts < this.maxReconnectAttempts) {
      const baseDelay = this.isInitialConnection ? this.reconnectDelay * 2 : this.reconnectDelay
      const delay = baseDelay * Math.pow(2, this.reconnectAttempts)
      this.reconnectAttempts++
      
      this.connectionTimeout = setTimeout(() => {
        if (!this.peer.destroyed && this.currentStreamName) {
          this.selectStream(this.currentStreamName)
        }
      }, delay)
    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.isInitialConnection = false
    }
  }

  public stop() {
    // Reset reconnection attempts when stopping
    this.reconnectAttempts = 0
    this.isInitialConnection = true // Reset for next connection
    
    // Clear any pending connection attempts
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout)
      this.connectionTimeout = null
    }
    
    if (this.currentConnection) {
      this.currentConnection.close()
      this.currentConnection = null
    }
    
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy()
    }
  }
}

// Run setInterval inside a tiny worker (Browsers throttle setInterval to ~1Hz in hidden tabs).
function createUnthrottledTicker(intervalMs: number, onTick: () => void): { stop: () => void } {
  try {
    const source = `setInterval(() => postMessage(0), ${intervalMs})`
    const url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }))
    const worker = new Worker(url)
    URL.revokeObjectURL(url)
    worker.onmessage = onTick
    return { stop: () => worker.terminate() }
  } catch (err: any) {
    // No workers available: fall back to a (background-throttled) main timer.
    debug.api.general('Worker ticker unavailable, using setInterval:', err?.message || err)
    const id = window.setInterval(onTick, intervalMs)
    return { stop: () => clearInterval(id) }
  }
}

const WS_FPS = 15
const WS_JPEG_QUALITY = 0.7

abstract class WebSocketStreamBase {
  protected context: any
  protected wsConnection: WebSocket | null = null
  protected canvas: HTMLCanvasElement
  protected ctx: CanvasRenderingContext2D
  protected websocketUrl: string
  protected roomId: string
  private label: string

  constructor(context: any, options: any, label: string) {
    this.context = context
    this.websocketUrl = options.websocketUrl
    this.roomId = context.class_id || context.liveUser?.room
    this.label = label
    this.canvas = document.createElement('canvas')
    this.canvas.width = 640
    this.canvas.height = 480
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D
  }

  protected connect() {
    this.wsConnection = new WebSocket(this.websocketUrl)
    this.wsConnection.onopen = () => this.onOpen()
    this.wsConnection.onmessage = (event) => this.onMessage(event)
    this.wsConnection.onerror = (ev) => debug.api.general(`${this.label} WS error:`, ev)
  }

  protected send(payload: any) {
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify(payload))
    }
  }

  // Resize canvas to match the source only when dimensions actually change.
  protected resizeCanvas(width: number, height: number) {
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }
  }

  protected abstract onOpen(): void
  protected abstract onMessage(event: MessageEvent): void

  public stop() {
    if (this.wsConnection) {
      this.wsConnection.close()
      this.wsConnection = null
    }
  }
}

// WebSocket Stream Server
export class WebSocketStreamServer extends WebSocketStreamBase {
  private videoElement: HTMLVideoElement
  private ticker: { stop: () => void } | null = null

  constructor(context: any, stream: MediaStream, options: any = {}) {
    super(context, options, 'WebSocketStreamServer')

    this.videoElement = document.createElement('video')
    this.videoElement.srcObject = stream
    this.videoElement.muted = true
    this.videoElement.play()

    this.videoElement.onloadedmetadata = () => {
      this.resizeCanvas(this.videoElement.videoWidth, this.videoElement.videoHeight)
      this.connect()
    }
  }

  protected onOpen() {
    this.send({ type: 'register-source', roomId: this.roomId })
    this.startFrameCapture()
  }

  protected onMessage() {
    // Server doesn't act on inbound messages.
  }

  private startFrameCapture() {
    this.ticker = createUnthrottledTicker(1000 / WS_FPS, () => {
      const video = this.videoElement
      if (this.wsConnection?.readyState !== WebSocket.OPEN) return
      if (video.readyState !== video.HAVE_ENOUGH_DATA) return

      try {
        this.resizeCanvas(video.videoWidth, video.videoHeight)
        this.ctx.drawImage(video, 0, 0, video.videoWidth, video.videoHeight)
        this.send({ type: 'frame', data: this.canvas.toDataURL('image/jpeg', WS_JPEG_QUALITY) })
      } catch (error: any) {
        debug.api.general('WebSocketStreamServer frame capture error:', error?.message || error)
      }
    })
  }

  public stop() {
    this.ticker?.stop()
    this.ticker = null
    super.stop()
  }
}

// WebSocket Stream Client
export class WebSocketStreamClient extends WebSocketStreamBase {
  private handler: (stream: MediaStream, settings: any) => void
  private stream: MediaStream | null = null
  private img: HTMLImageElement

  constructor(context: any, handler: (stream: MediaStream, settings: any) => void, options: any = {}) {
    super(context, options, 'WebSocketStreamClient')
    this.handler = handler

    this.img = new Image()
    this.img.onload = () => this.renderFrame()

    this.connect()
  }

  protected onOpen() {
    if (this.roomId) {
      this.send({ type: 'join-room', roomId: this.roomId })
    }
  }

  protected onMessage(event: MessageEvent) {
    try {
      const message = JSON.parse(event.data)
      if (message.type === 'frame' && message.data) {
        this.img.src = message.data
      }
    } catch (error: any) {
      debug.api.general('WebSocketStreamClient message parse error:', error?.message || error)
    }
  }

  private renderFrame() {
    try {
      this.resizeCanvas(this.img.width, this.img.height)
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
      this.ctx.drawImage(this.img, 0, 0)

      // First frame: build a MediaStream from the canvas and hand it off.
      if (!this.stream) {
        this.stream = this.canvas.captureStream(30)
        this.handler(this.stream, this.context.module.stationConfig)
      }
    } catch (error: any) {
      debug.api.general('WebSocketStreamClient image render error:', error?.message || error)
    }
  }

  public stop() {
    super.stop()
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
  }
}
