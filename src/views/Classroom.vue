<script lang="ts">
import Settings from "../components/Settings.vue";
import Chat from "../components/Chat.vue";
import Checks from "../components/Checks.vue";
import Modules from "../components/Modules.vue";
import Logger from "../components/Logger.vue";
import UserMenu from "../components/UserMenu.vue";
import TutorChat from "../components/TutorChat.vue";
import AppBrand from "../components/AppBrand.vue";
import { useI18n } from "vue-i18n";
import { useDisplay, useRtl } from "vuetify";

import { Database, DatabaseItem } from "../ts/Database";
import {
  infoHash,
  scrapeModule,
  clone,
  getPeerID,
  getDisplayPeerID,
  getShortPeerID,
  getBasePeerID,
  extractCommunicationConfigFromUrl,
  compareCommunicationConfig,
  cleanUrlAfterCommConfigExtraction,
  updateUrlWithCommConfig,
  encodeCommConfig,
  decodeCommConfig,
  sameKey,
  isMember,
} from "../ts/Utils";
import { markRaw, onMounted } from "vue";
import Peer, { MAX_ROOMS } from "../ts/Peer";

import { copyToClipboard, deepEqual, roomSlot } from "../ts/Utils";
import { activeTheme, roomTile } from "../ts/Theme";

import { debug } from "../api/debugHandler";
import {
  devClassId,
  startDevBridge,
  classState,
  reportClass,
  rescrapeModules,
  withFresh,
} from "../ts/DevBridge";
import { startTutorRelay, tutorPeer } from "../ts/Tutor";

