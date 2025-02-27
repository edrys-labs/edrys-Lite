/**
 * Handles WebRTC streaming functionality for Edrys
 */


async function addPendingIceCandidates(peerConnection, pendingCandidates) {
  if (peerConnection.remoteDescription && pendingCandidates.length > 0) {
    //console.log(`Adding ${pendingCandidates.length} pending ICE candidates`);
    try {
      await Promise.all(
        pendingCandidates.map((candidate) =>
          peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
        )
      );
      return [];
    } catch (e) {
      //console.error("Error adding pending ICE candidates:", e);
      return pendingCandidates;
    }
  }
  return pendingCandidates;
}

async function handleIceCandidate(
  peerConnection,
  candidate,
  pendingCandidates
) {
  if (!peerConnection) return pendingCandidates;

  try {
    if (peerConnection.remoteDescription) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      //console.log("Queuing ICE candidate");
      pendingCandidates.push(candidate);
    }
  } catch (e) {
    console.log("ICE candidate error:", e);
  }
  return pendingCandidates;
}

// Separate connection instances per stream session
const streamSessions = new Map();

export class StreamServer {
  private context;
  private stream: MediaStream;
  private pendingCandidates = new Map();
  private peerConnections = new Map();
  private sessionId;
  private rtcConfig: RTCConfiguration;

  constructor(context, stream, rtcConfig: RTCConfiguration) {
    this.context = context;
    this.stream = stream;
    this.rtcConfig = rtcConfig;
    this.sessionId = Date.now().toString();
    streamSessions.set(this.sessionId, this);

    this.setupMessageHandlers();
  }

  private setupMessageHandlers() {
    // Only broadcast when receiving a 'requestStream' message
    this.context.onMessage(({ subject, from }) => {
      if (subject === "requestStream") {
        this.broadcastStreamInfo(from);
      }
    });

    // Set up server-side peer connection handler
    this.context.onMessage(async ({ subject, body, from }) => {
      if (
        subject === "webrtc-signal" &&
        body.targetPeerId === this.context.username
      ) {
        // Check if this is a message for this specific stream session
        if (body.sessionId === this.sessionId || !body.sessionId) {
          this.handleSignaling(from, body);
        }
      }
    });

    // Initial broadcast when server starts
    setTimeout(() => this.broadcastStreamInfo(), 500);
  }

  private broadcastStreamInfo(specific = null) {
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
    };

