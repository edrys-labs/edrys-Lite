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

// WebSocket fallback transport: the station encodes with
// MediaRecorder (WebM/VP8[/Opus]) and ships compressed chunks as binary; the
// viewer feeds them into a MediaSource and plays the resulting <video>. The relay
// forwards chunks per room.
const WS_TIMESLICE_MS = 250 // smaller chunks = lower baseline latency
const WS_MAX_LAG = 1 // seconds behind live before we jump to the edge

// room||streamName keying (mirrors WebRTC) so multiple WS streams coexist per room.
function buildWsRoomId(context: any, streamName: string): string {
  const baseRoom = context.class_id || context.liveUser?.room || ''
  return `${baseRoom}_${streamName}`.replace(/[^a-zA-Z0-9_-]/g, '_')
}

abstract class WebSocketStreamBase {
  protected context: any
  protected wsConnection: WebSocket | null = null
  protected websocketUrl: string
  protected streamName: string
  protected roomId: string
  private label: string

  constructor(context: any, options: any, label: string) {
    this.context = context
    this.websocketUrl = options.websocketUrl
    this.streamName = options.streamName || 'Camera 1'
    this.roomId = buildWsRoomId(context, this.streamName)
    this.label = label
  }

  protected connect() {
    this.wsConnection = new WebSocket(this.websocketUrl)
    this.wsConnection.binaryType = 'arraybuffer'
    this.wsConnection.onopen = () => this.onOpen()
    this.wsConnection.onmessage = (event) => this.onMessage(event)
    this.wsConnection.onerror = (ev) => debug.api.general(`${this.label} WS error:`, ev)
  }

  protected send(payload: any) {
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(JSON.stringify(payload))
    }
  }

  protected sendBinary(chunk: Blob | ArrayBuffer) {
    if (this.wsConnection?.readyState === WebSocket.OPEN) {
      this.wsConnection.send(chunk)
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

// Station side: record the camera stream and push chunks to the relay.
export class WebSocketStreamServer extends WebSocketStreamBase {
  private stream: MediaStream
  private recorder: MediaRecorder | null = null

  constructor(context: any, stream: MediaStream, options: any = {}) {
    super(context, options, 'WebSocketStreamServer')
    this.stream = stream
    this.connect()
  }

  protected onOpen() {
    this.startRecording()
    // Register with the EXACT mimeType the recorder produces — the viewer's
    // SourceBuffer must declare the same codecs or its init segment is rejected.
    this.send({
      type: 'register-source',
      roomId: this.roomId,
      streamName: this.streamName,
      mimeType: this.mimeType,
    })
  }

  protected onMessage(event: MessageEvent) {
    try {
      const msg = JSON.parse(event.data)
      // A viewer joined: restart the recorder so they get a fresh init segment at t=0.
      if (msg.type === 'viewer-joined') this.startRecording()
    } catch { /* ignore non-JSON */ }
  }

  // Codec string matching the tracks actually being recorded (vp8-only if no audio).
  private get mimeType(): string {
    const codecs = []
    if (this.stream.getVideoTracks().length) codecs.push('vp8')
    if (this.stream.getAudioTracks().length) codecs.push('opus')
    return `video/webm;codecs="${codecs.join(',')}"`
  }

  private startRecording() {
    if (this.recorder) this.recorder.stop()
    try {
      const mime = this.mimeType
      const opts = MediaRecorder.isTypeSupported(mime) ? { mimeType: mime } : undefined
      this.recorder = new MediaRecorder(this.stream, opts)
      this.recorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.sendBinary(e.data)
      }
      this.recorder.onerror = (e: any) =>
        console.warn('[ws-station] recorder error', e?.error?.name || e)
      this.recorder.start(WS_TIMESLICE_MS)
    } catch (error: any) {
      debug.api.general('WebSocketStreamServer recorder error:', error?.message || error)
    }
  }

  // Camera switch: restart the recorder so it emits a fresh init segment.
  public updateStream(newStream: MediaStream) {
    this.stream = newStream
    this.startRecording()
  }

  public stop() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.recorder = null
    super.stop()
  }
}

// Viewer side: feed incoming chunks into a MediaSource and hand the <video>'s
// captured stream back to the module.
export class WebSocketStreamClient extends WebSocketStreamBase {
  private handler: (stream: MediaStream, settings: any, metadata?: any) => void
  private stream: MediaStream | null = null
  private video: HTMLVideoElement
  private mediaSource = new MediaSource()
  private sourceBuffer: SourceBuffer | null = null
  private pending: ArrayBuffer[] = []
  private handedOff = false
  // Codec the SourceBuffer must declare; announced by the source (vp8-only if no audio).
  private mimeType: string | null = null
  private mediaSourceOpen = false