export default {
  props: ["id", "station", "owner"],

  setup() {
    const { t, locale } = useI18n();
    const { xs: phone } = useDisplay();
    const { isRtl: rtl } = useRtl();
    return { t, locale, activeTheme, phone, rtl };
  },

  data() {
    const database = new Database();
    const liveClassProxy: any = null;
    const configuration: DatabaseItem | null = {} as DatabaseItem;
    const data: any = null;
    const communication: Peer | null = null;

    // Check for WebRTC support
    let webRTCSupport = !!(
      window.RTCPeerConnection ||
      // @ts-ignore
      window.mozRTCPeerConnection ||
      // @ts-ignore
      window.webkitRTCPeerConnection
    );

    onMounted(async () => {
      await this.init();
      this.startDevMode();
    });

    let stationName: string | null = "";
    let peerID = getPeerID(true);

    if (this.station) {
      stationName = sessionStorage.getItem(`station_${this.id}`);

      if (!stationName) {
        stationName = infoHash(6);
        sessionStorage.setItem(`station_${this.id}`, stationName);
      }

      peerID = "Station " + stationName;
    }

    return {
      state: true,
      states: {
        webRTCSupport,
        receivedConfiguration: null,
        connectedToNetwork: null,
      },

      database,
      configuration,
      data,

      popups: [],

      communication,
      isOwner: false,
      isTeacher: false,

      showSideMenu: true,
      showSettings: false,

      scrapedModules: [] as any[],
      isLoadingModules: false,

      liveClassProxy: liveClassProxy,

      isStation: this.station,

      peerID,
      userName: this.station ? peerID : getShortPeerID(peerID),
      stationName,

      componentKey: 0,

      tutor: { open: false, new: false },

      chat: {
        open: false,
        messages: [],
        truncated: false,
        new: false,
        since: Date.now(),
      },

      stationNameInput: stationName,
      stationNameRules: [
        (v: string) => !!v || this.t("classroom.station.rules.1"),
        (v: string) => !this.isNameTaken(v) || this.t("classroom.station.rules.2"),
      ],

      // Hidden for now: the Logger is moving into a separate edrys module.
      isLoggerEnabled: false,
      isLoggerVisible: false,
      isLoggerMinimized: false,
      isLoggerRunning: false,

      urlCommunicationConfig: null, // Stores URL-provided communication config 

      // False while the connection to the class is lost (the transport reconnects).
      online: true,
    };
  },
  computed: {
    // the class owner's tab with edrys-dev's tutor and its key, for everyone but that owner and stations
    tutorTab(): { id: string; key: string } | null {
      if (this.isOwner || this.isStation) return null;
      return tutorPeer(this.liveClassProxy?.users, this.configuration?.data?.createdBy);
    },
    tutorId(): string | null {
      return this.tutorTab?.id ?? null;
    },
    currentRoom(): string | null {
      return this.liveClassProxy?.users?.[this.peerID]?.room ?? null;
    },
    myKey(): string {
      return getPeerID(false);
    },
    // whose chat messages get the Teacher badge
    teacherKeys(): string[] {
      const data = this.configuration?.data;
      return [data?.createdBy, ...(data?.members?.teacher || [])].filter(Boolean);
    },
    // Everything the drawer shows per room, built once per change.
    drawerRooms() {
      // the member lists decide who is a visitor
      void this.configuration?.data?.members;
      const rooms = this.orderedRooms();
      const users = Object.entries(this.liveClassProxy?.users || {}) as [string, any][];

      return rooms.map((name) => {
        const inRoom = users.filter(([, user]) => user.room === name).map(([id, user]) => this.drawerUser(id, user));
        // the station is the room's equipment, so a free station shows no count
        const people = inRoom.filter((user) => user.role !== "station").length;
        const label = this.translateRoomName(name);
        const numbered = name.match(/^Room (.+)$/);
        const goto = this.t("classroom.sideMenu.gotoRoom", { room: label });

        return {
          name,
          label,
          // "Room 3" shows its number, other rooms their first letter
          initial: numbered ? numbered[1] : label.charAt(0).toUpperCase(),
          tile: roomTile(roomSlot(name, rooms), this.activeTheme),
          users: inRoom,
          people,
          gotoLabel: people ? goto + ", " + this.peopleLabel(people) : goto,
        };
      });
    },
    // the drawer entry of the room you are in
    myRoom() {
      return this.drawerRooms.find((room) => room.name === this.currentRoom) ?? null;
    },
    stationTile() {
      return roomTile(roomSlot("Station " + this.stationName, this.orderedRooms()), this.activeTheme);
    },
    drawerWidth(): number {
      return this.phone ? 312 : 264;
    },
  },
  watch: {
    showSettings() {
      if (!this.showSettings) {
        this.data = clone(this.configuration.data);
      }
    },
  },
  // The router remounts the app on popstate (back/forward, hash-only
  // navigation); without this the old Peer stays live in the room.
  beforeUnmount() {
    this.communication?.stop();
    this._stopDevBridge?.();
  },

  methods: {
    copyPeerID() {
      copyToClipboard(getPeerID(false));
    },
    getPeer_ID() {
      return getDisplayPeerID();
    },

    addPopup(message: string) {
      this.popups.unshift({
        message,
        open: true,
        id: Date.now(),
      });
    },

    async init() {
      const self = this;
      
      // Extract communication config from URL and decode it if needed
      const urlCommConfig = extractCommunicationConfigFromUrl();
      
      const config = await this.database.get(this.id);
      
      if (urlCommConfig) {
        this.urlCommunicationConfig = encodeCommConfig(urlCommConfig);
      }
      
      const hardReload =
        this.scrapedModules.length === 0 ||
        !this.configuration ||
        !this.configuration.data ||
        (config &&
          config.data &&
          !deepEqual(this.configuration?.data?.modules, config?.data.modules));

      this.configuration =
        config || { id: this.id, data: null, timestamp: 0, hash: null };
      
      // Create a minimal valid configuration structure if needed
      if (!this.configuration.data) {
        this.configuration.data = {
          name: "Connecting to classroom...",
          members: { student: ["*"], teacher: [] },
          modules: [],
          meta: { defaultNumberOfRooms: 0 },
          createdBy: ""
        };
      } else {
        // A real configuration: its (possibly empty) module list is authoritative.
        this.states.receivedConfiguration = true;
      }

      const configurationCopy = JSON.parse(JSON.stringify(this.configuration));
      const shouldKeepConfigInUrl = config?.data?.keepUrlConfig === true;
      
      // Determine which communication config to use (saved vs URL)
      if (shouldKeepConfigInUrl && config?.data?.communicationConfig) {
        const savedCommConfig = decodeCommConfig(config.data.communicationConfig);
        if (savedCommConfig) {
          configurationCopy.data.communicationConfig = config.data.communicationConfig;
          this.configuration.data.communicationConfig = config.data.communicationConfig;
          
          updateUrlWithCommConfig(savedCommConfig);
        }
      } else if (this.urlCommunicationConfig) {
        configurationCopy.data.communicationConfig = this.urlCommunicationConfig;
        this.configuration.data.communicationConfig = this.urlCommunicationConfig;
        
        cleanUrlAfterCommConfigExtraction(true);
      } else {
        cleanUrlAfterCommConfigExtraction(true);
      }

      if (!this.communication) {
        // markRaw: a reactive Proxy around the Peer would also wrap its Yjs doc.
        // Yjs compares items by identity while merging, so writes made through
        // the proxy can be merged wrongly and lose concurrent updates (e.g. the
        // class configuration vanishing when a station joins).
        this.communication = markRaw(new Peer(
          configurationCopy,
          this.stationName,
          this.t,
          null, // password
          this.owner || undefined
        ));
        
        this.communication.on("setup", async (configuration: DatabaseItem) => {
          const previousModules = self.data?.modules;
          await self.database.put(clone(configuration));
          await self.init();
          self.data = clone(configuration.data);
          self.states.receivedConfiguration = true;
          if (!deepEqual(previousModules, configuration.data?.modules)) {
            self.scrapeModules();
          }
          // Re-join with correct role if setup arrived after the initial connect-time join
          const correctRole = self.getRole();
          if (self.communication.role !== correctRole) {
            self.communication.join(correctRole);
          }
        });

        this.communication.on("popup", this.addPopup);
        this.communication.on("online", (online: boolean) => {
          self.online = online;
        });
      }

      this.database.setObservable(this.id, (config: DatabaseItem) => {
        try {
          if (config && !deepEqual(self.configuration.data, config.data)) {
            self.configuration = config;
            self.communication?.newSetup(config);
          }
        } catch (e) {
          if (config) {
            self.configuration = config;
            self.communication?.newSetup(config);
          }
        }
      });

      if (this.configuration) {
        this.data = clone(this.configuration.data);

        this.getRole();
        
        if (hardReload) {
          this.scrapeModules();
        }
      }
    },

    orderedRooms(): string[] {
      if (!this.liveClassProxy) return [];

      return Object.keys(this.liveClassProxy.rooms).sort((a, b) =>
        a.localeCompare(b, undefined, { numeric: true })
      );
    },

    getRole() {
      if (this.isStation) {
        this.isOwner = false;
        return "station";
      }

      if (sameKey(getPeerID(false), this.configuration.data.createdBy)) {
        this.isOwner = true;
        this.isTeacher = true;
        return "teacher";
      }

      if (isMember(this.configuration?.data?.members?.teacher, getPeerID(false))) {
        this.isOwner = false;
        this.isTeacher = true;
        return "teacher";
      }

      this.isOwner = false;
      this.isTeacher = false;
      return "student";
    },

    async scrapeModules() {
      if (!this.data) return;

      // Calls can overlap (e.g. saving Settings while the class's first modules
      // are still loading); only the newest may set the list, or a slow older
      // scrape overwrites it with the previous modules.
      const run = (this._scrapeRun = (this._scrapeRun || 0) + 1);

      // Each scrapeModule() is a network round-trip; run them together so the
      // loading window is one RTT rather than one per module.
      this.isLoadingModules = true;
      let scrapedModules: any[];
      try {
        scrapedModules = await Promise.all(
          this.data.modules.map((module: any) => scrapeModule(module))
        );
      } finally {
        if (run === this._scrapeRun) this.isLoadingModules = false;
      }
      if (run !== this._scrapeRun) return;

      this.componentKey++;
      this.scrapedModules = scrapedModules;

      const self = this;

      this.communication.on("room", (config: any) => {
        self.liveClassProxy = config;
      });

      this.communication.on("chat", (chat: { messages: any; truncated: boolean }) => {
        // Only messages new to us and written since we opened the class: the
        // history arrives in parts (the doc, then its writers' presence).
        const known = new Set(self.chat.messages.map((m: any) => m.signature));
        const fresh = chat.messages.some(
          (m: any) => !known.has(m.signature) && m.timestamp >= self.chat.since
        );

        self.chat.messages = chat.messages;
        self.chat.truncated = chat.truncated;

        if (fresh && !self.chat.open) {
          self.chat.new = true;
        }
      });

      this.communication.on("connected", (state: boolean) => {
        self.states.connectedToNetwork = state;
        this.communication.join(this.getRole());
      });

      setTimeout(() => {
        this.communication.update("room");
      }, 1000);
    },

    saveClass(configuration: any) {
      // Settings is only mounted while its dialog is open.
      if (this.$refs.Settings) this.$refs.Settings.close = true;

      // Get the current encoded config
      const oldEncodedConfig = this.configuration?.data?.communicationConfig || null;
      const newEncodedConfig = configuration.communicationConfig || null;
      
      // Decode for comparison
      const oldConfig = oldEncodedConfig ? decodeCommConfig(oldEncodedConfig) : null;
      const newConfig = newEncodedConfig ? decodeCommConfig(newEncodedConfig) : null;
      
      // Check if communication settings have changed
      const communicationChanged = !compareCommunicationConfig(oldConfig, newConfig);
      
      // Check if modules have changed
      const modulesChanged = !deepEqual(
        this.configuration.data.modules,
        configuration.modules
      );
      
      this.configuration.data = clone(configuration);
      this.data = clone(configuration);

      // Save to database
      this.database.update(clone(this.configuration)).then(async (id) => {        
        const config = await this.database.get(id);
        
        this.communication?.newSetup(config);
      });
      
      this.getRole();
      
      // Only reload the modules if they've changed
      if (modulesChanged && !communicationChanged) {
        this.scrapeModules();
      }
    },

    // Served by edrys-dev and opened with `?dev`: the lab file drives this class.
    startDevMode() {
      if (devClassId() !== this.id || !this.isOwner) return;

      const apply = (lab: any) => {
        const current = this.configuration.data;
        const configuration = {
          ...lab,
          id: current.id,
          createdBy: current.createdBy,
        };
        if (!configuration.communicationConfig && current.communicationConfig) {
          configuration.communicationConfig = current.communicationConfig;
        }

        const changed = !deepEqual(configuration, current);
        if (changed) this.saveClass(configuration);
        return changed;
      };

      const goto = ({ room }: { room?: string }) => {
        if (room && this.liveClassProxy?.rooms?.[room]) this.gotoRoom(room);
      };

      // only the changed modules, scraped again, merged into the list as it is
      // then: another reload may have set it meanwhile (a new list, so the
      // class report sees the change too)
      const reloadModule = async ({ urls }: { urls: string[] }) => {
        const run = this._scrapeRun;
        const fresh = await rescrapeModules(this.data.modules, urls, scrapeModule);
        // none of ours, or a newer scrape of the whole class (e.g. a lab change) came first
        if (!fresh.size || run !== this._scrapeRun) return;
        this.scrapedModules = withFresh(this.scrapedModules, fresh);
      };

      // a room of the class, its state read from the doc (the live class's copy lags)
      const readState = (room: string) =>
        this.liveClassProxy?.rooms?.[room] ? this.communication.roomState(room) ?? {} : undefined;

      // students' questions to edrys-dev's tutor, and its answers back
      const relay = startTutorRelay(
        this.communication,
        (base: string) => this.communication.allowedToParticipate(base),
        (id: string) => this.liveClassProxy?.users?.[id]?.room ?? ""
      );
      // the key is made once per tab; the last switch wins
      let switches = 0;
      const tutor = async (on: boolean) => {
        const run = ++switches;
        const key = on ? await relay.publicKey() : null;
        if (run === switches) this.communication.setTutor(key);
      };

      const stopBridge = startDevBridge(apply, {
        goto,
        reloadModule,
        readState,
        tutor,
        tutorAnswer: relay.answer,
      });

      // what the agent sees of the class: rooms, who is where, the modules
      const unwatch = this.$watch(
        () => [this.liveClassProxy, this.scrapedModules],
        ([live, scraped]: any[]) => {
          if (live) reportClass(classState(live, this.peerID, this.configuration.data, scraped));
        }
      );

      this._stopDevBridge = () => {
        unwatch();
        stopBridge();
        relay.stop();
      };
    },

    // One entry per user: role (students not on the member list are visitors),
    // the tag shown next to the name and the label read out instead.
    drawerUser(id: string, user: any) {
      let role = user.role || "student";
      if (role === "student" && !this.communication.allowedToParticipate(getBasePeerID(id))) {
        role = "visitor";
      }

      // Students are the default and go untagged; screen readers get the
      // role spelled out for everyone.
      const tags: string[] = [];
      if (this.peerID === id) tags.push(this.t("general.you"));
      if (role === "teacher" || role === "visitor") {
        tags.push(this.t(`general.roles.${role}`));
      }

      let label = this.t(`general.roles.${role}`);
      if (this.peerID === id) label += ", " + this.t("general.you");

      const name = user.displayName;
      return {
        id,
        name: name?.includes("Station")
          ? name.replace("Station", this.t("classroom.sideMenu.station"))
          : name,
        role,
        tag: tags.join(" · "),
        label,
      };
    },

    peopleLabel(count: number): string {
      return this.t("classroom.sideMenu.people", { n: count }, count);
    },

    closePopup(id: number) {
      for (let i = 0; i < this.popups.length; i++) {
        if (this.popups[i].id === id) {
          this.popups.splice(i, 1);
          break;
        }
      }
    },

    gotoRoom(name: string) {
      this.communication?.gotoRoom(name);

      setTimeout(() => {
        this.communication?.update("room");
      }, 1000);
    },

    roomCount(): number {
      return Number(this.configuration?.data?.meta?.defaultNumberOfRooms) || 0;
    },

    canAddRoom(): boolean {
      return this.roomCount() < MAX_ROOMS;
    },

    // Rooms come from the room count in the setup, so a new room is a saved +1.
    addRoom() {
      if (!this.canAddRoom()) return;
      const configuration = clone(this.configuration.data);
      configuration.meta = {
        ...configuration.meta,
        defaultNumberOfRooms: this.roomCount() + 1,
      };
      this.saveClass(configuration);
    },

    deleteClass() {
      this.database.drop(this.configuration.id);
      window.location.search = "";
    },

    updateClass(config: any) {
      this.data = clone(config.data);
    },

    sendMessage(message: string) {
      this.communication.sendMessage(message);
    },

    setStationName() {
      const isValid = this.stationNameRules.every(
        (rule) => rule(this.stationNameInput) === true
      );
      if (!isValid) {
        return;
      }

      sessionStorage.setItem(`station_${this.id}`, this.stationNameInput);
      window.location.reload();
    },

    isNameTaken(name: string) {
      if (!this.liveClassProxy) return false;
      return Object.keys(this.liveClassProxy.rooms).includes("Station " + name);
    },

    translateRoomName(name: string): string {
      if (name === "Lobby") return this.t("classroom.sideMenu.lobby");
      if (name.includes("Station"))
        return name.replace("Station", this.t("classroom.sideMenu.station"));
      return name.replace("Room", this.t("classroom.sideMenu.room"));
    },
  },

  components: {
    AppBrand,
    Chat,
    Checks,
    Settings,
    Modules,
    Logger,
    UserMenu,
    TutorChat,
  },
};
</script>

