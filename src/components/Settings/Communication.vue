<template>
  <v-container>
    <v-select
      v-model="communicationMethod"
      :items="['WebRTC', 'Websocket']"
      label="Communication Method"
      @change="updateConfig"
      :disabled="writeProtection"
    ></v-select>

    <v-text-field
      v-if="communicationMethod === 'Websocket'"
      v-model="websocketUrl"
      label="Websocket Server URL"
      placeholder="wss://demos.yjs.dev"
      @change="updateConfig"
      :disabled="writeProtection"
    ></v-text-field>

    <v-textarea
      v-if="communicationMethod === 'WebRTC'"
      v-model="webrtcConfig"
      label="WebRTC Configuration (JSON)"
      placeholder='{"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}'
      rows="5"
      @change="updateConfig"
      :disabled="writeProtection"
    ></v-textarea>
    
    <v-alert
      type="info"
      variant="outlined"
      prominent
      density="compact"
      color="primary"
      icon="mdi-information-outline"
      class="mt-4"
    >
      Changing the communication method will affect how the application connects to other peers.
      Using WebRTC allows for direct peer-to-peer connections, while Websocket requires a server to relay messages.
    </v-alert>
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
    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  data() {
    return {
      communicationMethod: "WebRTC", // Default to WebRTC
      websocketUrl: "",
      webrtcConfig: "",
    };
  },

  created() {
    // Initialize from config prop
    if (this.config.communicationMethod) {
      this.communicationMethod = this.config.communicationMethod;
    }
    if (this.config.websocketUrl) {
      this.websocketUrl = this.config.websocketUrl;
    }
    if (this.config.webrtcConfig) {
      this.webrtcConfig = typeof this.config.webrtcConfig === 'string' 
        ? this.config.webrtcConfig 
        : JSON.stringify(this.config.webrtcConfig, null, 2);
    } else {
      // Set default WebRTC config
      this.webrtcConfig = JSON.stringify({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          { urls: "stun:stun2.l.google.com:19302" },
        ]
      }, null, 2);
    }
    
    // Update config on initial creation to ensure it's set
    this.$nextTick(() => {
      this.updateConfig();
    });
  },

  methods: {
    updateConfig() {
      // Update the parent component with the new values
      this.$emit('update:config', {
        communicationMethod: this.communicationMethod,
        websocketUrl: this.websocketUrl,
        webrtcConfig: this.webrtcConfig,
      });
    },
  },

  watch: {
    communicationMethod() {
      this.updateConfig();
    },
    
    // Watch for config changes from parent
    config: {
      handler(newConfig) {
        if (newConfig.communicationMethod !== undefined) {
          this.communicationMethod = newConfig.communicationMethod;
        }
        if (newConfig.websocketUrl !== undefined) {
          this.websocketUrl = newConfig.websocketUrl;
        }
        if (newConfig.webrtcConfig !== undefined) {
          this.webrtcConfig = typeof newConfig.webrtcConfig === 'string' 
            ? newConfig.webrtcConfig 
            : JSON.stringify(newConfig.webrtcConfig, null, 2);
        }
      },
      deep: true
    }
  },
};
</script>
