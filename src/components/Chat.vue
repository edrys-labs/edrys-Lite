<script lang="ts">
import { inject } from "vue";
import markdownit from "markdown-it";
import { useI18n } from 'vue-i18n';
import { isMember, sameKey } from "../ts/Utils";

export default {
  name: "Chat",
  // me: this user's public key; teachers: the owner's and the teachers' keys
  props: ["show", "messages", "truncated", "me", "teachers"],
  emits: ["sendMessage"],

  setup() {
    const prismHighlight = inject("prismHighlight");
    const prismLanguages = inject("prismLanguages");

    const { t, locale } = useI18n();

    return {
      prismHighlight,
      prismLanguages,
      t,
      locale,
    };
  },

  data() {
    const md = markdownit({
      html: false,
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

    focusEditor() {
      const textarea = this.$refs.editor?.$el?.querySelector('textarea');
      if (textarea) textarea.focus();
    },

    permanent() {
      return window.innerWidth > 1000 + 360;
    },

    isMine(msg: { signer?: string }): boolean {
      return sameKey(msg.signer, this.me);
    },

    isFromTeacher(msg: { signer?: string }): boolean {
      return !!msg.signer && isMember(this.teachers, msg.signer);
    },

    // The time of day, with the date for messages from an earlier day.
    shortTime(timestamp: number): string {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) return String(timestamp);
      const time = date.toLocaleTimeString(this.locale, { hour: "2-digit", minute: "2-digit" });
      if (date.toDateString() === new Date().toDateString()) return time;
      return date.toLocaleDateString(this.locale, { day: "numeric", month: "short" }) + " " + time;
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
    :width="360"
    :permanent="permanent()"
    v-model="open"
    location="right"
    color="panel"
    class="chat-panel"
    @click="focusEditor"
  >
    <template v-slot:prepend>
      <div class="chat-title">
        <h2>{{ t('classroom.chat') }}</h2>
      </div>
    </template>

    <div role="log" class="chat-log">
      <div v-if="deletedMessages" class="chat-note">{{ t('chat.deletedMessage') }}</div>
      <div
        v-for="msg in history"
        :key="msg.signature"
        :class="['chat-message', { mine: isMine(msg) }]"
      >
        <div class="markdown" v-html="render(msg.id, msg.msg)"></div>
        <div class="chat-meta">
          <span class="chat-user">{{ msg.user }}</span>
          <span v-if="isMine(msg)" class="chat-you">{{ t('general.you') }}</span>
          <span v-if="isFromTeacher(msg)" class="chat-teacher">{{ t('general.roles.teacher') }}</span>
          <span aria-hidden="true">·</span>
          <time :title="toDate(msg.timestamp)">
            {{ shortTime(msg.timestamp) }}
          </time>
        </div>
      </div>
    </div>

    <template v-slot:append>
      <div class="chat-compose">
        <label for="chat-message">{{ t('chat.messagePlaceholder') }}</label>
        <textarea
          id="chat-message"
          v-model="message"
          rows="3"
          maxlength="2000"
          @keydown.enter.exact.prevent="send()"
          @keyup.ctrl.enter="send()"
        ></textarea>

        <v-btn
          append-icon="mdi-send-outline"
          color="primary"
          variant="flat"
          block
          height="40"
          rounded="lg"
          class="text-none"
          @click="send()"
        >
          {{ t('chat.sendButton') }}
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

<style scoped>
.chat-panel {
  border-inline-start: 1px solid rgb(var(--v-theme-panel-line)) !important;
}

.chat-title {
  display: flex;
  align-items: center;
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}

.chat-title h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.chat-log {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}

.chat-note {
  padding: 4px 0;
  text-align: center;
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
}

.chat-message {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgb(var(--v-theme-message));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.06), 0 0 0 1px rgb(var(--v-theme-message-edge));
  font-size: 14px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.chat-message.mine {
  background: rgb(var(--v-theme-own-message));
}

:global(.v-theme--dark) .chat-message {
  box-shadow: none;
}

/* the last paragraph of a message needs no gap below */
.chat-message :deep(.markdown > :last-child) {
  margin-bottom: 0;
}

.chat-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: rgb(var(--v-theme-muted));
}

.chat-user {
  font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
  font-weight: 500;
}

.chat-you {
  font-weight: 600;
  color: rgb(var(--v-theme-you));
}

.chat-teacher {
  padding: 1px 7px;
  border-radius: 999px;
  background: rgb(var(--v-theme-teacher-tint));
  color: rgb(var(--v-theme-teacher));
  font-weight: 600;
}

.chat-compose {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgb(var(--v-theme-panel-line));
}

.chat-compose label {
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

.chat-compose textarea {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  resize: none;
  border: 1px solid rgb(var(--v-theme-line));
  border-radius: 8px;
  background: rgb(var(--v-theme-field));
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
  line-height: 1.5;
}

.chat-compose textarea:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}
</style>
