/**
 * streamhandler.ts
 *
 * WebRTC and WebSocket streaming functionality for Edrys with:
 * - ICE candidate handling for WebRTC
 * - Reconnection logic
 * - Support for both WebRTC and WebSocket streaming methods
*/

// WebRTC helper functions
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

// Global Maps for managing stream sessions
const streamSessions = new Map<string, StreamServer>()
const wsStreamSessions = new Map<string, WebSocketStreamServer>()

// WebRTC Stream Server
export class StreamServer {
  private context: any
  private stream: MediaStream
  private pendingCandidates = new Map<string, any[]>()
  private peerConnections = new Map<string, RTCPeerConnection>()
  private sessionId: string
  private rtcConfig: RTCConfiguration

  constructor(context: any, stream: MediaStream, rtcConfig: RTCConfiguration) {
    this.context = context
    this.stream = stream
    this.rtcConfig = rtcConfig
    this.sessionId = Date.now().toString()
    streamSessions.set(this.sessionId, this)

    this.setupMessageHandlers()
    
    // Broadcast stream info with a small delay
    setTimeout(() => this.broadcastStreamInfo(), 500)
  }

  private setupMessageHandlers() {
    // Handle stream requests
    this.context.onMessage(({ subject, from }: any) => {
      if (subject === 'requestStream') {
        this.broadcastStreamInfo(from)
      }
    })

    // Handle WebRTC signaling
    this.context.onMessage(async ({ subject, body, from }: any) => {
      if (
        subject === 'webrtc-signal' &&
        body.targetPeerId === this.context.username
      ) {
        if (body.sessionId === this.sessionId || !body.sessionId) {
          this.handleSignaling(from, body)
        }
      }
    })
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
        // Create or re-use peer connection
        if (peerConnection) {
          try {
            peerConnection.close()
          } catch (e) {
            console.warn(`Error closing connection:`, e)
          }
        }
        
        // Create new peer connection
        peerConnection = new RTCPeerConnection(this.rtcConfig)
        this.peerConnections.set(from, peerConnection)
        this.pendingCandidates.set(from, [])
        
        // Add tracks
        this.stream.getTracks().forEach(track => {
          peerConnection.addTrack(track, this.stream)
        })
        
        // Handle ICE candidates
        peerConnection.onicecandidate = (event) => {
          if (event.candidate) {
            this.context.sendMessage('webrtc-signal', {
              type: 'ice-candidate',
              candidate: event.candidate,
              sessionId: this.sessionId,
              targetPeerId: from,
              fromPeerId: this.context.username,
            })
          }
        }
        
        // Handle connection state changes
        peerConnection.onconnectionstatechange = () => {
          if (peerConnection.connectionState === 'failed' || 
              peerConnection.connectionState === 'disconnected') {
            // Notify client to reconnect
            this.context.sendMessage('webrtc-signal', {
              type: 'reconnect',
              sessionId: this.sessionId,
              targetPeerId: from,
              fromPeerId: this.context.username,
            })
          }
        }

        // Set remote description (the offer)
        await peerConnection.setRemoteDescription(new RTCSessionDescription(body.sdp))
        
        // Process any pending ICE candidates
        await addPendingIceCandidates(
          peerConnection,
          this.pendingCandidates.get(from) || []
        )
        
        // Create and send answer
        const answer = await peerConnection.createAnswer()
        await peerConnection.setLocalDescription(answer)
        
        this.context.sendMessage('webrtc-signal', {
          type: 'answer',
          sdp: answer,
          sessionId: this.sessionId,
          targetPeerId: from,
          fromPeerId: this.context.username,
        })
        
      } else if (body.type === 'ice-candidate') {
        // If we receive an ICE candidate but don't have a peer connection yet, ignore it
        if (!peerConnection) return
        
        // If we have a remote description, add the candidate immediately
        if (peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(body.candidate))
            .catch(e => console.warn('Failed to add ICE candidate:', e))
        } else {
          // Otherwise store it for later
          if (!this.pendingCandidates.has(from)) {
            this.pendingCandidates.set(from, [])
          }
          this.pendingCandidates.get(from)?.push(body.candidate)
        }
      }
    } catch (err) {
      console.error(`Error in signal handling for peer ${from}:`, err)
      // Notify client of error
      this.context.sendMessage('webrtc-signal', {
        type: 'error',
        message: 'Connection failed',
        sessionId: this.sessionId,
        targetPeerId: from,
        fromPeerId: this.context.username,
      })
    }
  }

  public stop() {
    // Close all peer connections
    this.peerConnections.forEach((conn) => {
      try {
        conn.close()
      } catch (e) {
        console.warn(`Error closing connection:`, e)
      }
    })
    
    // Clear peer connections and candidates
    this.peerConnections.clear()
    this.pendingCandidates.clear()

    // Send stream stopped notification
    this.context.sendMessage('streamStopped', {
      peerId: this.context.username,
      sessionId: this.sessionId,
    })
    
    // Remove from sessions map
    streamSessions.delete(this.sessionId)
  }
}