  constructor(
    context: any,
    handler: (stream: MediaStream, settings: any, metadata?: any) => void,
    options: any = {}
  ) {
    super(context, options, 'WebSocketStreamClient')
    this.handler = handler

    this.video = document.createElement('video')
    this.video.muted = true
    this.video.playsInline = true
    this.video.autoplay = true
    this.video.onloadeddata = () => this.handOff()
    this.video.onerror = () =>
      console.warn('[ws-view] video error', this.video.error?.code, this.video.error?.message)
    this.video.src = URL.createObjectURL(this.mediaSource)

    this.mediaSource.addEventListener('sourceopen', () => {
      this.mediaSourceOpen = true
      this.maybeCreateSourceBuffer()
    })

    this.connect()
  }

  protected onOpen() {
    if (this.roomId) this.send({ type: 'join-room', roomId: this.roomId })
  }

  // Needs both the MediaSource open and the source's mimeType; whichever lands last calls this.
  private maybeCreateSourceBuffer() {
    if (this.sourceBuffer || !this.mediaSourceOpen || !this.mimeType) return
    if (!MediaSource.isTypeSupported(this.mimeType)) {
      debug.api.general('WebSocketStreamClient unsupported mimeType:', this.mimeType)
      return
    }
    this.sourceBuffer = this.mediaSource.addSourceBuffer(this.mimeType)
    this.sourceBuffer.addEventListener('updateend', () => {
      // Snap to live, then play the offscreen <video> → onloadeddata → hand-off.
      this.syncToLive()
      if (this.video.paused) this.video.play().catch(() => {})
      this.flush()
    })
    this.flush()
  }

  protected onMessage(event: MessageEvent) {
    // Binary = media chunk; string = JSON control message.
    if (typeof event.data !== 'string') {
      const chunk = event.data as ArrayBuffer
      // An init segment mid-stream means the source restarted (its timeline resets
      // to ~0) — rebuild the MediaSource so the new stream starts clean.
      if (this.sourceBuffer && this.isInitSegment(chunk)) {
        this.rebuild()
      }
      this.pending.push(chunk)
      this.flush()
      return
    }
    try {
      const msg = JSON.parse(event.data)
      // The source announces the codec string its init segment uses.
      if (msg.type === 'source-available' && msg.mimeType) {
        this.mimeType = msg.mimeType
        this.maybeCreateSourceBuffer()
      }
    } catch (error: any) {
      debug.api.general('WebSocketStreamClient message parse error:', error?.message || error)
    }
  }

  // WebM streams begin with the EBML header magic bytes 0x1A45DFA3.
  private isInitSegment(chunk: ArrayBuffer): boolean {
    if (chunk.byteLength < 4) return false
    const b = new Uint8Array(chunk, 0, 4)
    return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3
  }

  // Source restarted: rebuild the MediaSource/SourceBuffer and re-hand off (changing
  // video.src kills the previously captured stream's tracks).
  private rebuild() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    this.pending = []
    this.sourceBuffer = null
    this.mediaSourceOpen = false
    this.handedOff = false
    this.mediaSource = new MediaSource()
    this.mediaSource.addEventListener('sourceopen', () => {
      this.mediaSourceOpen = true
      this.maybeCreateSourceBuffer()
    })
    this.video.src = URL.createObjectURL(this.mediaSource)
  }

  // Seek to the live edge once, before hand-off only — repeated seeks corrupt the decoder.
  private syncToLive() {
    if (this.handedOff) return
    const sb = this.sourceBuffer
    if (!sb || sb.buffered.length === 0) return
    const liveEnd = sb.buffered.end(sb.buffered.length - 1)
    if (liveEnd - this.video.currentTime > WS_MAX_LAG) {
      this.video.currentTime = Math.max(sb.buffered.start(sb.buffered.length - 1), liveEnd - 0.3)
    }
  }

  // Append chunks one at a time (a SourceBuffer takes a single append at a time).
  private flush() {
    const sb = this.sourceBuffer
    if (!sb || sb.updating || this.pending.length === 0) return
    try {
      sb.appendBuffer(this.pending.shift()!)
    } catch (error: any) {
      debug.api.general('WebSocketStreamClient appendBuffer error:', error?.message || error)
      this.rebuild()
    }
  }

  private handOff() {
    if (this.handedOff) return
    this.handedOff = true
    this.stream = (this.video as any).captureStream()
    this.handler(this.stream!, this.context.module.stationConfig || {}, {
      streamName: this.streamName,
      room: this.context.liveUser?.room,
    })
  }

  public stop() {
    super.stop()
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop())
      this.stream = null
    }
    this.video.pause()
    this.video.removeAttribute('src')
    this.sourceBuffer = null
    this.pending = []
  }
}