<template>
  <Checks :states="states" :className="configuration?.data?.name" />

  <v-app>
    <v-layout>
      <v-app-bar color="surface-variant" height="56" flat class="edrys-bar" :class="{ 'edrys-bar--phone': phone }">
        <div class="bar-start">
          <v-btn
            icon="mdi-menu"
            size="36"
            rounded="lg"
            variant="text"
            class="bar-btn"
            :class="{ 'bar-btn--active': showSideMenu }"
            :aria-label="t('classroom.sideMenu.rooms')"
            :aria-expanded="showSideMenu"
            @click="showSideMenu = !showSideMenu"
          ></v-btn>

          <AppBrand v-if="!phone" />

          <!-- on phones the pill takes the brand's place and stays -->
          <button
            v-if="myRoom && (phone || !showSideMenu)"
            type="button"
            class="room-pill"
            :aria-label="t('classroom.sideMenu.rooms') + ': ' + myRoom.label + ', ' + peopleLabel(myRoom.people)"
            :aria-expanded="showSideMenu"
            data-test="room-pill"
            @click="showSideMenu = true"
          >
            <span
              class="room-tile room-tile--small"
              :style="{ background: myRoom.tile.bg, color: myRoom.tile.fg }"
              aria-hidden="true"
              >{{ myRoom.initial }}</span
            >
            <span class="room-pill-name">{{ myRoom.label }}</span>
            <span class="room-pill-count" aria-hidden="true">
              <v-icon icon="mdi-account-outline" size="13"></v-icon>
              {{ myRoom.people }}
            </span>
          </button>
        </div>

        <v-spacer v-if="!phone"></v-spacer>

        <!-- The live region must exist before the chip appears to be announced -->
        <div role="status">
          <span v-if="!online" class="offline-chip" data-test="offline-chip">
            <v-icon icon="mdi-wifi-off" size="14" aria-hidden="true"></v-icon>
            <span :class="{ 'd-sr-only': phone }">{{ t("classroom.reconnecting") }}</span>
          </span>
        </div>

        <v-tooltip text="Open Logger" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              icon="mdi-console"
              :style="{ animation: isLoggerRunning ? 'blink 1.5s linear infinite' : '' }"
              v-bind="props"
              v-if="isLoggerEnabled && isStation"
              @click="
                isLoggerVisible = true;
                isLoggerMinimized = false;
              "
            >
            </v-btn>
          </template>
        </v-tooltip>

        <div v-if="!phone" class="bar-divider" aria-hidden="true"></div>

        <div class="bar-end">
          <v-btn
            icon
            size="36"
            rounded="lg"
            variant="text"
            class="bar-btn"
            :class="{ 'bar-btn--active': tutor.open }"
            v-if="tutorId || tutor.open"
            :aria-label="tutor.new ? t('tutor.buttonUnread') : t('tutor.button')"
            :aria-expanded="tutor.open"
            :title="t('tutor.title')"
            data-test="tutor-button"
            @click="
              tutor.open = !tutor.open;
              tutor.new = false;
            "
          >
            <v-icon icon="mdi-robot-outline"></v-icon>
            <span v-if="tutor.new" class="bar-dot"></span>
          </v-btn>

          <v-btn
            icon
            size="36"
            rounded="lg"
            variant="text"
            class="bar-btn"
            :class="{ 'bar-btn--active': chat.open }"
            :aria-label="chat.new ? t('classroom.chatUnread') : t('classroom.chat')"
            :aria-expanded="chat.open"
            @click="
              chat.open = !chat.open;
              chat.new = false;
            "
          >
            <v-icon icon="mdi-message-outline"></v-icon>
            <span v-if="chat.new" class="bar-dot"></span>
          </v-btn>

          <UserMenu>
            <template v-slot:user-role>{{ t(`general.roles.${getRole()}`) }}</template>
          </UserMenu>
        </div>
      </v-app-bar>

      <v-navigation-drawer
        temporary
        v-model="showSideMenu"
        :width="drawerWidth"
        color="panel"
        class="rooms-drawer"
        :class="{ 'rooms-drawer--phone': phone }"
      >
        <v-overlay v-model="showSideMenu" :style="{ width: drawerWidth + 'px' }" v-if="isStation">
          <v-card class="station-card" style="margin-top: calc(50vh - 150px)">
            <div class="station-card-head">
              <span
                class="station-card-tile"
                :style="{ background: stationTile.bg, color: stationTile.fg }"
              >
                <v-icon icon="mdi-router-wireless" size="20"></v-icon>
              </span>
              <h3 class="station-card-title">{{ t("classroom.station.mode") }}</h3>
            </div>

            <v-form @submit.prevent="setStationName">
              <label for="station-name" class="station-card-label">{{ t("classroom.station.label") }}</label>
              <div class="station-card-field">
                <v-text-field
                  id="station-name"
                  variant="outlined"
                  density="compact"
                  hide-details="auto"
                  v-model="stationNameInput"
                  :rules="stationNameRules"
                  required
                ></v-text-field>
                <v-btn
                  :icon="rtl ? 'mdi-arrow-left' : 'mdi-arrow-right'"
                  size="40"
                  rounded="lg"
                  color="primary"
                  variant="flat"
                  :aria-label="t('classroom.station.label')"
                  @click="setStationName"
                ></v-btn>
              </div>
            </v-form>

            <p class="station-card-text">{{ t("classroom.station.modeDescription") }}</p>

            <v-btn
              :href="'/?/classroom/' + id"
              variant="outlined"
              height="38"
              rounded="lg"
              prepend-icon="mdi-open-in-new"
              class="drawer-btn station-card-exit"
            >
              {{ t("classroom.station.exit") }}
            </v-btn>
          </v-card>
        </v-overlay>

        <template v-slot:prepend>
          <div class="drawer-head">
            <div class="drawer-head-text">
              <div class="drawer-class-name">{{ configuration?.data?.name || "" }}</div>
              <div class="drawer-online">
                {{ t("classroom.sideMenu.onlineUsers") }}
                {{ Object.keys(liveClassProxy?.users || {}).length }}
              </div>
            </div>
            <v-btn
              v-if="phone"
              :icon="rtl ? 'mdi-menu-close' : 'mdi-menu-open'"
              size="44"
              rounded="lg"
              variant="text"
              class="drawer-settings"
              :aria-label="t('classroom.sideMenu.close')"
              @click="showSideMenu = false"
            ></v-btn>
            <v-btn
              v-else-if="isOwner || isTeacher"
              icon="mdi-cog-outline"
              size="32"
              rounded="lg"
              variant="text"
              class="drawer-settings"
              :aria-label="t('classroom.sideMenu.settings')"
              :title="t('classroom.sideMenu.settings')"
              @click="showSettings = !showSettings"
            ></v-btn>
          </div>
        </template>

        <div class="room-list">
          <div
            v-for="room in drawerRooms"
            :key="room.name"
            class="room"
            :class="{ 'room--station': room.name.startsWith('Station') }"
          >
            <button
              type="button"
              class="room-row"
              :class="{ 'room-row--current': room.name === currentRoom }"
              :aria-current="room.name === currentRoom ? 'true' : undefined"
              :aria-label="room.gotoLabel"
              @click="gotoRoom(room.name)"
            >
              <span class="room-tile" :style="{ background: room.tile.bg, color: room.tile.fg }">
                {{ room.initial }}
              </span>
              <span class="room-name">{{ room.label }}</span>
              <span v-if="room.people" class="room-count">
                <v-icon icon="mdi-account-outline" size="13"></v-icon>
                {{ room.people }}
              </span>
              <span class="room-enter">
                <v-icon :icon="rtl ? 'mdi-arrow-left' : 'mdi-arrow-right'" size="15"></v-icon>
              </span>
            </button>

            <div v-for="user in room.users" :key="user.id" class="room-user">
              <span
                class="user-avatar"
                :class="{ 'user-avatar--station': user.role === 'station' }"
                :style="user.role === 'station' ? { background: room.tile.bg } : undefined"
              >
                <span
                  class="user-dot"
                  :style="user.role === 'station' ? { background: room.tile.dot } : undefined"
                ></span>
              </span>
              <span class="user-name" :class="{ 'user-name--id': user.role !== 'station' }"
                >{{ user.name }}<span class="d-sr-only">, {{ user.label }}</span></span
              >
              <span v-if="user.tag" class="user-tag" aria-hidden="true">{{ user.tag }}</span>
            </div>
          </div>
        </div>

        <template v-slot:append>
          <div class="drawer-foot" v-if="isOwner || phone">
            <!-- phones hide the brand, the bar's link to the list -->
            <v-btn
              v-if="phone"
              block
              :height="44"
              rounded="lg"
              variant="flat"
              color="surface"
              :prepend-icon="rtl ? 'mdi-arrow-right' : 'mdi-arrow-left'"
              href="./"
              class="drawer-btn"
            >
              {{ t("index.classroom.title") }}
            </v-btn>
            <v-btn
              v-if="phone && (isOwner || isTeacher)"
              block
              :height="44"
              rounded="lg"
              variant="flat"
              color="surface"
              prepend-icon="mdi-cog-outline"
              class="drawer-btn"
              @click="showSettings = true"
            >
              {{ t("classroom.sideMenu.settings") }}
            </v-btn>
            <v-btn
              v-if="isOwner"
              block
              :height="phone ? 44 : 40"
              rounded="lg"
              variant="flat"
              color="surface"
              prepend-icon="mdi-plus"
              class="drawer-btn"
              @click="addRoom"
              :disabled="!canAddRoom()"
            >
              {{ t("classroom.sideMenu.newRoom") }}
            </v-btn>
          </div>
        </template>
      </v-navigation-drawer>

      <Chat
        :show="chat.open"
        :messages="chat.messages"
        :truncated="chat.truncated"
        :me="myKey"
        :teachers="teacherKeys"
        :className="configuration?.data?.name"
        @sendMessage="sendMessage"
        @close="chat.open = false"
      >
      </Chat>

      <TutorChat
        v-if="tutorId || tutor.open"
        v-model:show="tutor.open"
        :communication="communication"
        :tutorId="tutorId"
        :tutorKey="tutorTab?.key"
        :owner="configuration?.data?.createdBy"
        :classId="id"
        @answered="if (!tutor.open) tutor.new = true;"
      ></TutorChat>

      <v-main style="overflow-y: scroll">
        <v-col>
          <Modules
            :role="getRole()"
            :username_="peerID"
            :liveClassProxy="liveClassProxy"
            :scrapedModules_="scrapedModules"
            :isLoading="isLoadingModules || !states.receivedConfiguration"
            :communication="communication"
            v-if="liveClassProxy !== null"
            :key="componentKey"
            :class_id="id"
          >
          </Modules>
        </v-col>
      </v-main>
    </v-layout>

    <v-dialog
      v-model="showSettings"
      max-width="1000px"
      width="90%"
      scrollable
      persistent
      :fullscreen="phone"
      :id="'settings' + componentKey"
    >
      <Settings
        ref="Settings"
        @close="showSettings = false"
        v-if="data"
        :config="data"
        :scrapedModules="scrapedModules"
        :rooms="orderedRooms()"
        @saveClass="saveClass"
        @deleteClass="deleteClass"
        @updateClass="updateClass"
      ></Settings>
    </v-dialog>

    <v-dialog
      v-if="isLoggerEnabled"
      v-model="isLoggerVisible"
      max-width="1200px"
      width="90%"
      height="50%"
      scrollable
      persistent
      :id="'logger' + componentKey"
      :style="{ display: isLoggerMinimized ? 'none' : 'flex' }"
    >
      <Logger
        @close="
          isLoggerVisible = false;
          isLoggerMinimized = false;
        "
        @minimize="isLoggerMinimized = true"
        @logger-started="isLoggerRunning = true"
        @logger-stopped="isLoggerRunning = false"
        :liveClassProxy="liveClassProxy"
        :classId="id"
        :stationName="stationName"
        :database="database"
      >
      </Logger>
    </v-dialog>

    <v-snackbar
      v-for="popup in popups"
      :key="popup.id"
      v-model="popup.open"
      :multi-line="true"
      :timeout="500000"
      color="toast"
      class="edrys-toast"
    >
      {{ popup.message }}

      <template v-slot:actions>
        <v-btn variant="text" height="32" class="toast-action" @click="closePopup(popup.id)">
          {{ t("classroom.popup.close") }}
        </v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<style scoped>