// WebRTC Stream Client
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
  }

  private setupMessageHandlers() {
    this.context.onMessage(({ subject, body }: any) => {
      if (subject === 'streamCredentials') {
        // Store session and peer info
        this.sessionId = body.sessionId
        this.peerId = body.peerId
        
        // Initiate connection
        this.connectToPeer(body)
      } 
      else if (subject === 'streamStopped' &&
               body.peerId === this.peerId &&
               body.sessionId === this.sessionId) {
        // Stream stopped by server
        this.cleanupAndReconnect()
      } 
      else if (subject === 'webrtc-signal' &&
               body.targetPeerId === this.context.username &&
               body.sessionId === this.sessionId) {
        // Handle WebRTC signaling messages
        if (body.type === 'reconnect' || body.type === 'error') {
          this.cleanupAndReconnect()
        } else {
          this.handleSignaling(body)
        }
      }
    })
  }

  private cleanupAndReconnect() {
    // Clean up existing connection
    if (this.peerConnection) {
      try {
        this.peerConnection.close()
      } catch (e) {
        console.error('Error closing connection:', e)
      }
      this.peerConnection = null
    }
    
    // Clear pending candidates
    this.pendingIceCandidates = []
    
    // Increment reconnection attempts
    this.reconnectAttempts++
    const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 30000)
    console.log(`Reconnecting in ${delay} ms (attempt ${this.reconnectAttempts})`)

    // Schedule reconnection
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = window.setTimeout(() => {
      this.requestStream()
    }, delay)
  }

  private requestStream() {
    this.context.sendMessage('requestStream')
  }

  private handleSignaling(body: any) {
    if (!this.peerConnection) return

    try {
      if (body.type === 'answer') {
        // Set remote description (the answer)
        this.peerConnection
          .setRemoteDescription(new RTCSessionDescription(body.sdp))
          .then(() => {
            // Process any pending ICE candidates
            if (this.pendingIceCandidates.length > 0) {
              return Promise.all(
                this.pendingIceCandidates.map(candidate =>
                  this.peerConnection!.addIceCandidate(new RTCIceCandidate(candidate))
                    .catch(e => console.warn('Failed to add ICE candidate:', e))
                )
              )
            }
          })
          .then(() => {
            this.pendingIceCandidates = []
          })
          .catch(err => {
            console.error('Error handling answer:', err)
          })
      } 
      else if (body.type === 'ice-candidate') {
        // Add ICE candidate if possible, otherwise store it
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

  private async connectToPeer({ peerId, settings, sessionId }: any) {
    // Clean up existing connection if any
    if (this.peerConnection) {
      try {
        this.peerConnection.close()
      } catch (e) {
        console.error('Error closing existing connection:', e)
      }
      this.pendingIceCandidates = []
    }

    try {
      // Create new peer connection
      this.peerConnection = new RTCPeerConnection(this.rtcConfig)
      
      // Set up connection event handlers
      this.peerConnection.onconnectionstatechange = () => {
        if (
          this.peerConnection?.connectionState === 'failed' ||
          this.peerConnection?.connectionState === 'disconnected'
        ) {
          this.cleanupAndReconnect()
        }
      }

      this.peerConnection.oniceconnectionstatechange = () => {
        if (
          this.peerConnection?.iceConnectionState === 'failed' ||
          this.peerConnection?.iceConnectionState === 'disconnected'
        ) {
          this.cleanupAndReconnect()
        }
      }

      this.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          // Send ICE candidate to peer
          this.context.sendMessage('webrtc-signal', {
            type: 'ice-candidate',
            candidate: event.candidate,
            sessionId: this.sessionId,
            targetPeerId: this.peerId,
            fromPeerId: this.context.username,
          })
        }
      }

      // Handle incoming stream
      this.peerConnection.ontrack = (event) => {
        this.handler(event.streams[0], settings)
      }

      // Create and send offer
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

      // Reset reconnection attempts on successful connection
      this.reconnectAttempts = 0
    } catch (err) {
      console.error('Error in connectToPeer:', err)
      this.cleanupAndReconnect()
    }
  }

  public stop() {
    clearTimeout(this.reconnectTimer)
    
    if (this.peerConnection) {
      this.peerConnection.close()
      this.peerConnection = null
    }
    
    this.pendingIceCandidates = []
  }
}

