<script lang="ts">
import Settings from "../components/Settings.vue";
import Chat from "../components/Chat";
import Checks from "../components/Checks";
import Modules from "../components/Modules.vue";
import Logger from "../components/Logger.vue";

import { Database, DatabaseItem } from "../ts/Database";
import { infoHash, scrapeModule, clone, getPeerID, getShortPeerID } from "../ts/Utils";
import { onMounted } from "vue";
import Peer from "../ts/Peer";

import { copyToClipboard, deepEqual } from "../ts/Utils";

export default {
  props: ["id", "station", "hash"],

  data() {
    const database = new Database();

    const configuration: DatabaseItem | null = null;
    const data: any = null;
    const communication: Peer | null = null;

    //setTimeout(this.init, 100);

    let webRTCSupport = false;
    // @ts-ignore
    if (navigator.mediaDevices && navigator?.mediaDevices?.getUserMedia) {
      // WebRTC is supported
      webRTCSupport = true;
    }

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

      communication,
      isOwner: false,

      showSideMenu: true,
      showSettings: false,

      scrapedModules: [],

      liveClassProxy: null,

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
        (v: string) => !!v || "Name is required",
        (v: string) => !this.isNameTaken(v) || "Name is already taken",
      ],

      isLoggerVisible: false,
      isLoggerMinimized: false,
      isLoggerRunning: false,
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
    async init() {
      await this.database.setProtection(this.id, !!this.hash);

      this.configuration = await this.database.get(this.id);

      if (!!this.hash && this.configuration?.hash !== this.hash) {
        this.configuration = null;
      }

      if (!this.communication) {
        this.communication = new Peer(
          this.configuration
            ? this.configuration
            : { id: this.id, data: null, timestamp: 0, hash: this.hash },
          this.stationName
        );
      }

      const self = this;

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
        this.isOwner =
          this.peerID.startsWith(this.configuration.data.createdBy) ||
          this.getRole() === "teacher";
        this.scrapeModules();
      }

      this.communication.on("setup", (configuration: DatabaseItem) => {
        try {
          if (
            configuration.timestamp &&
            configuration &&
            !deepEqual(self.configuration.data, configuration.data)
          ) {
            self.database.put(configuration);
            self.init();
          }
        } catch (e) {
          if (configuration.timestamp && configuration) {
            self.database.put(configuration);
            self.init();
          }
        }
      });
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
        return "station";
      }

      if (
        this.isOwner ||
        this.configuration?.data?.members?.teacher?.includes(getPeerID(false))
      ) {
        return "teacher";
      }

      return "student";
    },

    async scrapeModules() {
      this.states.receivedConfiguration = true;

      this.scrapedModules = [];
      for (let i = 0; i < this.data.modules.length; i++) {
        let module = await scrapeModule(this.data.modules[i]);
        this.scrapedModules.push(module);
      }

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

      this.componentKey++;

      /*
      setTimeout(() => {
        self.communication = new Comm2(
          this.id,
          this.room.data.meta.defaultNumberOfRooms,
          this.stationName
        );

        self.communication.on("update", (config: any) => {
          self.liveClassProxy = config.data;
        });

        self.liveClassProxy = self.communication.getDoc();
        self.states.connectedToNetwork = true;

        self.componentKey++;
      }, Math.random() * 1000 + 1000);
      */
    },

    saveClass(configuration: any) {
      this.$refs.Settings.close = true;

      this.configuration.data = clone(configuration);
      this.data = clone(configuration);

      this.database.update(clone(this.configuration));

      this.scrapeModules();
    },

    usersInRoom(name: string): [string, string][] {
      const users: [string, "black" | "grey"][] = [];

      for (const id in this.liveClassProxy.users) {
        if (this.liveClassProxy.users[id].room === name) {
          const displayName = this.liveClassProxy.users[id].displayName;
          users.push([displayName, this.peerID === id ? "black" : "grey"]);
        }
      }

      //console.log("usersInRoom() called");

      return users;
    },

    gotoRoom(name: string) {
      this.communication?.gotoRoom(name);
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
        return; // If validation fails, do not submit
      }

      sessionStorage.setItem(`station_${this.id}`, this.stationNameInput);
      window.location.reload();
    },

    isNameTaken(name: string) {
      if (!this.liveClassProxy) return false;
      return Object.keys(this.liveClassProxy.rooms).includes("Station " + name);
    },
  },

  components: {
    Chat,
    Checks,
    Settings,
    Modules,
    Logger,
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
          <!-- remove underline from link -->

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

        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" icon="mdi-dots-vertical"> </v-btn>
          </template>

          <v-list>
            <v-list-item>
              <v-list-item-title> User ID: </v-list-item-title>
              <v-list-item-subtitle>
                {{ getPeer_ID() }}
                <v-btn
                  icon="mdi-content-copy"
                  size="small"
                  variant="flat"
                  @click="copyPeerID()"
                >
                </v-btn>
              </v-list-item-subtitle>
            </v-list-item>

            <v-list-item>
              <v-list-item-title> User Role: </v-list-item-title>
              <v-list-item-subtitle>
                {{ getRole() }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-menu>
      </v-app-bar>

      <v-navigation-drawer temporary v-model="showSideMenu">
        <v-overlay v-model="showSideMenu" style="width: 275px" v-if="isStation">
          <v-card
            tile
            width="100%"
            class="text-center"
            style="margin-top: calc(50vh - 100px)"
          >
            <v-card-text class="white--text"> Station Mode Active </v-card-text>

            <v-divider></v-divider>

            <v-card-text>
              <v-form @submit.prevent="setStationName">
                <v-text-field
                  variant="solo"
                  v-model="stationNameInput"
                  :rules="stationNameRules"
                  label="Station Name"
                  required
                  append-inner-icon="mdi-arrow-right"
                  @click:append-inner="setStationName"
                ></v-text-field>
              </v-form>

              This browser is now running as a station and ready to serve students
            </v-card-text>
            <v-divider></v-divider>
            <v-card-text>
              <v-btn :href="'/?/classroom/' + id">
                <v-icon left>mdi-export-variant</v-icon>

                Exit Station mode
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
                online users {{ Object.keys(liveClassProxy?.users || {}).length }}
              </v-list-item-subtitle>

              <template v-slot:append>
                <v-btn
                  color="grey"
                  icon="mdi-cog"
                  @click="showSettings = !showSettings"
                  variant="text"
                  v-if="!isStation && isOwner"
                ></v-btn>
              </template>
            </v-list-item>
          </v-list>
        </template>
        <v-divider></v-divider>

        <v-list nav v-for="(room, name, i) in getRooms()" :key="i" density="compact">
          <v-list-item
            :prepend-icon="name === 'Lobby' ? 'mdi-account-group' : 'mdi-forum'"
            :title="name"
            style="
              background-color: lightgray;
              padding-top: 0px;
              padding-bottom: 0px;
              min-height: 2rem;
            "
          >
            <template v-slot:append>
              <v-btn
                icon="mdi-arrow-right-circle"
                variant="text"
                @click="gotoRoom(name)"
              ></v-btn>
            </template>
          </v-list-item>

          <v-list-item
            v-for="([user, color], j) in usersInRoom(name)"
            :key="j"
            :title="user"
            :style="'min-height: 1.25rem; color: ' + color"
          />
        </v-list>

        <template v-slot:append>
          <div class="pa-2">
            <v-btn
              depressed
              block
              class="mb-2"
              @click="addRoom"
              v-if="!isStation && isOwner"
            >
              <v-icon left>mdi-forum</v-icon>
              New room
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
  </v-app>
</template>