.bar-start,
.bar-end {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding-inline: 12px;
}

.bar-end {
  gap: 4px;
}

.bar-divider {
  width: 1px;
  height: 24px;
  margin: 0 4px;
  background: rgb(var(--v-theme-bar-divider));
}

/* lost connection; on phones only the icon shows */
.offline-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  margin-inline-end: 8px;
  padding-inline: 10px 12px;
  border-radius: 999px;
  background: rgb(var(--v-theme-warning-tint));
  color: rgb(var(--v-theme-warning));
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
}

/* phones: menu, the room pill across the bar, chat and the user menu */
.edrys-bar--phone .bar-start {
  flex: 1;
  gap: 4px;
  padding-inline: 4px 0;
}

.edrys-bar--phone .bar-end {
  padding-inline: 0 4px;
}

.edrys-bar--phone .room-pill {
  flex: 1;
  height: 36px;
  font-size: 14px;
}

.edrys-bar--phone .room-pill-name {
  flex: 1;
  text-align: start;
}

.edrys-bar--phone .room-pill .room-tile--small {
  width: 22px;
  height: 22px;
}

/* The room you are in, while the drawer is closed */
.room-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding-block: 4px;
  padding-inline: 6px 10px;
  border: 0;
  border-radius: 8px;
  background: rgb(var(--v-theme-bar-active));
  color: rgb(var(--v-theme-on-surface-variant));
  font-family: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.room-pill:focus-visible {
  outline: 2px solid rgb(var(--v-theme-bar-icon));
  outline-offset: 2px;
}