// WebSocket Stream Server 
export class WebSocketStreamServer {
  private context: any;
  private stream: MediaStream;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private wsConnection: WebSocket | null = null;
  private frameRequestId: number | null = null;
  private sessionId: string;
  private settings: any;
  private websocketUrl: string;
  private keepAliveInterval: number | null = null;
  private roomId: string;
  
  constructor(context: any, stream: MediaStream, options: any = {}) {
    this.context = context;
    this.stream = stream;
    this.sessionId = Date.now().toString();
    this.settings = {
      mirrorX: this.context.module.stationConfig?.mirrorX ?? false,
      mirrorY: this.context.module.stationConfig?.mirrorY ?? false,
      rotate: this.context.module.stationConfig?.rotate ?? 0,
    };
    
    this.websocketUrl = options.websocketUrl;
    this.roomId = this.context.class_id || this.context.liveUser?.room || this.sessionId;

    // Create video element to get media stream
    const videoElement = document.createElement('video');
    videoElement.srcObject = stream;
    videoElement.muted = true; // Prevent feedback
    videoElement.play();
    
    // Setup canvas for frame capture
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 480;
    this.ctx = this.canvas.getContext('2d') as CanvasRenderingContext2D;
    
    wsStreamSessions.set(this.sessionId, this);
        
    // Wait for video to be ready before starting stream
    videoElement.onloadedmetadata = () => {
      this.canvas.width = videoElement.videoWidth;
      this.canvas.height = videoElement.videoHeight;
      this.startStreaming(videoElement);
    };
  }
  
  // Keep connection alive with periodic messages
  private ensureKeepAlive() {
    if (this.keepAliveInterval !== null) {
      clearInterval(this.keepAliveInterval);
    }
    
    // Send keep-alive every 5 seconds
    this.keepAliveInterval = window.setInterval(() => {
      if (this.wsConnection && this.wsConnection.readyState === WebSocket.OPEN) {
        this.wsConnection.send(JSON.stringify({
          type: 'keep-alive',
          timestamp: Date.now()
        }));
      }
    }, 5000);
  }

  private startStreaming(videoElement: HTMLVideoElement) {    
    this.wsConnection = new WebSocket(this.websocketUrl);
    
    this.wsConnection.onopen = () => {      
      if (this.wsConnection) {
        // Register as source with room ID
        this.wsConnection.send(JSON.stringify({
          type: 'register-source',
          roomId: this.roomId,
          settings: this.settings
        }));
        
        // Start keep-alive to maintain connection
        this.ensureKeepAlive();
        
        // Begin capturing and sending frames
        this.startFrameCapture(videoElement);
      }
    };
    
    this.wsConnection.onclose = () => {
      this.stopFrameCapture();
    };
    
    this.wsConnection.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.stopFrameCapture();
    };
  }

  private startFrameCapture(videoElement: HTMLVideoElement) {
    let lastFrameTime = 0;
    const frameRate = 15;
    const quality = 0.7;
    const frameInterval = 1000 / frameRate;
    
    // Frame capture loop using requestAnimationFrame for better timing
    const captureFrame = (timestamp: number) => {
      if (!this.wsConnection || this.wsConnection.readyState !== WebSocket.OPEN) {
        this.stopFrameCapture();
        return;
      }
      
      // Throttle frame capture to maintain target frame rate
      const elapsed = timestamp - lastFrameTime;
      if (elapsed > frameInterval && videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
        lastFrameTime = timestamp;
        
        try {
          // Set canvas dimensions to match video
          const width = videoElement.videoWidth;
          const height = videoElement.videoHeight;
            
          if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
          }
          
          // Draw video frame to canvas and convert to JPEG data URL
          this.ctx.drawImage(videoElement, 0, 0, width, height);
          const dataUrl = this.canvas.toDataURL('image/jpeg', quality);
          
          // Send frame to all connected clients via WebSocket server
          this.wsConnection.send(JSON.stringify({
            type: 'frame',
            data: dataUrl,
            settings: this.settings,
            timestamp: Date.now(),
            frameRate: frameRate
          }));
        } catch (error) {
          console.error("Error capturing frame:", error);
        }
      }
      
      // Schedule next frame capture
      this.frameRequestId = requestAnimationFrame(captureFrame);
    };
    
    // Start the frame capture loop
    this.frameRequestId = requestAnimationFrame(captureFrame);
  }

  private stopFrameCapture() {
    if (this.frameRequestId !== null) {
      cancelAnimationFrame(this.frameRequestId);
      this.frameRequestId = null;
    }
  }

  public stop() {
    this.stopFrameCapture();
    
    if (this.keepAliveInterval !== null) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
      
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    
    wsStreamSessions.delete(this.sessionId);
  }
}

