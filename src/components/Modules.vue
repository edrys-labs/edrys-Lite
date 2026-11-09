<script lang="ts">
import Module from "./Module.vue";
import Muuri from "muuri";
import { useI18n } from 'vue-i18n';
import { useDisplay } from 'vuetify';

import en from '../locales/en.yaml';
import de from '../locales/de.yaml';
import uk from '../locales/uk.yaml';
import ar from '../locales/ar.yaml';
import es from '../locales/es.yaml';
import { showInMatches } from "../ts/RoomNames";

import { debug } from "../api/debugHandler";
import { reportMessage } from "../ts/DevBridge";

export default {
  components: { Module },

  name: "Modules",

  props: [
    "role",
    "username_",
    "roomLabel",
    "liveClassProxy",
    "scrapedModules_",
    "isLoading",
    "communication",
    "class_id",
  ],

  setup() {
    const { t, locale } = useI18n();
    // phones stack the modules in the page, without dragging or resizing
    const { xs: phone } = useDisplay();

    return {
      t,
      locale,
      phone,
    };
  },

  data() {
    return {
      username: this.username_,
      grid: null,
      //scrapedModules: JSON.parse(JSON.stringify(this.scrapedModules_)),
      count: 0,
      isResizing: false,
      isMoving: false,
      // itemKey -> size the user resized that item to
      itemSizes: {} as Record<string, { width: string; height: string }>,
      // itemKey of the module shown full screen
      fullscreenKey: null as string | null,
      // itemKey of the module filling the window, where elements can't go full screen (iPhone)
      expandedKey: null as string | null,
    };
  },

  watch: {
    phone() {
      this.$nextTick(() => this.gridUpdate());
    },
  },

  computed: {
    roomName() {
      return this.liveClassProxy.users[this.username]?.room || "Station " + this.username;
    },

    modulesType() {
      return this.roomName.startsWith("Station ") ? "station" : "chat";
    },

    // Get all translations for all locales
    allMessages() {
      return { en, de, uk, ar, es };
    },

    // Translations for roles
    roleTranslations() {
      return {
        teacher: Object.values(this.allMessages).map(msgs => 
          (msgs as any).settings.modules.module.showIn.teacherOnly
        ),
        station: Object.values(this.allMessages).map(msgs => 
          (msgs as any).settings.modules.module.showIn.stationOnly
        )
      };
    },

    // Translations for room prefixes
    roomPrefixTranslations() {
      return Object.values(this.allMessages).map(msgs => 
        (msgs as any).classroom.sideMenu.room
      );
    },

    scrapedModulesFilter() {
      setTimeout(() => {
        this.gridUpdate();
      }, 1000);

      return this.scrapedModules_.filter((m) => {
        const rawShowIn = m.showInCustom
          ? m.showInCustom.split(",").map((e) => e.trim())
          : m.showIn;
        const showIn = Array.isArray(rawShowIn) ? rawShowIn : [rawShowIn || "*"];

        const translatedRoomNames = {
          [this.t('classroom.sideMenu.lobby').toLowerCase()]: 'lobby',
          [this.t('classroom.sideMenu.station').toLowerCase()]: 'station',
        };

        const normalizedShowIn = showIn.map(room => this.normalizeRoomName(room, translatedRoomNames));

        // A label is matched as written: normalizing would read "Room for groups" as a number.
        const isInRoom =
          this.checkRoomMatch(normalizedShowIn, this.roomName.toLowerCase()) ||
          (!!this.roomLabel && this.checkRoomMatch(showIn, this.roomLabel.toLowerCase()));

        if (this.roleTranslations.teacher.some(trans => normalizedShowIn.includes(trans))) {
          return (
            (normalizedShowIn.includes(this.modulesType) || isInRoom || normalizedShowIn.includes("*")) &&
            this.role == "teacher"
          );
        }

        if (this.roleTranslations.station.some(trans => normalizedShowIn.includes(trans))) {
          return (
            (normalizedShowIn.includes(this.modulesType) || isInRoom || normalizedShowIn.includes("*")) &&
            this.role == "station"
          );
        }
        
        return normalizedShowIn.includes(this.modulesType) || isInRoom || normalizedShowIn.includes("*");
      });
    },
  },
  created() {
    // Module window -> awareness client ids it published, so they can be
    // removed once that frame is gone (else they linger for 30 s everywhere).
    this._frameAwareness = new Map<Window, Set<number>>();
    window.addEventListener("message", this.messageHandler);
    const iframes = document.getElementsByTagName("iframe");

    // Post to every module iframe, each at its own origin, except `except`.
    const broadcast = (payload: any, except?: unknown) => {
      for (let i = 0; i < iframes.length; i++) {
        const module = this.scrapedModulesFilter[i];
        if (!module) continue;
        if (except && iframes[i].contentWindow === except) continue;
        iframes[i].contentWindow?.postMessage(
          payload,
          module.origin || new URL(module.url).origin
        );
      }
    };

    this.communication.on(
      "message",
      (msg: { subject: string; body: any; module_url: string; date: number }) => {
        broadcast({ event: "message", ...msg });
        reportMessage(this.class_id, msg);
      }
    );

    // Forward doc updates: remote edits reach the local Y.Doc but not the
    // module, so content would only appear on reload. A module's own update
    // ('extern') goes to its sibling modules, not back to its sender.
    const exceptSender = (origin: any) =>
      origin?.transactionId === "extern" ? origin.source : undefined;
    this._stateUnsub = this.communication.onState((data: Uint8Array, origin: any) => {
      broadcast({ event: "state", data }, exceptSender(origin));
    });

    // Forward app-awareness (module cursors/presence), same sender skip.
    this._awarenessUnsub = this.communication.onAwareness((data: Uint8Array, origin: any) => {
      broadcast({ event: "awareness", data }, exceptSender(origin));
    });

    window.addEventListener("mouseup", this.onMouseUp);
    document.addEventListener("fullscreenchange", this.onFullscreenChange);
  },
  beforeUnmount() {
    window.removeEventListener("message", this.messageHandler);
    window.removeEventListener("mouseup", this.onMouseUp);
    document.removeEventListener("fullscreenchange", this.onFullscreenChange);
    this.communication.on("message", undefined);
    this._stateUnsub?.();
    this._awarenessUnsub?.();
    // Our frames go with us.
    for (const clients of this._frameAwareness.values()) {
      this.communication.removeAwareness([...clients]);
    }
    this._frameAwareness.clear();
    this.grid?.destroy();
  },

  async mounted() {
    this.gridUpdate();
  },

  methods: {
    // Each room has its own item elements (see the v-for key), so the size a
    // module was resized to in one room stays in that room.
    itemKey(m: { url: string }, i: number | string): string {
      return `${this.roomName}|${i}|${m.url}`;
    },

    // Delegated on the root, so it also covers items created after a room
    // switch or a module reload.
    onMouseDown(event: MouseEvent) {
      if (this.phone) return;
      const target = event.target as HTMLElement;
      // The drag overlay would cover the button before mouseup and swallow its click.
      if (target?.closest?.("button")) return;
      const element = target?.closest?.(".item") as HTMLElement;
      if (!element) return;

      const rect = element.getBoundingClientRect();
      const nearBottom = rect.bottom - event.clientY < 16;
      const nearRight = rect.right - event.clientX < 16;

      if (nearBottom || nearRight) {
        this.isResizing = true;
        this._resizingItem = element;
        element.style.setProperty("z-index", "100");
      } else {
        this.isMoving = true;
      }
    },

    onMouseUp() {
      if (this.isResizing) {
        this.isResizing = false;
        const element = this._resizingItem;
        this._resizingItem = null;
        if (element) {
          element.style.removeProperty("z-index");
          const key = element.dataset.itemKey;
          if (key) {
            this.itemSizes[key] = {
              width: element.style.width,
              height: element.style.height,
            };
          }
        }
        if (this.grid) {
          this.grid.refreshItems().layout();
        }
      }
      this.isMoving = false;
    },

    // Shows the module (header and frame) full screen, or leaves it.
    toggleFullscreen(event: MouseEvent) {
      const item = (event.currentTarget as HTMLElement).closest(".item") as HTMLElement;
      if (document.fullscreenElement) {
        document.exitFullscreen?.();
      } else if (this.expandedKey) {
        this.expandedKey = null;
      } else if (item?.requestFullscreen) {
        item.requestFullscreen().catch((e) => debug.components.modules("Full screen refused", e));
      } else {
        this.expandedKey = item?.dataset.itemKey ?? null;
      }
    },

    isExpanded(key: string): boolean {
      return this.fullscreenKey === key || this.expandedKey === key;
    },

    onFullscreenChange() {
      const element = document.fullscreenElement as HTMLElement | null;
      this.fullscreenKey = element?.dataset?.itemKey ?? null;
    },

    gridUpdate() {
      if (this.grid !== null) this.grid.destroy();
      this.grid = null;
      if (this.phone) return;

      this.grid = new Muuri(".grid", {
        dragEnabled: true,
        layoutOnInit: true,
        layoutDuration: 400,
        layoutEasing: "ease",

        layout: {
          fillGaps: true,
          horizontal: false,
          alignRight: false,
          alignBottom: false,
          rounding: true,
        },

        dragStartPredicate: (item, e) => {
          if (e.deltaTime > 50 && !this.isResizing) {
            return true;
          }
        },
      });
    },

    width(w: string): string {
      switch (w) {
        case "full":
          return "1030px";
        case "half":
          return "510px";
        default: {
          if (typeof w === "number") {
            return w + "px";
          }
          return "200px";
        }
      }
    },

    // An object, not a string: Vue patches it per property, a string would
    // replace cssText and drop the transform Muuri positions the item with.
    styling(height: string, width: string, key?: string): Record<string, string> {
      const style: Record<string, string> = {};
      const resized = key ? this.itemSizes[key] : undefined;

      if (resized?.width) {
        style.width = resized.width;
      } else if (typeof width === "number") {
        style.width = `${width}px`;
      }

      if (resized?.height) {
        style.height = resized.height;
      } else if (typeof height === "number") {
        style.height = `${height}px`;
      }

      return style;
    },

    height(h: string): string {
      switch (h) {
        case "huge":
          return "840px";
        case "tall":
          return "720px";
        case "medium":
          return "410px";
        default: {
          if (typeof h === "number") {
            return h + "px";
          }
          return "200px";
        }
      }
    },

    size(height: string, width: string): string {
      let result = ["item"];

      switch (height) {
        case "huge":
          result.push("item--h4");
          break;
        case "tall":
          result.push("item--h3");
          break;
        case "medium":
          result.push("item--h2");
          break;
      }

      switch (width) {
        case "full":
          result.push("item--w3");
          break;
        case "half":
          result.push("item--w2");
          break;
      }

      return result.join(" ");
    },

    // True if `source` is one of our module iframes. Inlined modules run on a
    // data: URL with an opaque "null" origin, so the sender window, not the
    // origin, is what identifies a module.
    isModuleWindow(source: MessageEventSource | null): boolean {
      if (!source) return false;
      const iframes = this.$el?.querySelectorAll?.("iframe") ?? [];
      return Array.from(iframes).some((f: HTMLIFrameElement) => f.contentWindow === source);
    },

    messageHandler(e) {
      // Any window that holds a reference to this one (an opener, another
      // frame) can post here; only modules may write state or send messages.
      if (!this.isModuleWindow(e.source)) {
        debug.components.modules("[Security] Ignored message from a non-module window:", e.origin);
        return;
      }

      switch (e.data.event) {
        case "message":
          this.sendMessage(e.data.subject, e.data.body, e.data.user, e.data.module);
          break;
        case "state":
          this.communication.updateState(e.data.data, e.source);
          break;
        case "awareness":
          if (this.communication.updateAwareness(e.data.data, e.source)) {
            this.rememberAwareness(e.source, e.data.data);
          }
          break;
        case "echo":
          debug.components.modules("ECHO:", e.data);
          break;
        case "reload":
          // a full reload is needed
          setTimeout(() => {
            this.communication.update("room");
          }, 100);
          break;
        case "requestWebRTCConfig": {
          // Only to a module still at its own origin. Inlined modules run on data: URLs: their origin
          // is "null", and they are addressed with "*".
          const requestOrigin = e.origin;
          const targetOrigin = this.scrapedModulesFilter
            .map((m) => m.origin || new URL(m.url).origin)
            .find((o) => o === requestOrigin || (o === "*" && requestOrigin === "null"));

          if (targetOrigin) {
            this.communication.getWebRTCConfig().then(config => {
              e.source.postMessage({
                event: "webrtcConfig",
                config: config
              }, targetOrigin);
            });
          } else {
            debug.components.modules("[Security] Rejected WebRTC config request from untrusted origin:", requestOrigin);
          }
          break;
        }
        default:
          debug.components.modules("Unknown event", e.data);
          break;
      }
    },

    // A frame that just (re)loaded only sees awareness changes from now on, so
    // idle peers' cursors would show up only with their next renewal (~15 s).
    // Hand it every current state, right after its first update.
    moduleLoaded(frame?: Window, origin?: string) {
      this.dropGoneAwareness(frame);
      this.communication.update("room");
      if (frame && origin) {
        frame.postMessage({ event: "awareness", data: this.communication.getAwarenessState() }, origin);
      }
    },

    rememberAwareness(frame: Window, data: Uint8Array) {
      let clients = this._frameAwareness.get(frame);
      if (!clients) this._frameAwareness.set(frame, (clients = new Set()));
      try {
        for (const id of this.communication.awarenessClients(data)) clients.add(id);
      } catch (e) {
        debug.components.modules("Unreadable awareness update", e);
      }
    },

    // Remove the awareness of frames that are gone: `reloaded` (its previous
    // document; the new one hasn't published yet) and any that is no longer one
    // of our iframes (remounted on a room switch, or removed). A module can only
    // have removed what it published itself.
    dropGoneAwareness(reloaded?: Window) {
      for (const [frame, clients] of this._frameAwareness) {
        if (frame === reloaded || !this.isModuleWindow(frame)) {
          this.communication.removeAwareness([...clients]);
          this._frameAwareness.delete(frame);
        }
      }
    },

    async sendMessage(subject, body, user, module_url) {
      if (body !== undefined) {
        this.communication.broadcast(this.roomName, {
          from: this.username /* Email if teacher, name if station */,
          subject: subject,
          body: body,
          user: user,
          module: module_url,
        });
      }
    },

    // Returns room english name
    normalizeRoomName(room: string, translatedNames: Record<string, string>) {
      for (const prefix of this.roomPrefixTranslations) {
        // only "Room 2" or "Room *": a longer name such as "Room A 2" is a label
        const rest = room.slice(prefix.length).trim();
        if (room.startsWith(prefix + ' ') && rest && !rest.includes(' ')) {
          return `room ${rest}`;
        }
      }
      return translatedNames[room.toLowerCase()] || room;
    },

    // Whether the room is one of the showIn entries: whole names, `*` as a
    // wildcard ("Room 1" is not "Room 10"; other characters are literal).
    checkRoomMatch(normalizedShowIn: string[], currentRoom: string) {
      return showInMatches(normalizedShowIn, currentRoom);
    },
  },
};
</script>

