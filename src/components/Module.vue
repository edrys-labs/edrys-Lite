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
      @load="updateIframe"
      ref="iframe"
      frameborder="0"
    ></iframe>
  </div>
</template>

<script lang="ts">
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
    return {};
  },
  computed: {
    iframeOrigin() {
      return new URL(this.scrapedModule.url).origin;
    },
  },
  watch: {
    liveClassProxy() {
      this.updateIframe();
    },
  },

  methods: {
    updateIframe() {
      //console.warn("updateIframe", typeof this.liveClassProxy_);

      try {
        this.$refs.iframe.contentWindow.postMessage(
          {
            event: "update",
            origin: window.origin,
            role: this.role,
            username: this.username,
            liveClass: JSON.parse(JSON.stringify(this.liveClassProxy)),
            module: JSON.parse(JSON.stringify(this.scrapedModule)),
            class_id: this.class_id,
          },
          this.scrapedModule.origin || this.iframeOrigin
        );
      } catch (e) {
        console.warn(e);
      }
    },
  },
};
</script>

<style scoped></style>