// WebSocket Stream Client
export class WebSocketStreamClient {
  private context: any;
  private handler: (stream: MediaStream, settings: any) => void;
  private wsConnection: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private streamCanvas: HTMLCanvasElement;
  private streamCtx: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private websocketUrl: string;
  private img: HTMLImageElement;
  private frameBuffer: string[] = [];
  private maxBufferSize = 3;
  private processingFrame = false;
  private roomId: string;
  private sourceAvailable: boolean = false;

  constructor(context: any, handler: (stream: MediaStream, settings: any) => void, options: any = {}) {
    this.context = context;
    this.handler = handler;
    this.websocketUrl = options.websocketUrl;
    this.roomId = this.context.class_id || this.context.liveUser?.room || null;
    
    // Create canvas for rendering received frames
    this.streamCanvas = document.createElement('canvas');
    this.streamCanvas.width = 640;
    this.streamCanvas.height = 480;
    this.streamCtx = this.streamCanvas.getContext('2d') as CanvasRenderingContext2D;
    
    // Image element to load received frames
    this.img = new Image();
    this.setupImageHandlers();
    
    this.connect();
  }

  // Setup handlers to process and display frames from the buffer
  private setupImageHandlers() {
    const processNextFrame = () => {
      // Only process one frame at a time, and only if there are frames in buffer
      if (this.processingFrame || this.frameBuffer.length === 0) return;
      
      this.processingFrame = true;
      const frameData = this.frameBuffer.shift();
      
      if (frameData) {
        this.img.onload = () => {
          try {
            // Adjust canvas size if needed to match frame dimensions
            if (this.streamCanvas.width !== this.img.width || 
                this.streamCanvas.height !== this.img.height) {
              this.streamCanvas.width = this.img.width;
              this.streamCanvas.height = this.img.height;
            }
            
            // Draw the received frame to canvas
            this.streamCtx.clearRect(0, 0, this.streamCanvas.width, this.streamCanvas.height);
            this.streamCtx.drawImage(this.img, 0, 0);
            
            // Create MediaStream from canvas on first frame only
            if (!this.stream) {
              // Request 30fps from captureStream for smoother playback
              this.stream = this.streamCanvas.captureStream(30);
              this.handler(this.stream, this.context.module.stationConfig);
            }
            
            this.processingFrame = false;
            
            // Process next frame if available
            if (this.frameBuffer.length > 0) {
              window.setTimeout(processNextFrame, 10);
            }
          } catch (error) {
            console.error("Error displaying frame:", error);
            this.processingFrame = false;
          }
        };
        
        this.img.onerror = () => {
          console.error("Error loading image");
          this.processingFrame = false;
          window.setTimeout(processNextFrame, 10);
        };
        
        // Set the image source to the frame data (starts loading)
        this.img.src = frameData;
      } else {
        this.processingFrame = false;
      }
    };
    
    // Check regularly for new frames to process
    setInterval(() => {
      if (!this.processingFrame && this.frameBuffer.length > 0) {
        processNextFrame();
      }
    }, 16); // Approximately 60fps check rate
  }

  private connect() {
    this.wsConnection = new WebSocket(this.websocketUrl);
    
    this.wsConnection.onopen = () => {
      this.reconnectAttempts = 0;
      console.log("WebSocket client connected");
      
      // Join the specific room
      if (this.roomId) {
        this.wsConnection.send(JSON.stringify({
          type: 'join-room',
          roomId: this.roomId
        }));
      } else {
        console.warn("No room ID available for WebSocket streaming");
      }
    };
    
    this.wsConnection.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        
        if (message.type === 'source-available' && message.roomId === this.roomId) {
          this.sourceAvailable = true;
        } else if (message.type === 'source-disconnected' && message.roomId === this.roomId) {
          this.sourceAvailable = false;
          // Clear buffer when source disconnects
          this.frameBuffer = [];
        } else if (message.type === 'frame' && message.data && this.sourceAvailable) {
          // Buffer the frame
          if (this.frameBuffer.length < this.maxBufferSize) {
            this.frameBuffer.push(message.data);
          } else {
            this.frameBuffer.shift();
            this.frameBuffer.push(message.data);
          }
        } else if (message.type === 'info') {
          console.log("WebSocket info:", message.message);
        }
      } catch (error) {
        console.error("Error processing message:", error);
      }
    };
    
    this.wsConnection.onclose = () => {
      this.reconnect();
    };
    
    this.wsConnection.onerror = (error) => {
      console.error("WebSocket error:", error);
    };
  }

  // Attempt to reconnect with exponential backoff
  private reconnect() {
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    
    this.reconnectAttempts++;
    const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1000, 30000);
    
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
    }
    
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
    }, delay);
  }

  public stop() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.wsConnection) {
      this.wsConnection.close();
      this.wsConnection = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }
}