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

// Stream Server (Station)
export class StreamServer {
  private context: any
  private stream: MediaStream
  private peer: Peer
  private streamName: string
  private connectedClients: Set<string> = new Set()

  constructor(context: any, stream: MediaStream, rtcConfig: RTCConfiguration, streamName?: string) {
    this.context = context
    this.stream = stream
    this.streamName = streamName || `${this.context.username}-stream`
    
    const peerId = generateStreamPeerID(context, this.streamName)
    this.peer = new Peer(peerId, { config: rtcConfig })
    this.setupPeerEvents()
  }

  private setupPeerEvents() {
    this.peer.on('open', () => {
      setTimeout(() => {
        // Server ready
      }, 2000) 
    })

    this.peer.on('connection', (conn) => {
      this.connectedClients.add(conn.peer)
      
      // Delay before calling to ensure stable connection
      setTimeout(() => {
        this.callClient(conn.peer)
      }, 300)
      
      conn.on('close', () => {
        this.connectedClients.delete(conn.peer)
      })

      conn.on('error', () => {
        this.connectedClients.delete(conn.peer)
      })
    })

    this.peer.on('error', () => {
      // Handle peer errors silently
    })

    this.peer.on('disconnected', () => {
      if (!this.peer.destroyed) {
        this.peer.reconnect()
      }
    })
  }

  private callClient(clientPeerId: string) {
    if (this.stream) {
      const call = this.peer.call(clientPeerId, this.stream)
      
      if (!call) {
        this.connectedClients.delete(clientPeerId)
        return
      }
      
      call.on('error', () => {
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
    defaultStreamName?: string
  ) {
    this.context = context
    this.handler = handler
    this.defaultStreamName = defaultStreamName
    
    this.peer = new Peer({ config: rtcConfig })
    this.setupPeerEvents()
  }

  private setupPeerEvents() {
    this.peer.on('open', () => {
      // Auto-connect to default stream with delay to ensure server is ready
      if (this.defaultStreamName) {
        setTimeout(() => {
          this.selectStream(this.defaultStreamName!)
        }, 3000)
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
      // Handle "peer not found" errors with retry logic
      if (err.type === 'peer-unavailable' || err.message?.includes('Could not connect to peer')) {
        if (this.currentStreamName && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          
          const baseDelay = this.isInitialConnection ? this.reconnectDelay * 2 : this.reconnectDelay
          const delay = baseDelay * Math.pow(2, this.reconnectAttempts - 1)
          
          this.connectionTimeout = setTimeout(() => {
            if (!this.peer.destroyed && this.currentStreamName) {
              this.selectStream(this.currentStreamName!)
            }
          }, delay)
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          this.isInitialConnection = false
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

      this.currentConnection.on('error', () => {
        this.currentConnection = null
        this.handleConnectionFailure()
      })

    } catch (error) {
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

// Map to track active WebSocket stream sessions
const wsStreamSessions = new Map<string, WebSocketStreamServer>()

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
      debug.api.streamHandler(`WebSocket client connected to ${this.websocketUrl}`);
      
      // Join the specific room
      if (this.roomId) {
        this.wsConnection.send(JSON.stringify({
          type: 'join-room',
          roomId: this.roomId
        }));
      } else {
        debug.api.streamHandler("No room ID available for WebSocket streaming");
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
          debug.api.streamHandler(`WebSocket info: ${message.message}`);
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