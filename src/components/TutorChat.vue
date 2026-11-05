<script lang="ts">
import markdownit from "markdown-it";
import { markRaw } from "vue";
import { useI18n } from "vue-i18n";
import { useDisplay, useRtl } from "vuetify";
import { infoHash } from "../ts/Utils";
import { TEXT_MAX, sealQuestion, tutorAnswer } from "../ts/Tutor";

// a question without an answer by then gets an error; edrys-dev answers or
// gives up within about 160 s (30 s waiting for a run, 10 s room state, 120 s run)
const ANSWER_MS = 3 * 60_000;

type Entry = { id: string; from: "student" | "tutor"; text: string; error?: boolean };

/**
 * The student's chat with the tutor of edrys-dev --tutor (see ts/Tutor.ts).
 * The thread is this tab's, kept for its reloads; edrys-dev keeps its own copy.
 */
export default {
  name: "TutorChat",
  props: ["show", "communication", "tutorId", "tutorKey", "owner", "classId"],
  emits: ["update:show", "answered"],

  setup() {
    const { t } = useI18n();
    // on phones the tutor is a page of its own, like the class chat
    const { xs: phone } = useDisplay();
    const { isRtl: rtl } = useRtl();
    return { t, phone, rtl };
  },

  data() {
    return {
      message: "",
      entries: this.load() as Entry[],
      // the question waiting for its answer, by id, and the key the answer comes under
      pending: null as string | null,
      answerKey: null as CryptoKey | null,
      timer: undefined as ReturnType<typeof setTimeout> | undefined,
      max: TEXT_MAX,
      // no typographer: it turns the (R) of a formula into ®
      md: markdownit({ html: false, linkify: true }),
    };
  },

  computed: {
    open: {
      get() {
        return this.show;
      },
      set(value: boolean) {
        this.$emit("update:show", value);
      },
    },
  },

  mounted() {
    this.communication.onTutor(async (msg: any) => {
      const { pending, answerKey } = this;
      if (!pending || !answerKey) return;
      const answer = await tutorAnswer(msg, this.owner, this.communication.peerID, pending, answerKey);
      if (!answer || answer.id !== this.pending) return;
      this.done();
      this.add(answer.text !== undefined
        ? { id: answer.id, from: "tutor", text: answer.text }
        : { id: answer.id, from: "tutor", text: answer.error, error: true });
      this.$emit("answered");
    });
  },

  beforeUnmount() {
    this.communication.onTutor(null);
    clearTimeout(this.timer);
  },

  methods: {
    // the same panel as the class chat: it stays open while the modules are used
    panelProps() {
      return this.phone
        ? { fullscreen: true, transition: "dialog-bottom-transition" }
        : { width: 360, permanent: window.innerWidth > 1000 + 360, location: "right", color: "panel" };
    },

    key() {
      return `edrys-tutor:${this.classId}`;
    },

    load(): Entry[] {
      try {
        const saved = JSON.parse(sessionStorage.getItem(this.key()) || "[]");
        return Array.isArray(saved) ? saved : [];
      } catch {
        return [];
      }
    },

    add(entry: Entry) {
      this.entries.push(entry);
      try {
        sessionStorage.setItem(this.key(), JSON.stringify(this.entries.slice(-100)));
      } catch {}
      // only the log scrolls: scrollIntoView would also scroll the page
      // sideways, to the closed class chat beside it
      this.$nextTick(() => {
        const log = this.$refs.log as HTMLElement | undefined;
        if (log) log.scrollTop = log.scrollHeight;
      });
    },

    done() {
      clearTimeout(this.timer);
      this.pending = null;
      this.answerKey = null;
    },

    async send() {
      const text = this.message.trim();
      if (!text || this.pending || !this.tutorId || !this.tutorKey) return;
      const id = infoHash(12);
      const to = this.tutorId;
      this.add({ id, from: "student", text });
      this.message = "";
      this.pending = id;
      const failed = () => {
        this.done();
        this.add({ id, from: "tutor", text: this.t("tutor.noAnswer"), error: true });
      };
      this.timer = setTimeout(failed, ANSWER_MS);
      // sealed for the teacher's tab: the class may relay it to everyone
      let sealed;
      try {
        sealed = await sealQuestion(this.tutorKey, this.communication.peerID, id, text);
      } catch (error) {
        console.warn("tutor: could not seal the question", error);
        return failed();
      }
      if (this.pending !== id) return;
      // a CryptoKey must stay as it is: Vue's proxy would break crypto.subtle
      this.answerKey = markRaw(sealed.key);
      this.communication.sendTutor(to, sealed.tutor);
    },
  },
};
</script>

