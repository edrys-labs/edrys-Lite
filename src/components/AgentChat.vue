<script lang="ts">
import markdownit from "markdown-it";
import { useI18n } from "vue-i18n";
import { useDisplay, useRtl } from "vuetify";

// edrys-dev's endpoints for this panel (same origin, see edrys-dev's chat.ts and server.ts)
const API = "/edrys-dev";

const OPEN_KEY = "edrys-dev:chat-open";
const VIEW_KEY = "edrys-dev:chat-view";
const WIDTH_KEY = "edrys-dev:chat-width";
const WIDTH = 400;
const MIN_WIDTH = 320;
// the class keeps at least this much of the window
const PAGE_MIN = 360;

// no HTML of the agent's runs in the page; links open beside the class, not in its place
const md = markdownit({ html: false, linkify: true });
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  tokens[i].attrSet("target", "_blank");
  tokens[i].attrSet("rel", "noopener noreferrer");
  return self.renderToken(tokens, i, options);
};

type Input = { id: string; type: "buttons" | "radio" | "checkbox"; label?: string; options: string[] };
// html: the markdown rendered once, not on every render of the panel
type Entry = { n: number; t: number } & (
  | { type: "ai"; markdown: string; html?: string; ask?: string; inputs?: Input[] }
  | { type: "user"; text: string }
  | { type: "answer"; ask: string; values: Record<string, string | string[]> }
);
type TutorEntry =
  | { from: "student" | "tutor"; t: number; text: string; html?: string; room?: string }
  | { failed: string };
type Thread = { id: string; name: string; room: string; last: number; skipped: number; entries: TutorEntry[] };

/**
 * The teacher's chat with the agent of edrys-dev --mcp (Agent) and the
 * students' threads with its tutor (Students, with --tutor). Only in the tab
 * edrys-dev opened with `?dev`; edrys-dev keeps the chats, this shows them.
 */
