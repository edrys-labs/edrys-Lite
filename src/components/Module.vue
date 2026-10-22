<template>
  <div style="height: 100%; width: 100%" :key="scrapedModule.url">
    <iframe
      style="height: 100%; width: 100%"
      :title="scrapedModule.name"
      :key="liveClassProxy.users[username].room"
      :src="
        scrapedModule.srcdoc
          ? scrapedModule.srcdoc
          : scrapedModule.url.startsWith('data:')
          ? null
          : scrapedModule.url
      "
      allow="camera; microphone; fullscreen *; display-capture; accelerometer; autoplay; encrypted-media; geolocation; gyroscope; magnetometer; midi; serial; vr; clipboard-read; clipboard-write"
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
  emits: ["loaded"],
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
    targetOrigin() {
      return this.scrapedModule.origin || this.iframeOrigin;
    },
    loadFrame() {
      debug.components.module("Module loaded", this.scrapedModule.url);
      this.updateIframe();
      // liveClassProxy.doc is the doc as of the last room update; changes
      // relayed since then went to the old page. Ask for a current one. The
      // frame and its origin let the parent seed it with current awareness.
      this.$emit("loaded", this.$refs.iframe?.contentWindow, this.targetOrigin());
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
            // Present users are not in the doc; the parent hands over the verified view.
            users: JSON.parse(JSON.stringify(this.liveClassProxy.users)),
            module: JSON.parse(JSON.stringify(this.scrapedModule)),
            class_id: this.class_id,
          },
          this.targetOrigin()
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
