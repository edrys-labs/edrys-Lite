/**
 * Handles WebRTC streaming functionality for Edrys
 */

export const RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.goldi-labs.de:3478" },
    { urls: "stun:stun.openrelay.metered.ca:80" },
    {
      urls: "turn:turn.goldi-labs.de:3478",
      username: "goldi",
      credential: "goldi",
    },
  ],
  iceTransportPolicy: "all" as RTCIceTransportPolicy,
  iceCandidatePoolSize: 10,
};

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

  constructor(context, stream) {
    this.context = context;
    this.stream = stream;
    this.sessionId = Date.now().toString();
    streamSessions.set(this.sessionId, this);

    // Set up the handlers for server-side streaming
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
      sessionId: this.sessionId, // Include session ID in credentials
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

    if (
      !peerConnection ||
      peerConnection.connectionState === "closed" ||
      peerConnection.connectionState === "failed"
    ) {
      peerConnection = this.createNewPeerConnection(from);
    }

    try {
      if (body.type === "offer") {
        // Only process offer in stable state
        if (peerConnection.signalingState === "stable") {
          //console.log(`Server processing offer from peer: ${from}`);

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
        } else {
          console.warn(
            `Server ignoring offer from ${from}, signaling state: ${peerConnection.signalingState}`
          );
        }
      } else if (body.type === "ice-candidate") {
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
      if (peerConnection.signalingState !== "stable") {
        try {
          await peerConnection
            .setLocalDescription({ type: "rollback" })
            .catch((e) => console.warn(`Rollback failed: ${e}`));
        } catch (e) {
          console.log(`Server rollback failed for peer ${from}:`, e);
        }
      }
    }
  }

  private createNewPeerConnection(peerId) {
    if (this.peerConnections.has(peerId)) {
      const oldConnection = this.peerConnections.get(peerId);
      if (oldConnection.connectionState !== "closed") {
        try {
          oldConnection.close();
        } catch (e) {
          console.warn(`Error closing old connection: ${e}`);
        }
      }
    }

    //console.log(`Server creating new connection for peer: ${peerId}`);
    const peerConnection = new RTCPeerConnection(RTCConfiguration);
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
      if (peerConnection.iceConnectionState === "failed") {
        //console.log(`Server trying to restart ICE for peer ${peerId}`);
        peerConnection.restartIce();
      }
    };

    peerConnection.onsignalingstatechange = () => {
      //console.log(`Server signaling state for ${peerId}: ${peerConnection.signalingState}`);
    };

    peerConnection.onconnectionstatechange = () => {
      //console.log(`Server connection state for ${peerId}: ${peerConnection.connectionState}`);
      if (peerConnection.connectionState === "failed") {
        //console.log(`Connection to ${peerId} failed, removing connection`);
        this.peerConnections.delete(peerId);
        this.pendingCandidates.delete(peerId);
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

  constructor(context, handler) {
    this.context = context;
    this.handler = handler;

    // Set up the handlers for client-side streaming
    this.setupMessageHandlers();

    // Request stream to initiate connection
    this.requestStream();
  }

  private setupMessageHandlers() {
    // Listen for stream credentials
    this.context.onMessage(({ subject, body }) => {
      if (subject === "streamCredentials") {
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
        // Clean up and try to reconnect
        if (this.peerConnection) {
          this.peerConnection.close();
          this.peerConnection = null;
        }

        // Attempt to reconnect after a delay
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.requestStream();
        }, 1000);
      } else if (
        subject === "webrtc-signal" &&
        body.targetPeerId === this.context.username &&
        body.sessionId === this.sessionId
      ) {
        this.handleSignaling(body);
      }
    });
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
      //console.log("Client closing existing connection");
      this.peerConnection.close();
      this.pendingIceCandidates = [];
    }

    //console.log(`Client connecting to peer: ${peerId}`);
    this.peerConnection = new RTCPeerConnection(RTCConfiguration);

    this.setupConnectionStateHandlers(settings);

    try {
      //console.log("Client creating offer");
      const offer = await this.peerConnection.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });

      if (this.peerConnection.signalingState === "stable") {
        //console.log("Client setting local description");
        await this.peerConnection.setLocalDescription(offer);

        // Send offer with session ID
        this.context.sendMessage("webrtc-signal", {
          type: "offer",
          sdp: offer,
          sessionId: sessionId,
          targetPeerId: peerId,
          fromPeerId: this.context.username,
        });
      }
    } catch (err) {
      console.error("Error creating client offer:", err);
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
        //console.log("Client connection failed, attempting to reconnect");
        // Try to reconnect after a delay
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => {
          this.requestStream();
        }, 2000);
      }
    };

    pc.oniceconnectionstatechange = () => {
      //console.log(`Client ICE state: ${pc.iceConnectionState}`);
      if (pc.iceConnectionState === "failed") {
        pc.restartIce();
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
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
