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
      checkRunning: false
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
  <v-overlay v-model="model" style="background-color: rgba(0, 0, 0, 0.6); z-index: 1000">
    <v-container>
      <v-row
        justify="center"
        align="center"
        style="color: white; width: 100vw; height: 70vh"
      >
        <v-col cols="12" sm="12" md="4" justify="center" align="center">
          <v-progress-circular
            indeterminate
            :size="88"
            :width="7"
            justify="center"
            align="center"
          ></v-progress-circular>

          <div v-if="communicationMethod !== null">
            <div v-if="showWebRTCCheck">
              {{ t('checks.webRTCSupport') }}

              <v-btn
                class="ma-5"
                size="x-small"
                color="success"
                icon="mdi-check"
                v-if="states.webRTCSupport === true"
              ></v-btn>

              <v-btn
                class="ma-5"
                size="x-small"
                color="error"
                icon="mdi-close"
                v-if="states.webRTCSupport === false"
              ></v-btn>
            </div>

            <div v-if="!showWebRTCCheck">
              <v-chip color="primary" class="ma-2">{{ t('checks.usingWebsocket') }}</v-chip>
            </div>

            <div>
              {{ t('checks.configLoaded') }}

              <v-btn
                class="ma-5"
                size="x-small"
                color="success"
                icon="mdi-check"
                v-if="states.receivedConfiguration === true"
              ></v-btn>

              <v-btn
                class="ma-5"
                size="x-small"
                color="error"
                icon="mdi-close"
                v-if="states.receivedConfiguration === false"
              ></v-btn>
            </div>

            <div>
              {{ connectivityLabel }} {{ counter }} {{ t('checks.connected.2') }}

              <v-btn
                class="ma-5"
                size="x-small"
                color="success"
                icon="mdi-check"
                v-if="states.connectedToNetwork === true"
              ></v-btn>

              <v-btn
                class="ma-5"
                size="x-small"
                color="error"
                icon="mdi-close"
                v-if="states.connectedToNetwork === false"
              ></v-btn>
            </div>
          </div>
        </v-col>
      </v-row>
    </v-container>
  </v-overlay>
</template>