export default {
  name: "AgentChat",
  // views: which of the two edrys-dev has, {agent, students}
  props: ["show", "views"],
  emits: ["update:show", "unread"],

  setup() {
    const { t, locale } = useI18n();
    const { xs: phone, width: windowWidth } = useDisplay();
    const { isRtl: rtl } = useRtl();
    return { t, locale, phone, windowWidth, rtl, WIDTH, MIN_WIDTH };
  },

  data() {
    let wanted = WIDTH;
    let savedView = null;
    try {
      wanted = Number(localStorage.getItem(WIDTH_KEY)) || WIDTH;
      savedView = sessionStorage.getItem(VIEW_KEY);
    } catch {}

    return {
      view: (!this.views.agent ? "students" : !this.views.students ? "agent" : savedView === "students" ? "students" : "agent") as
        | "agent"
        | "students",
      wanted,
      resizing: false,
      streams: [] as EventSource[],

      // the agent view
      entries: [] as Entry[],
      skipped: 0,
      ask: null as string | null, // the form the user can still answer
      answers: {} as Record<string, Record<string, string | string[]>>,
      reasons: {} as Record<string, string>, // why the agent closed a form, shown only live
      current: null as { id: string; title: string } | null,
      sessions: [] as { id: string; title: string }[],
      status: "",
      busy: false,
      hint: "",
      problem: null as { text: string; detail: string } | null,
      message: "",

      // the students view
      threads: [] as Thread[], // the one changed last first
      tutorOn: true,
      tutorNote: "",
      limit: 0,
      count: 0, // questions not seen yet

      // the link for students
      share: null as { reachable: boolean; link: string | null; local_urls: string[] } | null,
      copyLabel: "",
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
    both(): boolean {
      return this.views.agent && this.views.students;
    },
    // the width dragged to, kept within the window
    width(): number {
      return Math.round(Math.max(MIN_WIDTH, Math.min(this.wanted, this.windowWidth - PAGE_MIN)));
    },
    sessionItems() {
      const items = [{ value: "", title: this.t("agentChat.newChat") }];
      if (this.current && !this.sessions.some((s) => s.id === this.current.id)) {
        items.push({ value: this.current.id, title: this.t("agentChat.untitled") });
      }
      for (const s of this.sessions) items.push({ value: s.id, title: s.title });
      return items;
    },
    // the link with the agent; in the students view only without it
    showShare(): boolean {
      return !!this.share && !(this.view === "students" && this.views.agent);
    },
    shareNote(): string {
      if (!this.share) return "";
      const modules = this.share.local_urls.length;
      if (!this.share.reachable) return this.t("agentChat.local");
      if (!this.share.link) return this.t("agentChat.noLinkYet");
      return modules ? this.t("agentChat.localModules", modules) : "";
    },
  },

  watch: {
    show(open: boolean) {
      try {
        sessionStorage.setItem(OPEN_KEY, open ? "1" : "");
      } catch {}
      if (open && this.view === "students") this.count = 0;
    },
    view(view: string) {
      try {
        sessionStorage.setItem(VIEW_KEY, view);
      } catch {}
      if (view === "students") this.count = 0;
    },
  },

  mounted() {
    try {
      if (sessionStorage.getItem(OPEN_KEY) === "1") this.open = true;
    } catch {}
    if (this.views.agent) this.listen("/chat/events", this.onChat);
    if (this.views.students) this.listen("/tutor/events", this.onTutor);
    this.listen("/link/events", (message: any) => (this.share = message));
  },

  beforeUnmount() {
    this.streams.forEach((stream) => stream.close());
    document.documentElement.classList.remove("agent-chat-resizing");
  },

  methods: {
    // the same panel as the class chat, as wide as the user dragged it
    panelProps() {
      return this.phone
        ? { fullscreen: true, transition: "dialog-bottom-transition" }
        : { width: this.width, permanent: this.windowWidth > 1000 + this.width, location: "right", color: "panel" };
    },

    listen(path: string, handle: (message: any) => void) {
      const stream = new EventSource(API + path);
      stream.onmessage = (event) => handle(JSON.parse(event.data));
      this.streams.push(stream);
    },

    // something new while the panel is closed: a dot on its button
    unread() {
      if (!this.show) this.$emit("unread");
    },

    // the response, or null if edrys-dev could not be reached
    post(path: string, body: any): Promise<Response | null> {
      return fetch(API + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
    },

    time(t: number): string {
      return new Date(t).toLocaleTimeString(this.locale, { hour: "2-digit", minute: "2-digit" });
    },

    scrollDown() {
      this.$nextTick(() => {
        const log = this.$refs.log as HTMLElement | undefined;
        if (log) log.scrollTop = log.scrollHeight;
      });
    },

    // --- the agent ---

    onChat(message: any) {
      switch (message.type) {
        case "history":
          this.entries = [];
          this.answers = {};
          this.reasons = {};
          this.ask = message.open;
          this.current = message.session;
          this.sessions = message.sessions;
          this.skipped = message.skipped;
          message.entries.forEach((entry: Entry) => this.add(entry, false));
          this.setStatus(message.status, true);
          this.hint = message.hint || "";
          this.setProblem(message.lab);
          break;
        case "lab":
          this.setProblem(message.problem);
          break;
        case "entry":
          if (message.entry.type === "ai" && message.entry.ask) this.ask = message.entry.ask;
          if (message.entry.type === "answer" && this.ask === message.entry.ask) this.ask = null;
          this.add(message.entry, true);
          break;
        case "status":
          this.setStatus(message.text, true);
          break;
        case "sessions":
          this.sessions = message.sessions;
          break;
        case "hint":
          this.hint = message.text;
          break;
        case "close":
          if (this.ask === message.ask) this.ask = null;
          if (message.reason) this.reasons[message.ask] = message.reason;
          break;
      }
    },

    // a reconnect sends the same problem again: only a new one is unread
    setProblem(problem: { text: string; detail: string } | null | undefined) {
      const fresh = !!problem && (problem.text !== this.problem?.text || problem.detail !== this.problem?.detail);
      this.problem = problem || null;
      if (fresh) this.unread();
    },

    add(entry: Entry, live: boolean) {
      if (entry.type === "ai") entry.html = md.render(entry.markdown);
      if (entry.type === "ai" && entry.ask) {
        this.answers[entry.ask] = Object.fromEntries(
          (entry.inputs || []).map((input) => [input.id, input.type === "checkbox" ? [] : ""])
        );
      }
      this.entries.push(entry);
      this.scrollDown();
      if (live && entry.type === "ai") this.unread();
    },

    // the agent's progress, with a spinner; or the panel's own note, without
    setStatus(text: string, busy: boolean) {
      this.status = text || "";
      this.busy = busy;
    },

    notSent() {
      this.setStatus(this.t("agentChat.notSent"), false);
    },

    async send() {
      const text = this.message.trim();
      if (!text) return;
      this.message = "";
      const response = await this.post("/chat", { text });
      if (response?.ok) return;
      // back into the box, unless the user typed something new meanwhile
      if (!this.message) this.message = text;
      this.notSent();
    },

    async chooseSession(id: string) {
      const response = await this.post("/chat", { session: id || null });
      // the server sends the chat it shows now
      if (!response?.ok) this.notSent();
    },

    // one row of buttons: they send at once, the first one filled like a dialog's main action
    single(entry: any): boolean {
      return entry.inputs.length === 1 && entry.inputs[0].type === "buttons";
    },

    choose(entry: any, input: Input, option: string) {
      this.answers[entry.ask][input.id] = option;
      if (this.single(entry)) this.answer(entry);
    },

    async answer(entry: any) {
      const response = await this.post("/chat", { ask: entry.ask, values: this.answers[entry.ask] });
      // closed in the meantime; otherwise the form stays, to send again
      if (response?.status === 409) {
        if (this.ask === entry.ask) this.ask = null;
      } else if (!response?.ok) this.notSent();
    },

    answerText(entry: any): string {
      return Object.values(entry.values).flat().join(", ");
    },

    // --- the students ---

    onTutor(message: any) {
      switch (message.type) {
        case "threads":
          this.tutorOn = message.on;
          this.tutorNote = "";
          this.threads = message.threads.map((saved: any) => {
            const thread: Thread = { id: saved.id, name: saved.name, room: "", last: 0, skipped: saved.skipped || 0, entries: [] };
            saved.entries.forEach((entry: any) => this.addTutorEntry(thread, entry));
            return thread;
          });
          break;
        case "entry": {
          this.addTutorEntry(this.threadFor(message.id, message.name), message.entry);
          if (message.entry.from !== "student") break;
          // the tutor took a question again: the class is below its limit
          this.limit = 0;
          if (this.view !== "students" || !this.show) this.count++;
          this.unread();
          break;
        }
        case "failed":
          // the reason is for the teacher; the student was told it failed
          this.threadFor(message.id, message.name).entries.push({ failed: message.error });
          break;
        case "on":
          this.tutorOn = message.on;
          this.tutorNote = "";
          break;
        case "limit":
          this.limit = message.perHour;
          this.unread();
          break;
      }
    },

    // the thread, moved to the top: the one changed last first
    threadFor(id: string, name: string): Thread {
      let thread = this.threads.find((thread) => thread.id === id);
      if (thread) this.threads.splice(this.threads.indexOf(thread), 1);
      else thread = { id, name, room: "", last: 0, skipped: 0, entries: [] };
      thread.name = name;
      this.threads.unshift(thread);
      return thread;
    },

    addTutorEntry(thread: Thread, entry: any) {
      if (entry.from === "tutor") entry.html = md.render(entry.text);
      thread.entries.push(entry);
      thread.last = entry.t;
      if (entry.room) thread.room = entry.room;
    },

    initial(name: string): string {
      return [...name.trim()][0]?.toUpperCase() || "?";
    },

    async switchTutor(on: boolean) {
      this.tutorOn = on;
      this.tutorNote = "";
      const response = await this.post("/tutor", { on });
      if (response?.ok) return;
      this.tutorOn = !on;
      this.tutorNote = this.t("agentChat.notSwitched");
    },

    // --- the link for students: the class's share link would only work on this computer ---

    selectLink() {
      (this.$refs.link as HTMLInputElement | undefined)?.select();
    },

    async copyLink() {
      let copied = false;
      try {
        await navigator.clipboard.writeText(this.share.link);
        copied = true;
      } catch {
        this.selectLink();
      }
      this.copyLabel = this.t(copied ? "agentChat.copied" : "agentChat.copyFailed");
      setTimeout(() => (this.copyLabel = ""), 2000);
    },

    // --- the width ---

    setWidth(width: number) {
      this.wanted = width;
      this.wanted = this.width;
      try {
        localStorage.setItem(WIDTH_KEY, String(this.wanted));
      } catch {}
    },

    startResize(event: PointerEvent) {
      if (event.button !== 0) return;
      event.preventDefault();
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      this.resizing = true;
      // the modules' frames would take the pointer
      document.documentElement.classList.add("agent-chat-resizing");
    },

    resize(event: PointerEvent) {
      if (this.resizing) this.wanted = window.innerWidth - event.clientX;
    },

    endResize() {
      this.resizing = false;
      document.documentElement.classList.remove("agent-chat-resizing");
      this.setWidth(this.wanted);
    },

    resizeKey(event: KeyboardEvent) {
      const step = { ArrowLeft: 16, ArrowRight: -16 }[event.key];
      if (!step) return;
      event.preventDefault();
      this.setWidth(this.width + step);
    },
  },
};
</script>

<template>
  <component
    :is="phone ? 'v-dialog' : 'v-navigation-drawer'"
    v-bind="panelProps()"
    v-model="open"
    :class="['agent-panel', { 'agent-panel--phone': phone, 'agent-panel--resizing': resizing }]"
  >
    <div class="agent-box">
      <div
        v-if="!phone"
        class="agent-resize"
        :class="{ dragging: resizing }"
        role="separator"
        aria-orientation="vertical"
        :aria-label="t('agentChat.resize')"
        :aria-valuemin="MIN_WIDTH"
        :aria-valuenow="width"
        :title="t('agentChat.resizeTitle')"
        tabindex="0"
        @pointerdown="startResize"
        @pointermove="resize"
        @lostpointercapture="endResize"
        @dblclick="setWidth(WIDTH)"
        @keydown="resizeKey"
      ></div>

      <div class="agent-title">
        <v-btn
          v-if="phone"
          :icon="rtl ? 'mdi-arrow-right' : 'mdi-arrow-left'"
          size="44"
          rounded="lg"
          variant="text"
          :aria-label="t('agentChat.close')"
          @click="open = false"
        ></v-btn>
        <div v-if="both" class="agent-tabs" role="tablist" :aria-label="t('agentChat.views')">
          <button
            v-for="name in ['agent', 'students']"
            :key="name"
            type="button"
            role="tab"
            :aria-selected="view === name"
            :data-test="'agent-chat-tab-' + name"
            @click="view = name"
          >
            {{ t("agentChat." + name) }}
            <span v-if="name === 'students' && count" class="agent-count">{{ count }}</span>
          </button>
        </div>
        <h2 v-else>{{ t("agentChat." + view) }}</h2>
        <span class="agent-spacer"></span>
        <span class="agent-private" :title="t('agentChat.privateTitle')">
          <v-icon icon="mdi-lock-outline" size="14"></v-icon>
          {{ t("agentChat.private") }}
        </span>
        <v-btn
          v-if="!phone"
          icon="mdi-close"
          size="32"
          rounded="lg"
          variant="text"
          :aria-label="t('agentChat.close')"
          @click="open = false"
        ></v-btn>
      </div>

      <div class="agent-top">
        <v-select
          v-if="view === 'agent'"
          :model-value="current?.id"
          :items="sessionItems"
          :label="t('agentChat.session')"
          variant="outlined"
          density="compact"
          hide-details
          data-test="agent-chat-sessions"
          @update:model-value="chooseSession"
        ></v-select>

        <div v-if="showShare" class="agent-share">
          <template v-if="share.link">
            <label class="agent-label" for="agent-link">{{ t("agentChat.linkLabel") }}</label>
            <div class="agent-share-row">
              <input id="agent-link" ref="link" class="mono" readonly :value="share.link" @focus="selectLink" />
              <v-btn variant="outlined" height="36" rounded="lg" class="text-none" prepend-icon="mdi-content-copy" @click="copyLink">
                {{ copyLabel || t("agentChat.copy") }}
              </v-btn>
            </div>
          </template>
          <div v-if="shareNote" class="agent-warn" aria-live="polite">
            <v-icon icon="mdi-alert-outline" size="14"></v-icon>
            <span>{{ shareNote }}</span>
          </div>
        </div>

        <template v-if="view === 'students'">
          <v-switch
            :model-value="tutorOn"
            :label="t('agentChat.tutorSwitch')"
            color="primary"
            density="compact"
            hide-details
            inset
            data-test="agent-chat-tutor-switch"
            @update:model-value="switchTutor"
          ></v-switch>
          <div class="agent-note" aria-live="polite">
            {{ tutorNote || t(tutorOn ? "agentChat.tutorOn" : "agentChat.tutorOff") }}
          </div>
          <div v-if="limit" class="agent-alert agent-alert--warn" aria-live="polite">
            <v-icon icon="mdi-alert-outline" size="14"></v-icon>
            <span>{{ t("agentChat.limit", { n: limit }) }}</span>
          </div>
        </template>
      </div>

      <div v-if="view === 'agent'" class="agent-view" role="tabpanel">
        <div v-if="problem" class="agent-problem" role="alert">
          <v-icon icon="mdi-alert-circle-outline" size="18"></v-icon>
          <div>
            <div>{{ problem.text }}</div>
            <details>
              <summary>{{ t("agentChat.details") }}</summary>
              <pre class="mono">{{ problem.detail }}</pre>
            </details>
          </div>
        </div>

        <div ref="log" class="agent-log" role="log" aria-live="polite">
          <div v-if="skipped" class="agent-muted">{{ t("agentChat.skipped", { n: skipped }) }}</div>
          <div v-for="entry in entries" :key="entry.n" :class="['agent-msg', entry.type]">
            <template v-if="entry.type === 'ai'">
              <div class="markdown" v-html="entry.html"></div>
              <form
                v-if="entry.ask"
                class="agent-form"
                :class="{ 'agent-form--single': single(entry) }"
                :aria-disabled="entry.ask !== ask"
                :inert="entry.ask !== ask || undefined"
                @submit.prevent="answer(entry)"
              >
                <fieldset v-for="input in entry.inputs" :key="input.id">
                  <legend v-if="input.label">{{ input.label }}</legend>
                  <template v-if="input.type === 'buttons'">
                    <button
                      v-for="option in input.options"
                      :key="option"
                      type="button"
                      class="agent-choice"
                      :aria-pressed="single(entry) ? undefined : answers[entry.ask][input.id] === option"
                      @click="choose(entry, input, option)"
                    >
                      {{ option }}
                    </button>
                  </template>
                  <label v-else v-for="option in input.options" :key="option" class="agent-option">
                    <input
                      v-if="input.type === 'radio'"
                      type="radio"
                      :name="entry.ask + '-' + input.id"
                      :value="option"
                      v-model="answers[entry.ask][input.id]"
                    />
                    <input v-else type="checkbox" :value="option" v-model="answers[entry.ask][input.id]" />
                    {{ option }}
                  </label>
                </fieldset>
                <button v-if="!single(entry)" type="submit" class="agent-choice agent-submit">
                  {{ t("chat.sendButton") }}
                </button>
              </form>
              <div v-if="entry.ask && reasons[entry.ask]" class="agent-muted agent-reason">{{ reasons[entry.ask] }}</div>
            </template>
            <template v-else-if="entry.type === 'user'">{{ entry.text }}</template>
            <template v-else>{{ answerText(entry) }}</template>
          </div>
        </div>

        <div v-if="status" class="agent-status" aria-live="polite">
          <v-progress-circular v-if="busy" indeterminate size="14" width="2"></v-progress-circular>
          <span>{{ status }}</span>
        </div>
        <div v-if="hint" class="agent-hint" aria-live="polite">{{ hint }}</div>

        <div class="agent-compose">
          <label for="agent-message">{{ t("agentChat.message") }}</label>
          <textarea id="agent-message" v-model="message" rows="2" @keydown.enter.exact.prevent="send()"></textarea>
          <v-btn
            append-icon="mdi-send-outline"
            color="primary"
            variant="flat"
            block
            height="40"
            rounded="lg"
            class="text-none"
            :disabled="!message.trim()"
            @click="send()"
          >
            {{ t("chat.sendButton") }}
          </v-btn>
        </div>
      </div>

      <div v-else class="agent-view" role="tabpanel">
        <div class="agent-log agent-threads" role="log" aria-live="polite">
          <div v-if="!threads.length" class="agent-muted">{{ t("agentChat.noQuestions") }}</div>
          <details v-for="thread in threads" :key="thread.id" class="agent-thread" open>
            <summary>
              <span class="agent-initial" aria-hidden="true">{{ initial(thread.name) }}</span>
              <span class="agent-who">
                <span class="agent-name">{{ thread.name }}</span>
                <span class="agent-where">{{ [thread.room, thread.last && time(thread.last)].filter(Boolean).join(" · ") }}</span>
              </span>
              <v-icon icon="mdi-chevron-down" size="16" class="agent-chevron"></v-icon>
            </summary>
            <div class="agent-entries">
              <div v-if="thread.skipped" class="agent-muted">{{ t("agentChat.skipped", { n: thread.skipped }) }}</div>
              <template v-for="(entry, i) in thread.entries" :key="i">
                <div v-if="'failed' in entry" class="agent-alert agent-alert--danger">
                  <v-icon icon="mdi-alert-circle-outline" size="14"></v-icon>
                  <span>{{ t("agentChat.noAnswer", { error: entry.failed }) }}</span>
                </div>
                <div v-else :class="['agent-msg', 'tutor-' + entry.from]">
                  <span class="agent-meta">{{
                    entry.from === "student" ? time(entry.t) : t("tutor.title") + " · " + time(entry.t)
                  }}</span>
                  <template v-if="entry.from === 'student'">{{ entry.text }}</template>
                  <div v-else class="markdown" v-html="entry.html"></div>
                </div>
              </template>
            </div>
          </details>
        </div>
      </div>
    </div>
  </component>
</template>

<style>
/* while the width is dragged: the modules' frames would take the pointer */
html.agent-chat-resizing,
html.agent-chat-resizing * {
  cursor: col-resize !important;
  user-select: none !important;
}
html.agent-chat-resizing iframe {
  pointer-events: none;
}
</style>

<style scoped>
.agent-panel:not(.agent-panel--phone) {
  border-inline-start: 1px solid rgb(var(--v-theme-panel-line)) !important;
}
/* the drawer follows the handle at once */
.agent-panel--resizing {
  transition: none !important;
}
.agent-box {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--v-theme-panel));
  color: rgb(var(--v-theme-on-surface));
}
.agent-resize {
  position: absolute;
  inset-block: 0;
  left: -1px;
  z-index: 1;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
}
.agent-resize::after {
  content: "";
  position: absolute;
  inset-block: 0;
  left: 0;
  width: 2px;
  transition: background 0.15s;
}
.agent-resize:hover::after,
.agent-resize.dragging::after,
.agent-resize:focus-visible::after {
  background: rgb(var(--v-theme-primary));
}
.agent-resize:focus-visible {
  outline: none;
}

