<script lang="ts">
import markdownit from "markdown-it";
import { useI18n } from "vue-i18n";
import { infoHash } from "../ts/Utils";
import { TEXT_MAX, tutorAnswer } from "../ts/Tutor";

// a question without an answer by then gets an error; edrys-dev gives up after 2 minutes
const ANSWER_MS = 3 * 60_000;

type Entry = { id: string; from: "student" | "tutor"; text: string; error?: boolean };

/**
 * The student's chat with the tutor of edrys-dev --tutor (see ts/Tutor.ts).
 * The thread is this tab's, kept for its reloads; edrys-dev keeps its own copy.
 */
export default {
  name: "TutorChat",
  props: ["show", "communication", "tutorId", "owner", "classId"],
  emits: ["update:show", "answered"],

  setup() {
    const { t } = useI18n();
    return { t };
  },

  data() {
    return {
      message: "",
      entries: this.load() as Entry[],
      // the question waiting for its answer, by id
      pending: null as string | null,
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
    this.communication.onTutor((msg: any) => {
      const answer = tutorAnswer(msg, this.owner);
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
      // only the drawer scrolls: scrollIntoView would also scroll the page
      // sideways, to the closed class chat beside it
      this.$nextTick(() => {
        const box = (this.$refs.log as any)?.$el?.closest(".v-navigation-drawer__content");
        if (box) box.scrollTop = box.scrollHeight;
      });
    },

    done() {
      clearTimeout(this.timer);
      this.pending = null;
    },

    send() {
      const text = this.message.trim();
      if (!text || this.pending || !this.tutorId) return;
      const id = infoHash(12);
      this.add({ id, from: "student", text });
      this.message = "";
      this.pending = id;
      this.communication.sendTutor(this.tutorId, { ask: { id, text } });
      this.timer = setTimeout(() => {
        this.done();
        this.add({ id, from: "tutor", text: this.t("tutor.noAnswer"), error: true });
      }, ANSWER_MS);
    },
  },
};
</script>

<template>
  <v-navigation-drawer :width="400" v-model="open" location="right" temporary>
    <v-toolbar density="compact" color="surface-variant">
      <v-toolbar-title>{{ t("tutor.title") }}</v-toolbar-title>
      <v-btn icon="mdi-close" :aria-label="t('tutor.close')" @click="open = false"></v-btn>
    </v-toolbar>

    <v-container role="log" ref="log">
      <p class="text-medium-emphasis text-body-2 mb-2">{{ t("tutor.intro") }}</p>
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
      <p v-if="!tutorId" class="text-medium-emphasis text-body-2" role="status">{{ t("tutor.offline") }}</p>
    </v-container>

    <template v-slot:append>
      <div class="pa-2">
        <v-textarea
          v-model="message"
          :label="t('tutor.placeholder')"
          variant="outlined"
          density="compact"
          no-resize
          rows="3"
          :maxlength="max"
          hide-details
          :disabled="!tutorId"
          @keydown.enter.exact.prevent="send()"
        ></v-textarea>
        <v-btn
          append-icon="mdi-send-outline"
          block
          class="mt-2"
          :disabled="!tutorId || !!pending || !message.trim()"
          @click="send()"
        >
          {{ t("chat.sendButton") }}
        </v-btn>
        <p class="text-caption text-medium-emphasis mt-1">{{ t("tutor.privacy") }}</p>
      </div>
    </template>
  </v-navigation-drawer>
</template>

<style scoped>
.tutor-entry {
  margin: 6px 0;
  padding: 8px 10px;
  border-radius: 8px;
  max-width: 90%;
  overflow-wrap: anywhere;
}
.tutor-entry.student {
  margin-left: auto;
  background: rgba(var(--v-theme-primary), 0.12);
}
.tutor-entry.tutor {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.tutor-entry.error {
  color: rgb(var(--v-theme-error));
}
.plain {
  white-space: pre-wrap;
}
</style>
