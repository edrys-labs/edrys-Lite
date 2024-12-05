<script lang="ts">
import { inject } from "vue";
import markdownit from "markdown-it";

export default {
  name: "Chat",
  props: ["show", "messages", "truncated"],
  emits: ["sendMessage"],

  setup() {
    const prismHighlight = inject("prismHighlight");
    const prismLanguages = inject("prismLanguages");

    return {
      prismHighlight,
      prismLanguages,
    };
  },

  data() {
    const md = markdownit({
      html: true,
      linkify: true,
      typographer: true,
      highlight: (code: string, lang: string) => {
        if (lang && this.prismLanguages[lang]) {
          try {
            const highlighted = this.prismHighlight(
              code,
              this.prismLanguages[lang],
              lang
            );
            return `<pre class="language-${lang}"><code class="language-${lang}">${highlighted}</code></pre>`;
          } catch (e) {
            console.error(`Error highlighting code for language '${lang}':`, e);
          }
        }
        return `<pre><code>${md.utils.escapeHtml(code)}</code></pre>`;
      },
    });

    return {
      message: "",
      open: this.show,
      history: this.messages,
      deletedMessages: this.truncated,
      md,
    };
  },

  watch: {
    show() {
      this.open = this.show;
    },
    messages() {
      this.history = this.messages;
    },
    truncated() {
      this.deletedMessages = this.truncated;
    },
  },

  methods: {
    highlighter(code) {
      // Use fallback-safe values
      if (!this.prismHighlight || !this.prismLanguages.markdown) {
        console.error("Prism not properly injected.");
        return code;
      }
      return this.prismHighlight(code, this.prismLanguages.markdown, "markdown");
    },

    permanent() {
      return window.innerWidth > 1000 + 400;
    },

    send() {
      if (this.message.trim() !== "") {
        //this.history.push({ id: Date.now(), msg: this.message, name: "sadfasfdasfd" });

        this.$emit("sendMessage", this.message.trim());
        this.message = "";
      }
    },

    render(key: string, code: string) {
      return this.md.render(code);
    },

    toDate(timestamp: number): string {
      try {
        const date = new Date(timestamp);
        return date.toLocaleString();
      } catch (e) {}

      return timestamp.toString();
    },
  },
};
</script>

<template>
  <v-navigation-drawer
    :width="400"
    :permanent="permanent()"
    v-model="open"
    location="right"
  >
    <v-container>
      <v-row align="center" justify="center">
        <v-col
          cols="12"
          style="padding: 15px 0.5rem 15px 0.5rem"
          v-if="this.deletedMessages"
        >
          <div>previous messages have been deleted ...</div>
        </v-col>
        <v-col
          v-for="msg in history"
          :key="msg.timestamp"
          cols="12"
          style="padding: 5px 0.5rem 5px 0.5rem"
        >
          <v-card variant="elevated" class="mx-auto">
            <v-card-text style="padding-bottom: 3px">
              <div class="markdown" v-html="render(msg.id, msg.msg)"></div>

              <p
                class="text-end text-decoration-overline"
                style="font-size: 10px; color: gray; margin-top: -10px"
              >
                {{ toDate(msg.timestamp) }} / {{ msg.user }}
              </p>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>
    </v-container>
    <template v-slot:append>
      <div class="pa-2">
        <prism-editor
          v-model="message"
          :highlight="highlighter"
          :readonly="false"
          rows="4"
          @keyup.ctrl.enter="send()"
          style="height: 100px; border: 1px solid black; padding: 2px 5px"
        ></prism-editor>

        <!--v-textarea
          counter
          no-resize
          rows="4"
          v-model="message"
          maxlength="2000"
          @keyup.ctrl.enter="send()"
        >
        </v-textarea-->

        <v-btn
          append-icon="mdi-send-outline"
          depressed
          block
          class="mb-2"
          @click="send()"
        >
          Send
        </v-btn>
      </div>
    </template>
  </v-navigation-drawer>
</template>

<style>
ul li {
  margin-left: 1em !important;
}

ol li {
  margin-left: 1.2em !important;
}

.markdown > * {
  margin-bottom: 12px;
}

.markdown {
  overflow: auto;
}
</style>