    if (specific) {
      // Send to specific peer
      this.context.sendMessage("streamCredentials", message, specific);
    } else {
      // Broadcast to all
      this.context.sendMessage("streamCredentials", message);
    }
  }

  private async handleSignaling(from, body) {
    let peerConnection = this.peerConnections.get(from);

    try {
      if (body.type === "offer") {
        //console.log(`Server processing offer from peer: ${from}, signaling state: ${peerConnection?.signalingState || 'no connection'}`);
        
        // Always create a new connection for each new offer
        peerConnection = this.createNewPeerConnection(from);
        
        await peerConnection
          .setRemoteDescription(new RTCSessionDescription(body.sdp))
          .catch((err) => {
            console.error(`Error setting remote description: ${err}`);
            throw err;
          });

        // Process any pending candidates
        this.pendingCandidates.set(
          from,
          await addPendingIceCandidates(
            peerConnection,
            this.pendingCandidates.get(from) || []
          )
        );

        const answer = await peerConnection.createAnswer().catch((err) => {
          console.error(`Error creating answer: ${err}`);
          throw err;
        });

        await peerConnection.setLocalDescription(answer).catch((err) => {
          console.error(`Error setting local description: ${err}`);
          throw err;
        });

        // Send answer back with session ID
        this.context.sendMessage("webrtc-signal", {
          type: "answer",
          sdp: answer,
          sessionId: this.sessionId,
          targetPeerId: from,
          fromPeerId: this.context.username,
        });

        //console.log(`Server sent answer to peer: ${from}`);
      } else if (body.type === "ice-candidate") {
        if (!peerConnection) {
          //console.log(`Received ICE candidate but no connection exists for peer: ${from}, creating new connection`);
          peerConnection = this.createNewPeerConnection(from);
        }
        
        if (!this.pendingCandidates.has(from)) {
          this.pendingCandidates.set(from, []);
        }

        this.pendingCandidates.set(
          from,
          await handleIceCandidate(
            peerConnection,
            body.candidate,
            this.pendingCandidates.get(from)
          )
        );
      }
    } catch (err) {
      console.error(`Error in server signal handling for peer ${from}:`, err);
      // Signal the client to reconnect
      this.context.sendMessage("webrtc-signal", {
        type: "reconnect",
        sessionId: this.sessionId,
        targetPeerId: from,
        fromPeerId: this.context.username,
      });
    }
  }

  private createNewPeerConnection(peerId) {
    // Always close any existing connection
    if (this.peerConnections.has(peerId)) {
      const oldConnection = this.peerConnections.get(peerId);
      if (oldConnection) {
        try {
          oldConnection.close();
        } catch (e) {
          console.warn(`Error closing old connection: ${e}`);
        }
      }
    }

    //console.log(`Server creating new connection for peer: ${peerId}`);
    const peerConnection = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, peerConnection);
    this.pendingCandidates.set(peerId, []);

    // Add local stream tracks to connection
    this.stream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, this.stream);
    });

    // ICE candidate handler
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.context.sendMessage("webrtc-signal", {
          type: "ice-candidate",
          candidate: event.candidate,
          sessionId: this.sessionId,
          targetPeerId: peerId,
          fromPeerId: this.context.username,
        });
      }
    };

    // Connection state handlers 
    peerConnection.oniceconnectionstatechange = () => {
      //console.log(`Server ICE state for ${peerId}: ${peerConnection.iceConnectionState}`);
      if (peerConnection.iceConnectionState === "failed" || 
          peerConnection.iceConnectionState === "disconnected") {
        //console.log(`Server trying to restart ICE for peer ${peerId}`);
        peerConnection.restartIce();
        
        // If we're disconnected, ask client to reconnect
        if (peerConnection.iceConnectionState === "disconnected") {
          this.context.sendMessage("webrtc-signal", {
            type: "reconnect",
            sessionId: this.sessionId,
            targetPeerId: peerId,
            fromPeerId: this.context.username,
          });
        }
      }
    };

    peerConnection.onsignalingstatechange = () => {
      //console.log(`Server signaling state for ${peerId}: ${peerConnection.signalingState}`);
    };

    peerConnection.onconnectionstatechange = () => {
      //console.log(`Server connection state for ${peerId}: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === "failed" || 
          peerConnection.connectionState === "disconnected") {
        //console.log(`Connection to ${peerId} failed or disconnected`);
        
        // Notify client to reconnect
        this.context.sendMessage("webrtc-signal", {
          type: "reconnect",
          sessionId: this.sessionId,
          targetPeerId: peerId,
          fromPeerId: this.context.username,
        });
      }
    };

    return peerConnection;
  }

  public stop() {
    this.peerConnections.forEach((conn, peerId) => {
      try {
        //console.log(`Server closing connection to ${peerId}`);
        conn.close();
      } catch (e) {
        console.warn(`Error closing connection: ${e}`);
      }
    });

    this.peerConnections.clear();
    this.pendingCandidates.clear();
    this.context.sendMessage("streamStopped", {
      peerId: this.context.username,
      sessionId: this.sessionId,
    });

    streamSessions.delete(this.sessionId);
  }
}

export class StreamClient {
  private context;
  private handler;
  private peerConnection;
  private pendingIceCandidates = [];
  private sessionId;
  private peerId;
  private reconnectTimer;
  private rtcConfig: RTCConfiguration;

  constructor(context, handler, rtcConfig: RTCConfiguration) {
    this.context = context;
    this.handler = handler;
    this.rtcConfig = rtcConfig;
    
    this.setupMessageHandlers();

    // Request stream to initiate connection
    this.requestStream();
  }

  private setupMessageHandlers() {
    // Listen for stream credentials
    this.context.onMessage(({ subject, body }) => {
      if (subject === "streamCredentials") {
        //console.log("Client received stream credentials");
        // Store session ID to match signals to the correct stream
        this.sessionId = body.sessionId;
        this.peerId = body.peerId;
        this.connectToPeer(body);
      } else if (
        subject === "streamStopped" &&
        body.peerId === this.peerId &&
        body.sessionId === this.sessionId
      ) {
        //console.log("Stream stopped by server, will try to reconnect");
        this.cleanupAndReconnect();
      } else if (
        subject === "webrtc-signal" &&
        body.targetPeerId === this.context.username
      ) {
        // Match to session
        if (body.sessionId === this.sessionId) {
          if (body.type === "reconnect") {
            //console.log("Received reconnect signal from server");
            this.cleanupAndReconnect();
          } else {
            this.handleSignaling(body);
          }
        }
      }
    });
  }

