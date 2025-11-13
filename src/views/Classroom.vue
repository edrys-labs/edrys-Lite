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
  getShortPeerID,
  getBasePeerID,
  extractCommunicationConfigFromUrl,
  compareCommunicationConfig,
  cleanUrlAfterCommConfigExtraction,
  updateUrlWithCommConfig,
  encodeCommConfig,
  decodeCommConfig
} from "../ts/Utils";
import { onMounted } from "vue";
import Peer from "../ts/Peer";

import { copyToClipboard, deepEqual } from "../ts/Utils";

import { debug } from "../api/debugHandler";

export default {
  props: ["id", "station", "hash"],

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
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

      showSideMenu: true,
      showSettings: false,

      scrapedModules: [] as any[],

      liveClassProxy: liveClassProxy,

      isStation: this.station,

      peerID,
      userName: getShortPeerID(peerID),
      stationName,

      componentKey: 0,

      chat: {
        open: false,
        messages: [],
        truncated: false,
        new: false,
      },

      stationNameInput: stationName,
      stationNameRules: [
        (v: string) => !!v || this.t("classroom.station.rules.1"),
        (v: string) => !this.isNameTaken(v) || this.t("classroom.station.rules.2"),
      ],

      isLoggerVisible: false,
      isLoggerMinimized: false,
      isLoggerRunning: false,

      urlCommunicationConfig: null, // Stores URL-provided communication config 
    };
  },
  watch: {
    showSettings() {
      if (!this.showSettings) {
        this.data = clone(this.configuration.data);
      }
    },
  },

  methods: {
    copyPeerID() {
      copyToClipboard(getPeerID(false));
    },
    getPeer_ID() {
      return getPeerID(false);
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
      
      await this.database.setProtection(this.id, !!this.hash);
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
        config || { id: this.id, data: null, timestamp: 0, hash: this.hash };

      if (!!this.hash && this.configuration?.hash !== this.hash) {
        debug.views.classroom("Hash mismatch, resetting configuration");
        this.configuration = {
          id: this.id,
          data: null,
          timestamp: 0,
          hash: this.hash,
        };
      }
      
      // Create a minimal valid configuration structure if needed
      if (!this.configuration.data) {
        this.configuration.data = {
          name: "Connecting to classroom...",
          members: { student: ["*"], teacher: [] },
          modules: [],
          meta: { defaultNumberOfRooms: 0 },
          createdBy: ""
        };
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
        this.communication = new Peer(
          configurationCopy,
          this.stationName,
          this.t,
          null // password
        );
        
        this.communication.on("setup", async (configuration: DatabaseItem) => {          
          await self.database.put(clone(configuration));
          self.init();
        });

        this.communication.on("popup", this.addPopup);
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

      const sortedKeys = Object.keys(this.liveClassProxy.rooms).sort();

      const rooms = {};
      sortedKeys.forEach((key) => {
        rooms[key] = this.liveClassProxy.rooms[key];
      });

      return rooms;
    },

    getRole() {
      if (this.isStation) {
        this.isOwner = false;
        return "station";
      }

      if (
        this.peerID.startsWith(this.configuration.data.createdBy) ||
        this.configuration?.data?.members?.teacher?.includes(getPeerID(false))
      ) {
        this.isOwner = true;
        return "teacher";
      }

      this.isOwner = false;
      return "student";
    },

    async scrapeModules() {
      if (!this.data) return;

      this.states.receivedConfiguration = true;

      const scrapedModules: any[] = [];
      for (let i = 0; i < this.data.modules.length; i++) {
        let module = await scrapeModule(this.data.modules[i]);
        scrapedModules.push(module);
      }

      this.componentKey++;
      this.scrapedModules = scrapedModules;

      const self = this;

      this.communication.on("room", (config: any) => {
        self.liveClassProxy = config;
      });

      this.communication.on("chat", (chat: { messages: any; truncated: boolean }) => {
        self.chat.messages = chat.messages;
        self.chat.truncated = chat.truncated;

        if (!self.chat.open) {
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
      this.$refs.Settings.close = true;

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

    usersInRoom(name: string): [string, string, string][] {
      const users: [string, "black" | "grey", string][] = [];

      const icon = {
        teacher: "mdi-account-star-outline",
        student: "mdi-account-plus-outline",
        station: "mdi-account-cog-outline",
        visitor: "mdi-account-minus-outline",
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

          users.push([
            displayName,
            this.peerID === id ? "black" : "grey",
            icon[userRole],
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

    addRoom() {
      this.communication?.addRoom();
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
          <v-app-bar-nav-icon @click="showSideMenu = !showSideMenu"></v-app-bar-nav-icon>

          <v-app-bar-title
            tag="a"
            style="color: white; text-decoration: none"
            title="Back to index-page"
          >
            <a href="./" style="color: white; text-decoration: none">edrys-lite</a>
          </v-app-bar-title>
        </template>

        <v-spacer></v-spacer>

        <v-tooltip text="Open Logger" location="bottom">
          <template v-slot:activator="{ props }">
            <v-btn
              icon="mdi-console"
              :style="{ animation: isLoggerRunning ? 'blink 1.5s linear infinite' : '' }"
              v-bind="props"
              v-if="isStation"
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
                  v-if="isOwner"
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
            style="
              background-color: lightgray;
              padding-top: 0px;
              padding-bottom: 0px;
              min-height: 2rem;
            "
          >
            <template v-slot:append>
              <v-btn
                :icon="
                  ['ar', 'he', 'fa', 'ur'].includes(locale)
                    ? 'mdi-arrow-left-circle'
                    : 'mdi-arrow-right-circle'
                "
                variant="text"
                @click="gotoRoom(name)"
              ></v-btn>
            </template>
          </v-list-item>

          <v-list-item
            v-for="([user, color, icon], j) in usersInRoom(name)"
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
            }}</v-list-item-title>
          </v-list-item>
        </v-list>

        <template v-slot:append>
          <div class="pa-2">
            <v-btn depressed block class="mb-2" @click="addRoom" v-if="isOwner">
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
        :writeProtection="!!hash"
      ></Settings>
    </v-dialog>

    <v-dialog
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