.agent-title {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 48px;
  padding-inline: 16px 8px;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}
.agent-title h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}
.agent-spacer {
  flex: 1;
}
.agent-private {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  color: rgb(var(--v-theme-muted));
}
/* the segmented switch of the user menu */
.agent-tabs {
  display: flex;
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: rgb(var(--v-theme-tonal));
}
.agent-tabs button {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 7px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-muted));
}
.agent-tabs button[aria-selected="true"] {
  background: rgb(var(--v-theme-segment));
  color: rgb(var(--v-theme-on-surface));
}
.v-theme--light .agent-tabs button[aria-selected="true"] {
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.12);
}
.agent-count {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgb(var(--v-theme-badge));
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 18px;
  text-align: center;
}

.agent-top {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}
.agent-label,
.agent-compose label {
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}
.agent-share {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agent-share-row {
  display: flex;
  gap: 8px;
}
.agent-share-row input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-field-line));
  border-radius: 8px;
  background: rgb(var(--v-theme-field));
  color: rgb(var(--v-theme-on-surface));
  font-size: 12px;
}
.agent-warn {
  display: flex;
  gap: 6px;
  font-size: 12px;
  line-height: 1.45;
  color: rgb(var(--v-theme-warning));
}
.agent-note {
  font-size: 12px;
  line-height: 1.45;
  color: rgb(var(--v-theme-muted));
}
.agent-alert {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.45;
}
.agent-alert .v-icon,
.agent-warn .v-icon {
  margin-top: 1px;
}
.agent-alert--warn {
  background: rgb(var(--v-theme-warning-tint));
  color: rgb(var(--v-theme-warning));
}
.agent-alert--danger {
  background: rgb(var(--v-theme-danger-tint));
  color: rgb(var(--v-theme-error));
}

