<template>
  <h3 class="section-title">{{ $t('settings.communication.title') }}</h3>
  <p class="section-text">{{ $t('settings.communication.text') }}</p>

  <div role="radiogroup" :aria-label="$t('settings.communication.labels.method')" class="method">
    <label v-for="method in methods" :key="method" :class="['method-option', { selected: communicationMethod === method }]">
      <input type="radio" name="communication-method" :value="method" v-model="communicationMethod" />
      {{ method }}
    </label>
  </div>

  <div class="fields">
    <FieldLabel
      v-if="communicationMethod === 'Websocket'"
      :label="$t('settings.communication.labels.websocketServer')"
    >
      <v-text-field
        v-model="websocketUrl"
        placeholder="wss://demos.yjs.dev"
        hide-details
        class="mono"
      ></v-text-field>
    </FieldLabel>

    <template v-if="communicationMethod === 'WebRTC'">
      <FieldLabel :label="$t('settings.communication.labels.webrtcSignaling')">
        <v-text-field
          v-model="signalingServer"
          placeholder="wss://rooms.deno.dev"
          hide-details
          class="mono"
        ></v-text-field>
      </FieldLabel>

      <FieldLabel :label="$t('settings.communication.labels.webrtcConfig')">
        <v-textarea
          v-model="webrtcConfig"
          placeholder='{"iceServers": [{"urls": ["stun:stun.l.google.com:19302"]}]}'
          rows="3"
          no-resize
          hide-details
          class="mono"
        ></v-textarea>
      </FieldLabel>
    </template>
  </div>

  <v-divider class="my-5"></v-divider>

  <h3 class="section-title">{{ $t('settings.communication.shareLink.title') }}</h3>
  <p class="section-text">{{ $t('settings.communication.shareLink.description') }}</p>

  <FieldLabel :label="$t('settings.communication.shareLink.linkLabel')">
    <v-text-field v-model="shareableLink" readonly hide-details class="mono">
      <template v-slot:append-inner>
        <v-btn
          :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
          variant="text"
          density="comfortable"
          :aria-label="$t('general.copyLink')"
          :title="$t('general.copyLink')"
          @click="copyShareableLink"
        ></v-btn>
      </template>
    </v-text-field>
  </FieldLabel>

  <v-checkbox
    v-model="keepConfigInUrl"
    :label="$t('settings.communication.keepConfigInUrl.label')"
    aria-describedby="keep-config-hint"
    hide-details
    density="compact"
    @change="updateKeepConfigPreference"
    class="keep-config"
    color="primary"
  ></v-checkbox>
  <p id="keep-config-hint" class="keep-config-hint">{{ $t('settings.communication.keepConfigInUrl.hint') }}</p>
</template>

<script lang="ts">
import { encodeCommConfig, 
  decodeCommConfig, 
  updateUrlWithCommConfig, 
  cleanUrlAfterCommConfigExtraction
} from "../../ts/Utils";
import { studentLink } from "../../ts/DevBridge";
import FieldLabel from "../FieldLabel.vue";

export default {
  name: "Settings-Communication",
  components: { FieldLabel },

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
      methods: ["WebRTC", "Websocket"],
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
        const shared = encodedConfig ? `${link}#comm=${encodedConfig}` : link;
        // edrys-dev: on the site students join on (with --local, nobody else can)
        this.shareableLink = studentLink(shared, this.classId) ?? shared;
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

<style scoped>
.method {
  display: inline-flex;
  gap: 3px;
  padding: 3px;
  border-radius: 10px;
  background: rgb(var(--v-theme-tonal));
}

.method-option {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 0 16px;
  border-radius: 8px;
  color: rgb(var(--v-theme-muted));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.method-option.selected {
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.12), 0 0 0 1px rgb(var(--v-theme-row-edge));
  color: rgb(var(--v-theme-on-surface));
  font-weight: 600;
}

/* the native radio stays for keyboard and screen readers, the label is the look */
.method-option input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.method-option:has(input:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: start;
  gap: 24px;
  margin-top: 16px;
}

/* the box lines up with the field edge above, the hint with the label */
.keep-config {
  margin-top: 12px;
  margin-inline-start: -6px;
}

.keep-config :deep(.v-label) {
  font-size: 13px;
  font-weight: 500;
  opacity: 1;
}

.keep-config-hint {
  margin: -4px 0 0;
  padding-inline-start: 22px;
  font-size: 12px;
  line-height: 1.4;
  color: rgb(var(--v-theme-muted));
}

.mono :deep(input),
.mono :deep(textarea) {
  font-family: "JetBrains Mono Variable", monospace;
  font-size: 13px;
}

@media (max-width: 599px) {
  .fields {
    grid-template-columns: 1fr;
  }
}
</style>
