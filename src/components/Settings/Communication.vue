<template>
  <v-container>
    <v-select
      v-model="communicationMethod"
      :items="['WebRTC', 'Websocket']"
      :label="$t('settings.communication.labels.method')"
      @change="updateConfig"
      :disabled="writeProtection"
    ></v-select>

    <v-text-field
      v-if="communicationMethod === 'Websocket'"
      v-model="websocketUrl"
      :label="$t('settings.communication.labels.websocketServer')"
      placeholder="wss://demos.yjs.dev"
      @change="updateConfig"
      :disabled="writeProtection"
    ></v-text-field>

    <template v-if="communicationMethod === 'WebRTC'">
      <v-text-field
        v-model="signalingServer"
        :label="$t('settings.communication.labels.webrtcSignaling')"
        placeholder="wss://rooms.deno.dev"
        @change="updateConfig"
        :disabled="writeProtection"
      ></v-text-field>

      <v-textarea
        v-model="webrtcConfig"
        :label="$t('settings.communication.labels.webrtcConfig')"
        placeholder='{"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}'
        rows="5"
        @change="updateConfig"
        :disabled="writeProtection"
      ></v-textarea>
    </template>
    
    <v-alert
      type="info"
      variant="outlined"
      prominent
      density="compact"
      color="primary"
      icon="mdi-information-outline"
      class="mt-4"
    >
      {{ $t("settings.communication.alert.first") }}
      <br />
      {{ $t("settings.communication.alert.second") }}
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
      signalingServer: "",
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
    if (this.config.signalingServer) {
      if (Array.isArray(this.config.signalingServer)) {
        this.signalingServer = this.config.signalingServer[0] || "wss://rooms.deno.dev";
      } else {
        this.signalingServer = this.config.signalingServer;
      }
    } else {
      // Default signaling server
      this.signalingServer = "wss://rooms.deno.dev";
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
    
    this.$nextTick(() => {
      this.updateConfig();
    });
  },

  methods: {
    updateConfig() {
      let webrtcConfigValue = this.webrtcConfig;
      
      try {
        if (typeof this.webrtcConfig === 'string') {
          webrtcConfigValue = JSON.parse(this.webrtcConfig);
        }
      } catch (e) {
        console.error('Invalid WebRTC config JSON:', e);
      }

      let signalingServerValue = this.signalingServer?.trim() || "wss://rooms.deno.dev";
      
      // Store the signaling server as an array for consistency with the WebRTC provider
      const signalingServerArray = [signalingServerValue];
      
      // Update the parent component with the new values
      this.$emit('update:config', {
        communicationMethod: this.communicationMethod,
        websocketUrl: this.websocketUrl,
        webrtcConfig: webrtcConfigValue,
        signalingServer: signalingServerArray,
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
        if (newConfig.signalingServer !== undefined) {
          if (Array.isArray(newConfig.signalingServer)) {
            // Just take the first server if there are multiple
            this.signalingServer = newConfig.signalingServer[0] || "";
          } else {
            this.signalingServer = newConfig.signalingServer;
          }
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