.agent-view {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.agent-problem {
  display: flex;
  gap: 10px;
  margin: 12px 12px 0;
  padding: 12px;
  border-radius: 10px;
  background: rgb(var(--v-theme-danger-tint));
  color: rgb(var(--v-theme-error));
  font-size: 13px;
  line-height: 1.5;
}
.agent-problem > div {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.agent-problem summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
}
.agent-problem pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 12px;
}
.agent-log {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}
.agent-muted {
  align-self: center;
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
}
.agent-msg {
  max-width: 85%;
  padding: 9px 12px;
  font-size: 13px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}
/* the corner towards the sender stays sharp */
.agent-msg.ai {
  align-self: flex-start;
  max-width: 92%;
  border-radius: 12px;
  border-end-start-radius: 4px;
  background: rgb(var(--v-theme-message));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.06), 0 0 0 1px rgb(var(--v-theme-message-edge));
}
.v-theme--dark .agent-msg.ai {
  box-shadow: none;
}
.agent-msg.user,
.agent-msg.answer {
  align-self: flex-end;
  border-radius: 12px;
  border-end-end-radius: 4px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  white-space: pre-wrap;
}
.agent-msg :deep(.markdown > :last-child) {
  margin-bottom: 0;
}
.agent-msg :deep(pre) {
  padding: 8px 10px;
  border-radius: 8px;
  overflow-x: auto;
  background: rgb(var(--v-theme-tonal));
  font-size: 12px;
}
.agent-msg :deep(code) {
  font-family: "JetBrains Mono Variable", ui-monospace, monospace;
  font-size: 12px;
}
.agent-msg :deep(:not(pre) > code) {
  padding: 1px 4px;
  border-radius: 4px;
  background: rgb(var(--v-theme-tonal));
}
.agent-msg :deep(a) {
  color: rgb(var(--v-theme-link));
}

