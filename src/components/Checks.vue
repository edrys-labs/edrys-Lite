<script lang="ts">
export default {
  name: "Checks",

  props: {
    states: {
      type: Object,
      required: true,
    },
  },

  data() {
    return { model: this.check(), counter: 0 };
  },

  methods: {
    counterIncrement() {
      setTimeout(() => {
        this.counter++;
        this.counterIncrement();
      }, 1000);
    },

    check() {
      if (this.states.receivedConfiguration && !this.states.connectedToNetwork) {
        this.counterIncrement();
      } else if (this.states.connectedToNetwork) {
        this.counter = 0;
      }

      return !(
        this.states.connectedToNetwork &&
        this.states.webRTCSupport &&
        this.states.receivedConfiguration
      );
    },
  },

  watch: {
    states: {
      handler() {
        this.model = this.check();
      },
      deep: true,
    },
  },

  unmounted() {
    this.counter = 0;
  },
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

          <div>
            WebRTC-support

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

          <div>
            Configuration loaded

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
            Connected to peer 2 peer network ({{ counter }} sec.)

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
        </v-col>
      </v-row>
    </v-container>
  </v-overlay>
</template>