.room-pill-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.room-pill-count {
  display: flex;
  align-items: center;
  gap: 3px;
  padding-inline-start: 6px;
  margin-inline-start: 2px;
  border-inline-start: 1px solid rgb(var(--v-theme-bar-divider));
  color: rgb(var(--v-theme-bar-icon));
  font-size: 12px;
}

.room-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 700;
}

.room-tile--small {
  width: 20px;
  height: 20px;
  border-radius: 6px;
  font-size: 11px;
}

/* Drawer */
.rooms-drawer {
  border-inline-end: 1px solid rgb(var(--v-theme-panel-line)) !important;
}

.drawer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 16px 12px 4px;
  padding: 0 0 12px;
  padding-inline-start: 6px;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}

.drawer-head-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.drawer-class-name {
  font-size: 14px;
  font-weight: 600;
}

.drawer-online {
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
}

.drawer-settings {
  flex-shrink: 0;
  color: rgb(var(--v-theme-muted));
}

.room-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px 12px 16px;
}

.room {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.room--station {
  margin-top: 6px;
}

/* One button per room: the arrow is only a cue */
.room-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: start;
  cursor: pointer;
}

.room-row:hover {
  background: rgb(var(--v-theme-room-hover));
}

.room-row--current,
.room-row--current:hover {
  background: rgb(var(--v-theme-room-current));
}