.agent-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}
.agent-form[aria-disabled="true"] {
  opacity: 0.5;
}
.agent-form fieldset {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0;
  padding: 0;
  border: 0;
}
.agent-form legend {
  padding: 0 0 6px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}
.agent-option {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  font-size: 13px;
}
.agent-option input {
  margin: 0;
  accent-color: rgb(var(--v-theme-primary));
}
.agent-choice {
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgb(var(--v-theme-field-line));
  border-radius: 8px;
  background: rgb(var(--v-theme-field));
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
  font-weight: 600;
}
.agent-choice[aria-pressed="true"],
.agent-form--single .agent-choice:first-of-type {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}
.agent-submit {
  align-self: flex-start;
}
.agent-reason {
  align-self: flex-start;
  margin-top: 8px;
}
.agent-status {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px 10px;
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
}
.agent-hint {
  padding: 0 12px 10px;
  font-size: 12px;
  font-style: italic;
  color: rgb(var(--v-theme-muted));
}
.agent-compose {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgb(var(--v-theme-panel-line));
}
.agent-compose textarea {
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
.agent-compose textarea:focus-visible,
.agent-choice:focus-visible,
.agent-tabs button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.agent-thread {
  flex-shrink: 0;
  border-radius: 12px;
  background: rgb(var(--v-theme-message));
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.05), 0 0 0 1px rgb(var(--v-theme-module-edge));
}
.v-theme--dark .agent-thread {
  box-shadow: 0 0 0 1px rgb(var(--v-theme-module-line));
}
.agent-thread summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  list-style: none;
  cursor: pointer;
}
.agent-thread summary::-webkit-details-marker {
  display: none;
}
.agent-thread:not([open]) .agent-chevron {
  transform: rotate(-90deg);
}
.agent-initial {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgb(var(--v-theme-own-message));
  color: rgb(var(--v-theme-you));
  font-size: 12px;
  font-weight: 700;
}
.agent-who {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.agent-name {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agent-where {
  font-size: 11px;
  color: rgb(var(--v-theme-muted));
}
.agent-entries {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 12px 12px;
}
.agent-msg.tutor-student {
  align-self: flex-start;
  max-width: 88%;
  border-radius: 12px;
  border-end-start-radius: 4px;
  background: rgb(var(--v-theme-tonal));
  white-space: pre-wrap;
}
.agent-msg.tutor-tutor {
  align-self: flex-end;
  max-width: 88%;
  border-radius: 12px;
  border-end-end-radius: 4px;
  background: rgb(var(--v-theme-own-message));
}
.agent-meta {
  display: block;
  font-size: 11px;
  white-space: normal;
  color: rgb(var(--v-theme-muted));
}
.tutor-tutor .agent-meta {
  font-weight: 600;
  color: rgb(var(--v-theme-you));
}
.mono {
  font-family: "JetBrains Mono Variable", ui-monospace, monospace;
}

/* phones: a full-screen page with a back button */
.agent-panel--phone .agent-title {
  height: 56px;
  padding-inline: 4px 12px;
}
.agent-panel--phone .agent-title h2 {
  font-size: 16px;
}
</style>
