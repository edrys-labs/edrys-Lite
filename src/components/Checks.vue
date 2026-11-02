<script lang="ts">
import { useI18n } from 'vue-i18n';
import { decodeCommConfig } from '../ts/Utils';

export default {
  name: "Checks",

  props: {
    states: {
      type: Object,
      required: true,
    },

    className: {
      type: String,
      default: "",
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    return { 
      model: true, // Start with overlay visible
      counter: 0,
      communicationMethod: null, // Start with null to avoid showing any method until detected
      checkRunning: false,
      manuallyDismissed: false, // Track if user manually dismissed the error
    };
  },

  mounted() {
    this.$nextTick(() => {
      this.detectCommunicationMethod();
    });
  },

  beforeUnmount() {
    this.checkRunning = false;
    this.counter = 0;
  },

  methods: {
    statusLabel(state?: boolean) {
      if (state === true) return this.t('checks.status.ok');
      if (state === false) return this.t('checks.status.failed');
      return this.t('checks.status.pending');
    },

    stateClass(state?: boolean) {
      if (state === true) return 'state--ok';
      if (state === false) return 'state--failed';
      return 'state--pending';
    },

    dismissError() {
      this.manuallyDismissed = true;
      this.model = false;
    },

    detectCommunicationMethod() {
      try {
        // Get communication method directly from parent configuration
        const encodedConfig = this.$parent?.configuration?.data?.communicationConfig;
        
        if (encodedConfig) {
          const commConfig = decodeCommConfig(encodedConfig);
          
          if (commConfig && commConfig.communicationMethod) {
            const configMethod = commConfig.communicationMethod;
            
            // Only update if it's different to prevent unnecessary re-renders
            if (this.communicationMethod !== configMethod) {
              this.communicationMethod = configMethod;
              
              // Re-evaluate the check with the new method
              this.model = this.check();
            }
          }
        }
      } catch (e) {
        console.error('Error detecting communication method:', e);
      }
    },

    counterIncrement() {
      if (this.checkRunning) return;
      
      this.checkRunning = true;
      
      const incrementer = () => {
        const incrementTimer = setInterval(() => {
          if (this.states.connectedToNetwork) {
            clearInterval(incrementTimer);
            this.counter = 0;
            this.checkRunning = false;
          } else {
            this.counter++;
          }
        }, 1000);
      };
      
      incrementer();
    },

    check() {
      // Always detect communication method when checking
      this.detectCommunicationMethod();

      // If method is not yet determined, default to 'WebRTC'
      if (this.communicationMethod === null) {
        this.communicationMethod = 'WebRTC';
      }
      
      // Start counting if config loaded but not connected
      if (this.states.receivedConfiguration && !this.states.connectedToNetwork && !this.checkRunning) {
        this.counterIncrement();
      }

      // If user manually dismissed the error, keep overlay hidden
      if (this.manuallyDismissed) {
        return false;
      }

      // Only hide overlay when all checks pass
      return !(
        this.states.connectedToNetwork && 
        (this.communicationMethod !== 'WebRTC' || this.states.webRTCSupport) && 
        this.states.receivedConfiguration
      );
    },
  },

  computed: {
    connectivityLabel() {
      if (!this.communicationMethod) return '';
      
      return this.communicationMethod === 'WebRTC' 
        ? this.t('checks.connected.webrtc')
        : this.t('checks.connected.websocket');
    },
    
    showWebRTCCheck() {
      return this.communicationMethod === 'WebRTC';
    },

    hasWebRTCError() {
      // WebRTC is required but not supported
      return this.communicationMethod === 'WebRTC' && this.states.webRTCSupport === false;
    }
  },

  watch: {
    states: {
      handler() {
        this.model = this.check();
      },
      deep: true,
    },
    
    // Watch parent configuration for changes
    '$parent.configuration.data.communicationConfig': {
      handler() {
        this.detectCommunicationMethod();
      },
      deep: true
    }
  }
};
</script>

<template>
  <v-overlay
    v-model="model"
    class="align-center justify-center"
    scrim="rgb(20, 25, 35)"
    style="z-index: 1000"
  >
    <!-- WebRTC is required but not supported -->
    <v-card v-if="hasWebRTCError" class="checks checks--error" role="alertdialog" aria-labelledby="checks-title">
      <div class="checks-head">
        <div class="error-badge">
          <v-icon icon="mdi-alert-circle-outline" size="24"></v-icon>
        </div>
        <h2 id="checks-title">{{ t('modules.webrtcNotSupported.title') }}</h2>
        <v-btn
          icon="mdi-close"
          size="36"
          variant="text"
          class="close-btn"
          :aria-label="t('classroom.popup.close')"
          :title="t('classroom.popup.close')"
          @click="dismissError"
        ></v-btn>
      </div>

      <p class="lead">{{ t('modules.webrtcNotSupported.message') }}</p>

      <section>
        <h3>{{ t('modules.webrtcNotSupported.ifStudent') }}</h3>
        <p>{{ t('modules.webrtcNotSupported.studentAction') }}</p>
      </section>

      <section>
        <h3>{{ t('modules.webrtcNotSupported.ifTeacher') }}</h3>
        <p>{{ t('modules.webrtcNotSupported.teacherAction') }}</p>
        <p class="note">{{ t('modules.webrtcNotSupported.note') }}</p>
      </section>
    </v-card>

    <!-- Normal loading state -->
    <v-card v-else class="checks" role="dialog" aria-labelledby="checks-title">
      <div class="checks-head">
        <svg class="spinner" width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
          <circle cx="24" cy="24" r="21" fill="none" class="spinner-track" stroke-width="3.5"></circle>
          <path class="spinner-arc" d="M24 3a21 21 0 0 1 21 21" fill="none" stroke-width="3.5" stroke-linecap="round"></path>
          <g transform="translate(12 12)">
            <ellipse cx="12" cy="12.5" rx="10.5" ry="4.2" fill="none" stroke="currentColor" stroke-width="2" transform="rotate(14 12 12.5)"></ellipse>
            <circle cx="7.8" cy="7.4" r="3.5" fill="currentColor"></circle>
            <circle cx="15.2" cy="15.6" r="5" fill="currentColor"></circle>
          </g>
        </svg>
        <div class="checks-title">
          <h2 id="checks-title">{{ t('checks.connecting') }}</h2>
          <div v-if="className" class="class-name">{{ className }}</div>
        </div>
      </div>

      <ul v-if="communicationMethod !== null">
        <li v-if="showWebRTCCheck">
          <span :class="['state', stateClass(states.webRTCSupport)]" aria-hidden="true">
            <v-icon v-if="states.webRTCSupport === true" icon="mdi-check" size="15"></v-icon>
            <v-icon v-else-if="states.webRTCSupport === false" icon="mdi-close" size="15"></v-icon>
          </span>
          <span class="label">{{ t('checks.webRTCSupport') }}</span>
          <span class="status">{{ statusLabel(states.webRTCSupport) }}</span>
        </li>
        <li>
          <span :class="['state', stateClass(states.receivedConfiguration)]" aria-hidden="true">
            <v-icon v-if="states.receivedConfiguration === true" icon="mdi-check" size="15"></v-icon>
            <v-icon v-else-if="states.receivedConfiguration === false" icon="mdi-close" size="15"></v-icon>
          </span>
          <span class="label">{{ t('checks.configLoaded') }}</span>
          <span class="status">{{ statusLabel(states.receivedConfiguration) }}</span>
        </li>
        <li>
          <span :class="['state', stateClass(states.connectedToNetwork)]" aria-hidden="true">
            <v-icon v-if="states.connectedToNetwork === true" icon="mdi-check" size="15"></v-icon>
            <v-icon v-else-if="states.connectedToNetwork === false" icon="mdi-close" size="15"></v-icon>
          </span>
          <span class="label">{{ connectivityLabel }}<span class="nowrap">{{ counter }} {{ t('checks.connected.2') }}</span></span>
          <span class="status">{{ statusLabel(states.connectedToNetwork) }}</span>
        </li>
      </ul>

      <p v-if="communicationMethod !== null" class="note">
        {{ showWebRTCCheck ? t('checks.note.webrtc') : t('checks.note.websocket') }}
      </p>
    </v-card>
  </v-overlay>
</template>

<style scoped>
.checks {
  width: 420px;
  max-width: calc(100vw - 32px);
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 28px;
}

.checks--error {
  width: 520px;
  gap: 14px;
}

.checks-head {
  display: flex;
  align-items: center;
  gap: 14px;
}

.checks-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.checks h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.checks--error h2 {
  flex: 1;
}

.class-name {
  font-size: 13px;
  color: rgb(var(--v-theme-muted));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.spinner {
  flex-shrink: 0;
  color: rgb(var(--v-theme-on-surface));
}

.spinner-track {
  stroke: rgb(var(--v-theme-track));
}

.spinner-arc {
  stroke: rgb(var(--v-theme-spinner));
  transform-origin: 24px 24px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .spinner-arc,
  .state--pending {
    animation-duration: 3s;
  }
}

ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgb(var(--v-theme-subtle));
}

.label {
  flex: 1;
  font-size: 14px;
  font-weight: 500;
}

.nowrap {
  white-space: nowrap;
}

.status {
  white-space: nowrap;
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
}

/* a check's state: done (tick), failed (cross) or a small spinner */
.state {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border-radius: 999px;
}

.state--ok {
  background: rgb(var(--v-theme-success-tint));
  color: rgb(var(--v-theme-success));
}

.state--failed {
  background: rgb(var(--v-theme-danger-tint));
  color: rgb(var(--v-theme-error));
}

.state--pending {
  border: 2.5px solid rgb(var(--v-theme-track));
  border-top-color: rgb(var(--v-theme-muted));
  transform: scale(0.8);
  animation: spin 1s linear infinite;
}

.note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: rgb(var(--v-theme-muted));
}

.checks--error p {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
}

.checks--error .lead {
  font-weight: 600;
}

.checks--error section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.checks--error h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}

.checks--error .note {
  font-size: 12px;
}

.error-badge {
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: rgb(var(--v-theme-danger-tint));
  color: rgb(var(--v-theme-error));
}

.close-btn {
  color: rgb(var(--v-theme-muted));
}
</style>