.v-theme--light .room-row--current {
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.08);
}

.room-row:focus-visible,
.drawer-btn:focus-visible,
.drawer-settings:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.room-name {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

.room-row--current .room-name {
  font-weight: 600;
}

.room-count {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

.room-enter {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-sizing: border-box;
  width: 28px;
  height: 28px;
  border: 1px solid rgb(var(--v-theme-line));
  border-radius: 999px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-text-2));
}

.room-row--current .room-enter {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.room-user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-block: 3px 5px;
  padding-inline: 52px 8px;
}

.user-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 999px;
  background: rgb(var(--v-theme-avatar));
}

.user-avatar--station {
  border-radius: 6px;
}

.user-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #8a919b;
}

.user-avatar--station .user-dot {
  border-radius: 2px;
}

.user-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: rgb(var(--v-theme-text-2));
}

.user-name--id {
  font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
  font-weight: 500;
}

.user-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

.drawer-foot {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid rgb(var(--v-theme-panel-line));
}

.rooms-drawer--phone .drawer-head {
  margin-inline-end: 4px;
}

.rooms-drawer--phone .drawer-class-name {
  font-size: 15px;
}

.rooms-drawer--phone .room-row {
  min-height: 52px;
}

.rooms-drawer--phone .room-name {
  font-size: 15px;
}

.drawer-btn {
  border: 1px solid rgb(var(--v-theme-line));
  font-size: 13px;
  font-weight: 600;
}

/* Station mode, over the drawer */
.station-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-inline: 12px;
  padding: 20px;
  border-radius: 12px;
}

.station-card-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.station-card-tile {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  border-radius: 10px;
}

.station-card-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.station-card-label {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

.station-card-field {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.station-card-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--v-theme-text-2));
}

.station-card-exit {
  align-self: flex-start;
  border-color: rgb(var(--v-theme-line));
}
</style>
