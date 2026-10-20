<script lang="ts">
import Module from "./Module.vue";
import Muuri from "muuri";
import { useI18n } from 'vue-i18n';

import en from '../locales/en.yaml';
import de from '../locales/de.yaml';
import uk from '../locales/uk.yaml';
import ar from '../locales/ar.yaml';
import es from '../locales/es.yaml';

import { debug } from "../api/debugHandler";

export default {
  components: { Module },

  name: "Modules",

  props: [
    "role",
    "username_",
    "liveClassProxy",
    "scrapedModules_",
    "isLoading",
    "communication",
    "class_id",
  ],

  setup() {
    const { t, locale } = useI18n();

    return {
      t,
      locale,
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
    };
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

        const isInRoom = this.checkRoomMatch(normalizedShowIn, this.roomName.toLowerCase());

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

    this.$nextTick(() => {
      setTimeout(() => {
        this.scrapedModulesFilter.forEach((m, index) => {
          const element = this.$refs[`resizableItem_${index}`][0];

          element.addEventListener(
            "mousedown",
            (event) => {
              const rect = element.getBoundingClientRect();
              const nearBottom = rect.bottom - event.clientY < 16;
              const nearRight  = rect.right  - event.clientX < 16;

              if (nearBottom || nearRight) {
                this.isResizing = true;
                element.style.setProperty("z-index", "100");
              } else {
                this.isMoving = true;
              }
            },
            true
          );
        });

        const onMouseUp = () => {
          if (this.isResizing) {
            this.isResizing = false;
            if (this.grid) {
              this.grid.refreshItems().layout();
            }
          }
          this.isMoving = false;
        };
        window.addEventListener("mouseup", onMouseUp);
        this._resizeMouseUpHandler = onMouseUp;
      }, 1000);
    });
  },
  beforeUnmount() {
    window.removeEventListener("message", this.messageHandler);
    if (this._resizeMouseUpHandler) {
      window.removeEventListener("mouseup", this._resizeMouseUpHandler);
    }
    this.communication.on("message", undefined);
    this._stateUnsub?.();
    this._awarenessUnsub?.();
    // Our frames go with us.
    for (const clients of this._frameAwareness.values()) {
      this.communication.removeAwareness([...clients]);
    }
    this._frameAwareness.clear();
    this.grid.destroy();
  },

  async mounted() {
    this.gridUpdate();
  },

  methods: {
    gridUpdate() {
      if (this.grid !== null) this.grid.destroy();

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

    styling(height: string, width: string): string {
      let style = "";

      if (typeof width === "number") {
        style += `width: ${width}px;`;
      }

      if (typeof height === "number") {
        style += `height: ${height}px;`;
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
        case "update":
          this.setToValue(this.liveClassProxy, e.data.path, e.data.value);
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
        case "requestWebRTCConfig":
          // Get config from Peer and send back to iframe
          // Validate the requesting origin against allowed module origins
          const requestOrigin = e.origin;
          const isAllowedOrigin = this.scrapedModulesFilter.some(m => {
            const moduleOrigin = m.origin || new URL(m.url).origin;
            return moduleOrigin === requestOrigin;
          });
          
          if (isAllowedOrigin) {
            this.communication.getWebRTCConfig().then(config => {
              e.source.postMessage({
                event: "webrtcConfig",
                config: config
              }, requestOrigin);
            });
          } else {
            debug.components.modules("[Security] Rejected WebRTC config request from untrusted origin:", requestOrigin);
          }
          break;
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
        if (room.startsWith(prefix)) {
          const roomNumber = room.split(' ').pop();
          return `room ${roomNumber}`;
        }
      }
      return translatedNames[room.toLowerCase()] || room;
    },

    // Check if the room name matches the showIn field
    checkRoomMatch(normalizedShowIn: string[], currentRoom: string) {
      return normalizedShowIn
        .map(e => e.toLowerCase().replace(/\*/g, ".*"))
        .map(e => new RegExp(e))
        .map(e => currentRoom.match(e) !== null)
        .includes(true);
    },
  },
};
</script>

<template>
  <div :key="role">
    <div
      class="grid"
      :v-show="liveClassProxy !== null ? true : false"
      style="width: 100%"
    >
      <div
        class="item"
        v-for="(m, i) in scrapedModulesFilter"
        :class="size(m.height, m.width)"
        :width="width(m.width)"
        :height="height(m.height)"
        :style="styling(m.height, m.width)"
        :ref="'resizableItem_' + i"
      >
        <span class="item-title">{{ m.name }}</span>
        <div v-show="isMoving || isResizing" class="item-overlay-protection"></div>
        <Module
          class="item-content"
          :key="i"
          :username="username"
          :live-class-proxy="liveClassProxy"
          :scrapedModule="m"
          :role="role"
          :class_id="class_id"
          @loaded="moduleLoaded"
        >
        </Module>
      </div>
    </div>

    <v-card v-if="isLoading">
      <v-card-text class="d-flex align-center">
        <v-progress-circular indeterminate size="20" width="2" class="mr-3" />
        {{ t('modules.loading') }}
      </v-card-text>
    </v-card>

    <v-card v-else-if="!scrapedModules_.length">
      <v-card-text v-if="role == 'teacher' || role == 'station'">
        {{ t('modules.noModules.1') }} {{ modulesType }} {{ t('modules.noModules.2') }}
      </v-card-text>
      <v-card-text v-if="role == 'student'">
        {{ t('modules.noModules.3') }}
      </v-card-text>
    </v-card>

    <v-card v-else-if="!scrapedModulesFilter.length">
      <v-card-text>
        {{ t('modules.noModulesInRoom') }}
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.item {
  display: block;
  position: absolute;
  width: 250px;
  height: 200px;
  margin: 5px;
  z-index: 1;
  max-width: 99%;
  border: 1px solid #888;
  border-top: 0.75rem solid #888;
  border-radius: 0.25rem;
  resize: both;
  overflow: hidden;
  box-shadow: 4px 4px 12px #00000080;
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

.item-title {
  background-color: #888;
  position: absolute;
  top: -0.3rem;
  right: 0;
  padding: 1px 4px;
  font-size: x-small;
  cursor: move;
}

.item-overlay-protection {
  width: 100%;
  height: 100%;
  position: absolute;
  z-index: 100;
}
</style>