<template>
  <div :key="role" @mousedown.capture="onMouseDown">
    <div
      class="grid"
      :class="{ 'grid--stacked': phone }"
      :v-show="liveClassProxy !== null ? true : false"
      style="width: 100%"
    >
      <div
        class="item"
        v-for="(m, i) in scrapedModulesFilter"
        :key="itemKey(m, i)"
        :data-item-key="itemKey(m, i)"
        :class="[size(m.height, m.width), { 'item--expanded': expandedKey === itemKey(m, i) }]"
        :width="width(m.width)"
        :height="height(m.height)"
        :style="styling(m.height, m.width, itemKey(m, i))"
      >
        <div class="item-header">
          <span class="item-title">{{ m.name }}</span>
          <button
            type="button"
            class="item-expand"
            :aria-label="isExpanded(itemKey(m, i)) ? t('modules.collapse') : t('modules.expand')"
            @click="toggleFullscreen($event)"
          >
            <v-icon
              :icon="isExpanded(itemKey(m, i)) ? 'mdi-arrow-collapse' : 'mdi-arrow-expand'"
              size="16"
            ></v-icon>
          </button>
        </div>
        <div v-show="isMoving || isResizing" class="item-overlay-protection"></div>
        <Module
          class="item-content"
          :key="i"
          :username="username"
          :live-class-proxy="liveClassProxy"
          :scrapedModule="m"
          :role="role"
          :class_id="class_id"
          :room-label="roomLabel"
          @loaded="moduleLoaded"
        >
        </Module>
      </div>
    </div>

    <div v-if="isLoading" role="status" class="modules-note modules-note--loading">
      <svg width="20" height="20" viewBox="0 0 22 22" aria-hidden="true" class="ring">
        <circle cx="11" cy="11" r="8" fill="none" stroke-width="2.5" class="ring-track"></circle>
        <path d="M11 3a8 8 0 0 1 8 8" fill="none" stroke-width="2.5" stroke-linecap="round" class="ring-arc"></path>
      </svg>
      {{ t('modules.loading') }}
    </div>

    <div v-else-if="!scrapedModules_.length" class="modules-note">
      <template v-if="role == 'teacher' || role == 'station'">
        {{ t('modules.noModules.teacher') }}
      </template>
      <template v-if="role == 'student'">
        {{ t('modules.noModules.student') }}
      </template>
    </div>

    <div v-else-if="!scrapedModulesFilter.length" class="modules-note">
      {{ t('modules.noModulesInRoom') }}
    </div>
  </div>
