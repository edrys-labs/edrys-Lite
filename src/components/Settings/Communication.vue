<template>
  <v-container>
    <v-select
      v-model="communicationMethod"
      :items="['WebRTC', 'Websocket']"
      label="Communication Method"
      :menu-props="{ offsetY: true }"
    ></v-select>

    <v-text-field
      v-if="communicationMethod === 'Websocket'"
      v-model="websocketUrl"
      label="Websocket Server URL"
      placeholder="wss://example.com"
    ></v-text-field>

    <v-textarea
      v-if="communicationMethod === 'WebRTC'"
      v-model="webrtcConfig"
      label="WebRTC Configuration (JSON)"
      placeholder='{"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}'
      rows="5"
    ></v-textarea>

    <v-text-field
      :value="communicationDescription"
      label="Communication Backend Description"
      readonly
    ></v-text-field>
  </v-container>
</template>

<script lang="ts">
export default {
  name: "Settings-Communication",

  props: {
    config: {
      type: Object,
      required: true,
    },
  },

  data() {
    return {
      communicationMethod: "WebRTC", // Default to WebRTC
      websocketUrl: "",
      webrtcConfig: "",
      communicationDescription: "WebRTC: Peer-to-peer communication using browser APIs.",
    };
  },

  watch: {
    communicationMethod(newValue) {
      if (newValue === "WebRTC") {
        this.communicationDescription =
          "WebRTC: Peer-to-peer communication using browser APIs.";
      } else if (newValue === "Websocket") {
        this.communicationDescription =
          "Websocket: Real-time communication through a server.";
      } else {
        this.communicationDescription = "";
      }
    },
  },
};
</script>