  private cleanupAndReconnect() {
    // Clean up and try to reconnect
    if (this.peerConnection) {
      try {
        this.peerConnection.close();
      } catch (e) {
        console.error("Error closing connection:", e);
      }
      this.peerConnection = null;
    }
    this.pendingIceCandidates = [];

    // Attempt to reconnect after a delay
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      //console.log("Client attempting to reconnect...");
      this.requestStream();
    }, 2000); 
  }

  private requestStream() {
    this.context.sendMessage("requestStream");
  }

  private handleSignaling(body) {
    if (!this.peerConnection) return;

    try {
      if (body.type === "answer") {
        if (this.peerConnection.signalingState === "have-local-offer") {
          this.peerConnection
            .setRemoteDescription(new RTCSessionDescription(body.sdp))
            .then(() => {
              //console.log("Client set remote description success");
              return addPendingIceCandidates(
                this.peerConnection,
                this.pendingIceCandidates
              );
            })
            .then(() => {
              this.pendingIceCandidates = [];
            })
            .catch((err) => {
              console.error("Error handling answer:", err);
            });
        }
      } else if (body.type === "ice-candidate") {
        if (this.peerConnection.remoteDescription) {
          this.peerConnection
            .addIceCandidate(new RTCIceCandidate(body.candidate))
            .catch((e) => console.warn("Failed to add ICE candidate:", e));
        } else {
          //console.log("Client queuing ICE candidate");
          this.pendingIceCandidates.push(body.candidate);
        }
      }
    } catch (err) {
      console.error("Client error handling signal:", err);
    }
  }

  private async connectToPeer({ roomId, peerId, settings, sessionId }) {
    if (this.peerConnection) {
      //console.log("Client closing existing connection before creating new one");
      try {
        this.peerConnection.close();
      } catch (e) {
        console.error("Error closing connection:", e);
      }
      this.pendingIceCandidates = [];
    }

    //console.log(`Client connecting to peer: ${peerId} with sessionId: ${sessionId}`);
    
    this.peerConnection = new RTCPeerConnection(this.rtcConfig);

    this.setupConnectionStateHandlers(settings);

    try {
      //console.log("Client creating offer");
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      //console.log(`Client setting local description: ${offer.type}`);
      await this.peerConnection.setLocalDescription(offer);

      // Send offer with session ID
      //console.log(`Client sending offer to peer: ${peerId}`);
      this.context.sendMessage("webrtc-signal", {
        type: "offer",
        sdp: offer,
        sessionId: sessionId,
        targetPeerId: peerId,
        fromPeerId: this.context.username,
      });
      
    } catch (err) {
      //console.error("Error in client connectToPeer:", err);
      // Try to reconnect on error
      this.cleanupAndReconnect();
    }
  }

  private setupConnectionStateHandlers(settings) {
    const pc = this.peerConnection;

    pc.onsignalingstatechange = () => {
      //console.log(`Client signaling state: ${pc.signalingState}`);
    };

    pc.onconnectionstatechange = () => {
      //console.log(`Client connection state: ${pc.connectionState}`);
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "disconnected"
      ) {
        //console.log("Client connection failed/disconnected, attempting to reconnect");
        this.cleanupAndReconnect();
      }
    };

    pc.oniceconnectionstatechange = () => {
      //console.log(`Client ICE state: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === "failed" || 
          pc.iceConnectionState === "disconnected") {
        //console.log("Client ICE connection failed/disconnected");
        this.cleanupAndReconnect();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        //console.log("Client sending ICE candidate");
        this.context.sendMessage("webrtc-signal", {
          type: "ice-candidate",
          candidate: event.candidate,
          sessionId: this.sessionId,
          targetPeerId: this.peerId,
          fromPeerId: this.context.username,
        });
      }
    };

    pc.ontrack = (event) => {
      //console.log("Client received track", event.streams);
      this.handler(event.streams[0], settings);
    };
  }

  public stop() {
    clearTimeout(this.reconnectTimer);
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}