</template>

<style scoped>
.item {
  display: flex;
  position: absolute;
  width: 250px;
  height: 200px;
  margin: 5px;
  z-index: 1;
  max-width: 99%;
  flex-direction: column;
  background: rgb(var(--v-theme-module));
  border-radius: 12px;
  resize: both;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.05), 0 0 0 1px rgb(var(--v-theme-module-edge));
}

.v-theme--dark .item {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25), 0 0 0 1px rgb(var(--v-theme-module-edge));
}

.item-content {
  flex: 1;
  min-height: 0;
}

.item--w2 {
  width: 510px;
}

.item--w3 {
  width: 1030;
}

.item--h2 {
  height: 410px;
}

.item--h3 {
  height: 720px;
}

.item--h4 {
  height: 830px;
}

.grid {
  position: relative;
  width: 100%;
  margin: 0 auto;
}

.item.muuri-item-dragging {
  z-index: 3;
  cursor: grabbing;
}
.item.muuri-item-releasing {
  z-index: 2;
}
.item.muuri-item-hidden {
  z-index: 0;
}

/* the strip you drag a module by */
.item-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  height: 36px;
  padding-inline: 14px 6px;
  background: rgb(var(--v-theme-module-head));
  border-bottom: 1px solid rgb(var(--v-theme-module-line));
  cursor: grab;
}

