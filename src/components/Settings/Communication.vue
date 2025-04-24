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
    
    <v-divider class="my-4"></v-divider>
    
    <div v-if="!writeProtection">
      <h3 class="text-h6 mb-2">{{ $t('settings.communication.shareLink.title') }}</h3>
      <p class="text-body-2 mb-3">{{ $t('settings.communication.shareLink.description') }}</p>
      
      <v-text-field
        v-model="shareableLink"
        :label="$t('settings.communication.shareLink.linkLabel')"
        readonly
        :append-icon="copied ? 'mdi-check' : 'mdi-content-copy'"
        @click:append="copyShareableLink"
      ></v-text-field>
      
      <v-btn 
        color="primary" 
        class="mt-2" 
        @click="generateShareableLink"
        :loading="generatingLink"
      >
        <v-icon left>mdi-link-variant</v-icon>
        {{ $t('settings.communication.shareLink.generate') }}
      </v-btn>
    </div>
  </v-container>
</template>

<script lang="ts">
import { encodeCommConfig, decodeCommConfig } from "../../ts/Utils";

export default {
  name: "Settings-Communication",

  props: {
    config: {
      type: String,  
      required: true,
    },
    writeProtection: {
      type: Boolean,
      required: true,
    },
    classId: {
      type: String,
      required: true,
    }
  },

  data() {
    return {
      communicationMethod: "WebRTC", // Default to WebRTC
      websocketUrl: "",
      webrtcConfig: "",
      signalingServer: "",
      shareableLink: "",
      copied: false,
      generatingLink: false,
    };
  },

  created() {
    let decodedConfig: any = {};
    
    if (this.config) {
      decodedConfig = decodeCommConfig(this.config) || {};
    }
    
    if (decodedConfig.communicationMethod) {
      this.communicationMethod = decodedConfig.communicationMethod;
    }
    if (decodedConfig.websocketUrl) {
      this.websocketUrl = decodedConfig.websocketUrl;
    }
    if (decodedConfig.signalingServer) {
      if (Array.isArray(decodedConfig.signalingServer)) {
        this.signalingServer = decodedConfig.signalingServer[0] || "wss://rooms.deno.dev";
      } else {
        this.signalingServer = decodedConfig.signalingServer;
      }
    } else {
      // Default signaling server
      this.signalingServer = "wss://rooms.deno.dev";
    }
    if (decodedConfig.webrtcConfig) {
      this.webrtcConfig = typeof decodedConfig.webrtcConfig === 'string' 
        ? decodedConfig.webrtcConfig 
        : JSON.stringify(decodedConfig.webrtcConfig, null, 2);
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
  },

  methods: {
    updateConfig() {
      if (this.writeProtection) return;
      
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
      
      const commConfig = {
        communicationMethod: this.communicationMethod,
        websocketUrl: this.websocketUrl,
        webrtcConfig: webrtcConfigValue,
        signalingServer: signalingServerArray,
      };
      
      const encodedConfig = encodeCommConfig(commConfig);
      
      this.$emit('update:config', encodedConfig);
    },
    
    async generateShareableLink() {
      this.generatingLink = true;
      try {
        // Get the current configuration and prepare for encoding in URL
        let configToEncode = {
          communicationMethod: this.communicationMethod,
          websocketUrl: this.communicationMethod === 'Websocket' ? this.websocketUrl : undefined,
          webrtcConfig: this.communicationMethod === 'WebRTC' ? 
            (typeof this.webrtcConfig === 'string' ? JSON.parse(this.webrtcConfig) : this.webrtcConfig) : undefined,
          signalingServer: this.communicationMethod === 'WebRTC' ? [this.signalingServer] : undefined
        };
        
        // Clean up undefined values
        Object.keys(configToEncode).forEach(key => 
          configToEncode[key] === undefined && delete configToEncode[key]
        );
        
        const jsonConfig = JSON.stringify(configToEncode);
        const encodedConfig = btoa(encodeURIComponent(jsonConfig));
        
        const urlBase = window.location.origin + window.location.pathname;
        this.shareableLink = `${urlBase}?/classroom/${this.classId}#comm=${encodedConfig}`;
      } catch (e) {
        console.error('Error generating shareable link:', e);
        this.shareableLink = 'Error generating link. Please check your configuration.';
      }
      this.generatingLink = false;
    },
    
    copyShareableLink() {
      if (!this.shareableLink) return;
      
      navigator.clipboard.writeText(this.shareableLink)
        .then(() => {
          this.copied = true;
          setTimeout(() => {
            this.copied = false;
          }, 2000);
        })
        .catch(err => {
          console.error('Failed to copy link: ', err);
        });
    }
  },

  watch: {
    communicationMethod() {
      this.updateConfig();
    },
    
    // Watch for config changes from parent
    config: {
      handler(newConfig) {
        if (!newConfig || this.lastEmittedConfig === newConfig) return;
        
        const decodedConfig = decodeCommConfig(newConfig) || {};
        
        // Update fields if config changed externally
        if (decodedConfig.communicationMethod !== undefined) {
          this.communicationMethod = decodedConfig.communicationMethod;
        }
        if (decodedConfig.websocketUrl !== undefined) {
          this.websocketUrl = decodedConfig.websocketUrl;
        }
        if (decodedConfig.signalingServer !== undefined) {
          if (Array.isArray(decodedConfig.signalingServer)) {
            // Just take the first server if there are multiple
            this.signalingServer = decodedConfig.signalingServer[0] || "";
          } else {
            this.signalingServer = decodedConfig.signalingServer;
          }
        }
        if (decodedConfig.webrtcConfig !== undefined) {
          this.webrtcConfig = typeof decodedConfig.webrtcConfig === 'string' 
            ? decodedConfig.webrtcConfig 
            : JSON.stringify(decodedConfig.webrtcConfig, null, 2);
        }
      }
    }
  },
};
</script>