<template>
  <component
    :is="phone ? 'v-dialog' : 'v-navigation-drawer'"
    v-bind="panelProps()"
    v-model="open"
    :class="['tutor-panel', { 'tutor-panel--phone': phone }]"
  >
    <div class="tutor-box">
      <div class="tutor-title">
        <v-btn
          v-if="phone"
          :icon="rtl ? 'mdi-arrow-right' : 'mdi-arrow-left'"
          size="44"
          rounded="lg"
          variant="text"
          :aria-label="t('tutor.close')"
          @click="open = false"
        ></v-btn>
        <h2>{{ t("tutor.title") }}</h2>
        <v-btn
          v-if="!phone"
          icon="mdi-close"
          size="32"
          rounded="lg"
          variant="text"
          :aria-label="t('tutor.close')"
          @click="open = false"
        ></v-btn>
      </div>

      <div role="log" ref="log" class="tutor-log">
        <p class="tutor-intro">{{ t("tutor.intro") }}</p>
        <div
          v-for="entry in entries"
          :key="entry.id + entry.from"
          :class="['tutor-entry', entry.from, { error: entry.error }]"
        >
          <div v-if="entry.from === 'tutor' && !entry.error" class="markdown" v-html="md.render(entry.text)"></div>
          <div v-else class="plain">{{ entry.text }}</div>
        </div>
        <div v-if="pending" class="tutor-entry tutor text-medium-emphasis" role="status">
          {{ t("tutor.thinking") }}
        </div>
        <p v-if="!tutorId" class="tutor-intro" role="status">{{ t("tutor.offline") }}</p>
      </div>

      <div class="tutor-compose">
        <label for="tutor-message">{{ t("tutor.placeholder") }}</label>
        <textarea
          id="tutor-message"
          v-model="message"
          rows="3"
          :maxlength="max"
          :disabled="!tutorId"
          @keydown.enter.exact.prevent="send()"
        ></textarea>
        <v-btn
          append-icon="mdi-send-outline"
          color="primary"
          variant="flat"
          block
          height="40"
          rounded="lg"
          class="text-none"
          :disabled="!tutorId || !!pending || !message.trim()"
          @click="send()"
        >
          {{ t("chat.sendButton") }}
        </v-btn>
        <p class="tutor-privacy">{{ t("tutor.privacy") }}</p>
      </div>
    </div>
  </component>
</template>

<style scoped>
.tutor-panel:not(.tutor-panel--phone) {
  border-inline-start: 1px solid rgb(var(--v-theme-panel-line)) !important;
}
.tutor-box {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--v-theme-panel));
  color: rgb(var(--v-theme-on-surface));
}
.tutor-title {
  flex-shrink: 0;
  gap: 4px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 48px;
  padding-block: 0;
  padding-inline: 16px 8px;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}
.tutor-title h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.tutor-log {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
  gap: 8px;
  padding: 12px;
}
.tutor-intro,
.tutor-privacy {
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
}
.tutor-entry {
  align-self: flex-start;
  padding: 10px 12px;
  /* the corner towards the sender stays sharp */
  border-radius: 12px;
  border-end-start-radius: 4px;
  max-width: 92%;
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
  background: rgb(var(--v-theme-message));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.06), 0 0 0 1px rgb(var(--v-theme-message-edge));
}
.v-theme--dark .tutor-entry {
  box-shadow: none;
}
.tutor-entry.student {
  align-self: flex-end;
  max-width: 85%;
  padding: 9px 12px;
  border-radius: 12px;
  border-end-end-radius: 4px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  line-height: 1.5;
  box-shadow: none;
}

.tutor-entry.student :deep(a) {
  color: inherit;
}
.tutor-entry :deep(.markdown > :last-child) {
  margin-bottom: 0;
}
.tutor-compose {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgb(var(--v-theme-panel-line));
}
.tutor-compose label {
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}
.tutor-compose textarea {
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
.tutor-compose textarea:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}
.tutor-compose textarea:disabled {
  opacity: 0.6;
}
.tutor-entry.error {
  color: rgb(var(--v-theme-error));
}
.plain {
  white-space: pre-wrap;
}
.tutor-panel--phone .tutor-title {
  justify-content: flex-start;
  height: 56px;
  padding: 0 4px;
}
.tutor-panel--phone .tutor-title h2 {
  font-size: 16px;
}
</style>