.item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-muted));
}

.item-expand {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: rgb(var(--v-theme-module-icon));
  cursor: pointer;
}

.item-expand:hover {
  background: rgb(var(--v-theme-module-line));
}

.item-expand:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

/* full screen: no corner radius, no resize grip */
.item:fullscreen,
.item--expanded {
  border-radius: 0;
  resize: none;
}

/* phones: one module under the other, full width, at most 70% of the screen tall */
.grid--stacked {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.grid--stacked .item {
  position: relative;
  width: 100% !important;
  max-width: 100%;
  max-height: 70vh;
  margin: 0;
  resize: none;
  transform: none !important;
}

.grid--stacked .item-header {
  height: 40px;
  padding-inline-end: 4px;
  cursor: default;
}

.grid--stacked .item-expand {
  width: 40px;
  height: 40px;
  border-radius: 8px;
}

/* filling the window instead of full screen (on phones too) */
.grid .item.item--expanded {
  position: fixed;
  inset: 0;
  z-index: 2000;
  width: 100% !important;
  max-width: none;
  height: 100% !important;
  max-height: none;
  margin: 0;
  transform: none !important;
}

.modules-note {
  padding: 14px 16px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-text-2));
  font-size: 14px;
  line-height: 1.5;
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.05), 0 0 0 1px rgb(var(--v-theme-module-edge));
}

.v-theme--dark .modules-note {
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25), 0 0 0 1px rgb(var(--v-theme-panel-line));
}

.modules-note--loading {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgb(var(--v-theme-on-surface));
}

.ring {
  flex-shrink: 0;
  animation: ring-spin 0.9s linear infinite;
}

.ring-track {
  stroke: rgb(var(--v-theme-track));
}

.ring-arc {
  stroke: currentColor;
}

@keyframes ring-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .ring {
    animation-duration: 3s;
  }
}

.item-overlay-protection {
  width: 100%;
  height: 100%;
  position: absolute;
  z-index: 100;
}
</style>
