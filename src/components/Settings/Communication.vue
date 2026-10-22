<template>
  <v-container>
    <v-select
      v-model="communicationMethod"
      :items="['WebRTC', 'Websocket']"
      :label="$t('settings.communication.labels.method')"
      @change="updateConfig"
    ></v-select>

    <v-text-field
      v-if="communicationMethod === 'Websocket'"
      v-model="websocketUrl"
      :label="$t('settings.communication.labels.websocketServer')"
      placeholder="wss://demos.yjs.dev"
      @change="updateConfig"
    ></v-text-field>

    <template v-if="communicationMethod === 'WebRTC'">
      <v-text-field
        v-model="signalingServer"
        :label="$t('settings.communication.labels.webrtcSignaling')"
        placeholder="wss://rooms.deno.dev"
        @change="updateConfig"
      ></v-text-field>

      <v-textarea
        v-model="webrtcConfig"
        :label="$t('settings.communication.labels.webrtcConfig')"
        placeholder='{"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}'
        rows="5"
        @change="updateConfig"
      ></v-textarea>
    </template>
    
    <v-divider class="my-4 border-opacity-50" color="primary"></v-divider>
    
    <div>
      <h3 class="text-h6 mb-2 font-weight-bold">{{ $t('settings.communication.shareLink.title') }}</h3>
      <p class="text-body-2 mb-3">{{ $t('settings.communication.shareLink.description') }}</p>
      
      <v-text-field
        v-model="shareableLink"
        :label="$t('settings.communication.shareLink.linkLabel')"
        readonly
        :append-icon="copied ? 'mdi-check' : 'mdi-content-copy'"
        @click:append="copyShareableLink"
      ></v-text-field>

      <v-checkbox
        v-model="keepConfigInUrl"
        :label="$t('settings.communication.keepConfigInUrl.label')"
        :hint="$t('settings.communication.keepConfigInUrl.hint')"
        @change="updateKeepConfigPreference"
        class="mt-2"
        color="primary"
      ></v-checkbox>
    </div>

    <v-alert
      variant="tonal"
      density="compact"
      color="#1565c0"
      icon="mdi-information"
      class="my-4"
    >
      {{ $t("settings.communication.alert.first") }}
      <br />
      {{ $t("settings.communication.alert.second") }}
    </v-alert>
  </v-container>
</template>

<script lang="ts">
import { encodeCommConfig, 
  decodeCommConfig, 
  updateUrlWithCommConfig, 
  cleanUrlAfterCommConfigExtraction 
} from "../../ts/Utils";

export default {
  name: "Settings-Communication",

  props: {
    config: {
      type: String,
      required: true,
    },
    classId: {
      type: String,
      required: true,
    },
    keepUrlConfig: {
      type: Boolean,
      default: false,
    }
  },

  emits: ["update:config", "update:keepUrlConfig"],

  data() {
    return {
      communicationMethod: "WebRTC", // Default to WebRTC
      websocketUrl: "",
      webrtcConfig: "",
      signalingServer: "",
      shareableLink: "",
      copied: false,
      lastEmittedConfig: "",
      keepConfigInUrl: false,
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
        this.signalingServer = decodedConfig.signalingServer[0] || "";
      } else {
        this.signalingServer = decodedConfig.signalingServer;
      }
    }
    if (decodedConfig.webrtcConfig) {
      this.webrtcConfig = typeof decodedConfig.webrtcConfig === 'string' 
        ? decodedConfig.webrtcConfig 
        : JSON.stringify(decodedConfig.webrtcConfig, null, 2);
    }

    // Initialize the checkbox from the prop
    this.keepConfigInUrl = this.keepUrlConfig;

    // Generate initial shareable link
    this.generateShareableLink();
  },

  methods: {
    buildCommConfig() {
      let webrtcConfigValue = this.webrtcConfig;
      
      try {
        if (typeof this.webrtcConfig === 'string' && this.webrtcConfig.trim() !== '') {
          webrtcConfigValue = JSON.parse(this.webrtcConfig);
        } else if (this.webrtcConfig.trim() === '') {
          webrtcConfigValue = undefined;
        }
      } catch (e) {
        console.error('Invalid WebRTC config JSON:', e);
      }

      let signalingServerValue = this.signalingServer?.trim() || undefined;
      
      // Store the signaling server as an array for consistency with the WebRTC provider, only if it has a value
      const signalingServerArray = signalingServerValue ? [signalingServerValue] : undefined;
      
      const commConfig = {
        communicationMethod: this.communicationMethod,
        websocketUrl: this.websocketUrl.trim() || undefined,
        webrtcConfig: webrtcConfigValue,
        signalingServer: signalingServerArray,
      };
      
      // Clean up undefined values
      Object.keys(commConfig).forEach(key => commConfig[key] === undefined && delete commConfig[key]);
      
      return commConfig;
    },

    updateConfig() {
      const commConfig = this.buildCommConfig();
      const encodedConfig = encodeCommConfig(commConfig);
      this.lastEmittedConfig = encodedConfig;
      
      this.$emit('update:config', encodedConfig);
      
      // Regenerate the shareable link whenever the config changes
      this.generateShareableLink();
    },
    
    generateShareableLink() {
      try {
        const commConfig = this.buildCommConfig();
        const encodedConfig = encodeCommConfig(commConfig);
        
        const urlBase = window.location.origin + window.location.pathname;

        // Keep the /:owner segment of the current URL: the owner hash is the
        // first-join trust anchor.
        const anchor =
          (window.location.search || "").match(
            /^\?\/(?:classroom|station)\/[^/?#]+(\/[^/?#]+)?/
          )?.[1] || "";
        const link = `${urlBase}?/classroom/${this.classId}${anchor}`;

        // Only append comm parameter if there's actually encoded config
        this.shareableLink = encodedConfig ? `${link}#comm=${encodedConfig}` : link;
      } catch (e) {
        console.error('Error generating shareable link:', e);
        this.shareableLink = this.$t('settings.communication.shareLink.error');
      }
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
    },

    updateKeepConfigPreference() {
      this.$emit('update:keepUrlConfig', this.keepConfigInUrl);
    },

    onSettingsSaved() {
      const commConfig = this.buildCommConfig();
      
      // Update URL with current config if keepConfigInUrl is checked
      if (this.keepConfigInUrl) {
        updateUrlWithCommConfig(commConfig);
      } else {
        // Clean URL if keepConfigInUrl is unchecked
        cleanUrlAfterCommConfigExtraction(true);
      }
    }
  },

  watch: {
    communicationMethod() {
      this.updateConfig();
    },
    
    websocketUrl() {
      this.updateConfig();
    },
    
    signalingServer() {
      this.updateConfig();
    },
    
    webrtcConfig() {
      this.updateConfig();
    },
  },
};
</script>
