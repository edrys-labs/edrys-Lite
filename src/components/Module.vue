<template>
  <div style="height: 100%; width: 100%" :key="scrapedModule.url">
    <iframe
      style="height: 100%; width: 100%"
      :key="liveClassProxy.users[username].room"
      :src="
        scrapedModule.srcdoc
          ? scrapedModule.srcdoc
          : scrapedModule.url.startsWith('data:')
          ? null
          : scrapedModule.url
      "
      :srcdoc="
        !scrapedModule.srcdoc
          ? null
          : scrapedModule.url.startsWith('data:')
          ? scrapedModule.url
          : null
      "
      allow="camera; microphone; fullscreen; display-capture; accelerometer; autoplay; encrypted-media; geolocation; gyroscope; magnetometer; midi; serial; vr; clipboard-read; clipboard-write"
      @load="loadFrame"
      ref="iframe"
      frameborder="0"
    ></iframe>
  </div>
</template>

<script lang="ts">
import { debug } from "../api/debugHandler";

export default {
  name: "Module",
  props: {
    role: {
      type: String,
      required: true,
    },

    username: {
      type: String,
      required: true,
    },

    liveClassProxy: {
      type: Object,
      required: true,
    },

    scrapedModule: {
      type: Object,
      required: true,
    },

    class_id: {
      type: String,
      required: true,
    },
  },
  data() {
    return { loaded: false };
  },
  computed: {
    iframeOrigin() {
      return new URL(this.scrapedModule.url).origin;
    },
  },
  watch: {
    liveClassProxy() {
      if (this.loaded) this.updateIframe();
    },
  },

  methods: {
    loadFrame() {
      debug.components.module("Module loaded", this.scrapedModule.url);
      this.updateIframe();
    },
    updateIframe() {
      try {
        this.$refs.iframe.contentWindow.postMessage(
          {
            event: "update",
            origin: window.origin,
            role: this.role,
            username: this.username,
            liveClass: this.liveClassProxy.doc,
            // awareness: this.liveClassProxy.awareness,
            module: JSON.parse(JSON.stringify(this.scrapedModule)),
            class_id: this.class_id,
          },
          this.scrapedModule.origin || this.iframeOrigin
        );
      } catch (e) {
        console.error("Module update", e);
      }

      if (!this.loaded) {
        this.loaded = true;
      }
    },
  },
};
</script>

<style scoped></style>
