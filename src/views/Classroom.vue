<script lang="ts">
import Settings from "../components/Settings.vue";
import Chat from "../components/Chat.vue";
import Checks from "../components/Checks.vue";
import Modules from "../components/Modules.vue";
import Logger from "../components/Logger.vue";
import UserMenu from "../components/UserMenu.vue";
import { useI18n } from "vue-i18n";

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

import { copyToClipboard, deepEqual, roomColor } from "../ts/Utils";

import { debug } from "../api/debugHandler";

export default {
  props: ["id", "station", "owner"],

  setup() {
    const { t, locale } = useI18n();
    return { t, locale, roomColor };
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

    onMounted(() => {
      this.init();
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

    getRooms() {
      if (!this.liveClassProxy) return;

      const rooms = {};
      this.orderedRooms().forEach((key) => {
        rooms[key] = this.liveClassProxy.rooms[key];
      });

      return rooms;
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

    usersInRoom(name: string): [string, string, string, string][] {
      const users: [string, "black" | "dimgray", string, string][] = [];

      const icon = {
        teacher: "mdi-account-star-outline",
        student: "mdi-account-outline",
        station: "mdi-account-cog-outline",
        visitor: "mdi-account-eye-outline",
      };

      for (const id in this.liveClassProxy.users) {
        if (this.liveClassProxy.users[id].room === name) {
          let displayName = this.liveClassProxy.users[id].displayName;
          let userRole = this.liveClassProxy.users[id].role || "student";

          if (userRole === "student") {
            if (!this.communication.allowedToParticipate(getBasePeerID(id))) {
              userRole = "visitor";
            }
          }

          // Role and "you" are only shown by icon and color; spell them out
          // for screen readers.
          let label = this.t(`general.roles.${userRole}`);
          if (this.peerID === id) label += ", " + this.t("general.you");

          users.push([
            displayName,
            this.peerID === id ? "black" : "dimgray",
            icon[userRole],
            label,
          ]);
        }
      }

      return users;
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
    Chat,
    Checks,
    Settings,
    Modules,
    Logger,
    UserMenu,
  },
};
</script>

<template>
  <Checks :states="states" />

  <v-app>
    <v-layout>
      <v-app-bar color="surface-variant">
        <template v-slot:prepend>
          <v-app-bar-nav-icon
            :aria-label="t('classroom.sideMenu.rooms')"
            :aria-expanded="showSideMenu"
            @click="showSideMenu = !showSideMenu"
          ></v-app-bar-nav-icon>

          <v-app-bar-title style="color: white; text-decoration: none">
            <a href="./" title="Back to index-page" style="color: white; text-decoration: none">edrys-lite</a>
          </v-app-bar-title>
        </template>

        <v-spacer></v-spacer>

        <!-- The live region must exist before the chip appears to be announced -->
        <div role="status">
          <v-chip
            v-if="!online"
            color="warning"
            prepend-icon="mdi-wifi-off"
            class="mr-2"
            data-test="offline-chip"
          >
            {{ t("classroom.reconnecting") }}
          </v-chip>
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

        <v-divider
          class="mx-3 align-self-center"
          length="24"
          thickness="2"
          vertical
        ></v-divider>

        <v-btn
          icon
          :aria-label="chat.new ? t('classroom.chatUnread') : t('classroom.chat')"
          :aria-expanded="chat.open"
          @click="
            chat.open = !chat.open;
            chat.new = false;
          "
        >
          <v-badge dot color="red" v-if="chat.new">
            <v-icon icon="mdi-forum"></v-icon>
          </v-badge>
          <v-icon icon="mdi-forum" v-else></v-icon>
        </v-btn>

        <UserMenu>
          <template v-slot:user-role>
            <v-list-item>
              <v-list-item-title>{{ t("general.userRole") }}:</v-list-item-title>
              <v-list-item-subtitle>
                {{
                  getRole() === "teacher"
                    ? t("general.roles.teacher")
                    : getRole() === "student"
                    ? t("general.roles.student")
                    : t("general.roles.station")
                }}
              </v-list-item-subtitle>
            </v-list-item>
          </template>
        </UserMenu>
      </v-app-bar>

      <v-navigation-drawer temporary v-model="showSideMenu">
        <v-overlay v-model="showSideMenu" style="width: 275px" v-if="isStation">
          <v-card
            tile
            width="100%"
            class="text-center"
            style="margin-top: calc(50vh - 100px)"
          >
            <v-card-text class="white--text">
              {{ t("classroom.station.mode") }}
            </v-card-text>

            <v-divider></v-divider>

            <v-card-text>
              <v-form @submit.prevent="setStationName">
                <v-text-field
                  variant="solo"
                  v-model="stationNameInput"
                  :rules="stationNameRules"
                  :label="t('classroom.station.label')"
                  required
                  append-inner-icon="mdi-arrow-right"
                  @click:append-inner="setStationName"
                ></v-text-field>
              </v-form>

              {{ t("classroom.station.modeDescription") }}
            </v-card-text>
            <v-divider></v-divider>
            <v-card-text>
              <v-btn :href="'/?/classroom/' + id">
                <v-icon left>mdi-export-variant</v-icon>

                {{ t("classroom.station.exit") }}
              </v-btn>
            </v-card-text>
          </v-card>
        </v-overlay>

        <template v-slot:prepend>
          <v-list density="compact" nav>
            <v-list-item>
              <v-list-item-title>
                {{ configuration?.data?.name || "" }}
              </v-list-item-title>

              <v-list-item-subtitle>
                {{ t("classroom.sideMenu.onlineUsers") }}
                {{ Object.keys(liveClassProxy?.users || {}).length }}
              </v-list-item-subtitle>

              <template v-slot:append>
                <v-btn
                  color="grey"
                  icon="mdi-cog"
                  :title="t('classroom.sideMenu.settings')"
                  @click="showSettings = !showSettings"
                  variant="text"
                  v-if="isOwner || isTeacher"
                ></v-btn>
              </template>
            </v-list-item>
          </v-list>
        </template>
        <v-divider></v-divider>

        <v-list nav v-for="(room, name, i) in getRooms()" :key="i" density="compact">
          <v-list-item
            :prepend-icon="name === 'Lobby' ? 'mdi-account-group' : 'mdi-forum'"
            :title="translateRoomName(name)"
            :style="{
              backgroundColor: roomColor(name, orderedRooms()) + '22',
              borderLeft: '4px solid ' + roomColor(name, orderedRooms()),
              paddingTop: '0px',
              paddingBottom: '0px',
              minHeight: '2rem',
            }"
          >
            <template v-slot:append>
              <v-btn
                :icon="
                  ['ar', 'he', 'fa', 'ur'].includes(locale)
                    ? 'mdi-arrow-left-circle'
                    : 'mdi-arrow-right-circle'
                "
                variant="text"
                :aria-label="t('classroom.sideMenu.gotoRoom', { room: translateRoomName(name) })"
                @click="gotoRoom(name)"
              ></v-btn>
            </template>
          </v-list-item>

          <v-list-item
            v-for="([user, color, icon, label], j) in usersInRoom(name)"
            :key="j"
            :style="'min-height: 1.25rem; color: ' + color"
          >
            <template v-slot:prepend>
              <v-icon :icon="icon"></v-icon>
            </template>

            <v-list-item-title>{{
              user && user.includes("Station")
                ? user.replace("Station", t("classroom.sideMenu.station"))
                : user
            }}<span class="d-sr-only">, {{ label }}</span></v-list-item-title>
          </v-list-item>
        </v-list>

        <template v-slot:append>
          <div class="pa-2">
            <v-btn depressed block class="mb-2" @click="addRoom" v-if="isOwner" :disabled="!canAddRoom()">
              <v-icon left>mdi-forum</v-icon>
              {{ t("classroom.sideMenu.newRoom") }}
            </v-btn>
          </div>
        </template>
      </v-navigation-drawer>

      <Chat
        :show="chat.open"
        :messages="chat.messages"
        :truncated="chat.truncated"
        @sendMessage="sendMessage"
      >
      </Chat>

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
      max-width="1200px"
      width="90%"
      scrollable
      persistent
      :id="'settings' + componentKey"
    >
      <Settings
        ref="Settings"
        @close="showSettings = false"
        v-if="data"
        :config="data"
        :scrapedModules="scrapedModules"
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
    >
      {{ popup.message }}

      <template v-slot:actions>
        <v-btn variant="text" color="pink" @click="closePopup(popup.id)">
          {{ t("classroom.popup.close") }}
        </v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>
