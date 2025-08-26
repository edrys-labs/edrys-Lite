<script lang="ts">
import Main from "./Settings/Main.vue";
import Members from "./Settings/Members.vue";
import Modules from "./Settings/Modules.vue";
import Stations from "./Settings/Stations.vue";
import Share from "./Settings/Share.vue";
import { useI18n } from "vue-i18n";
import Communication from "./Settings/Communication.vue";
import { decodeCommConfig, encodeCommConfig } from "../ts/Utils";
import { debug } from "../api/debugHandler";

export default {
  name: "Settings",

  props: {
    config: {
      type: Object,
      required: true,
    },

    scrapedModules: {
      type: Object,
      required: true,
    },

    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  emits: ["close", "saveClass", "deleteClass", "updateClass"],

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    return {
      tab: 0,
      configClone: JSON.parse(JSON.stringify(this.config)),
      configChanged: false,
    };
  },

  methods: {
    updateModules() {
      debug.components.settings("updateModules", this.scrapedModules);
    },
    saveClass() {
      this.$emit("saveClass", this.config);
      this.configClone = JSON.parse(JSON.stringify(this.config));
      this.configChanged = false;
      
      if (this.$refs.CommunicationComponent) {
        this.$refs.CommunicationComponent.onSettingsSaved();
      }
    },
    deleteClass() {
      this.$emit("deleteClass");
    },
    updateClass() {
      this.$emit("updateClass", this.config);
    },
    updateMembers(members) {
      this.config.members = members;
    },
    updateCommunicationConfig(encodedConfig) {
      // Check if the configuration has actually changed
      const currentConfig = this.config.communicationConfig;

      if (currentConfig === encodedConfig) {
        return;
      }

      // Store the encoded config and mark as changed
      this.config.communicationConfig = encodedConfig;
      this.configChanged = true;
    },

    updateKeepUrlConfig(keepConfig) {
      this.config.keepUrlConfig = keepConfig;
      this.configChanged = true;
    },
  },

  watch: {
    config: {
      handler() {
        if (JSON.stringify(this.config) !== JSON.stringify(this.configClone)) {
          this.configChanged = true;
        } else {
          this.configChanged = false;
        }
      },
      deep: true,
    },
  },

  computed: {
    decodedCommunicationConfig() {
      const encodedConfig = this.config.communicationConfig;
      if (!encodedConfig) return {};

      return decodeCommConfig(encodedConfig) || {};
    },
  },

  components: { Main, Members, Modules, Stations, Share, Communication },
};
</script>

<template>
  <v-card>
    <v-toolbar dark flat>
      <v-toolbar-title>{{ t("settings.general.title") }}</v-toolbar-title>

      <span class="text-decoration-underline text-medium-emphasis">
        {{ t("settings.general.writeProtection") }}
        {{
          writeProtection
            ? t("settings.general.actions.on")
            : t("settings.general.actions.off")
        }}
      </span>

      <v-spacer></v-spacer>

      <v-btn icon @click="$emit('close')">
        <v-icon>mdi-close</v-icon>
      </v-btn>

      <template v-slot:extension>
        <v-tabs v-model="tab" fixed-tabs center-active show-arrows>
          <v-tab :active="tab == 0">
            <v-icon left style="margin-right: 15px"> mdi-book-open-outline </v-icon>
            {{ t("settings.general.Main") }}
          </v-tab>
          <v-tab :active="tab == 1">
            <v-icon left style="margin-right: 15px"> mdi-account-group </v-icon>
            {{ t("settings.general.Members") }}
          </v-tab>
          <v-tab :active="tab == 2">
            <v-icon left style="margin-right: 15px"> mdi-view-dashboard </v-icon>
            {{ t("settings.general.Modules") }}
          </v-tab>
          <v-tab :active="tab == 3">
            <v-icon left style="margin-right: 15px"> mdi-router-wireless </v-icon>
            {{ t("settings.general.Stations") }}
          </v-tab>
          <v-tab :active="tab == 4">
            <v-icon left style="margin-right: 15px"> mdi-share-variant </v-icon>
            {{ t("settings.general.Share") }}
          </v-tab>
          <v-tab :active="tab == 5">
            <v-icon left style="margin-right: 15px"> mdi-access-point-network </v-icon>
            {{ t("settings.general.Communication") }}
          </v-tab>
        </v-tabs>
      </template>
    </v-toolbar>
    <v-card-text style="height: 565px">
      <v-window v-model="tab" class="pt-5">
        <v-window-item>
          <Main :config="config" :writeProtection="writeProtection"></Main>
        </v-window-item>

        <v-window-item>
          <Members
            :members="config.members"
            @updateMembers="updateMembers"
            :writeProtection="writeProtection"
          ></Members>
        </v-window-item>

        <v-window-item>
          <Modules
            :config="config"
            :scraped-modules="scrapedModules"
            :writeProtection="writeProtection"
          ></Modules>
        </v-window-item>

        <v-window-item>
          <Stations :config="config" :writeProtection="writeProtection"></Stations>
        </v-window-item>

        <v-window-item>
          <Share :config="config" :writeProtection="writeProtection"></Share>
        </v-window-item>

        <v-window-item>
          <Communication
            ref="CommunicationComponent"
            :config="config.communicationConfig || ''"
            @update:config="updateCommunicationConfig"
            :writeProtection="writeProtection"
            :classId="config.id || ''"
            :keepUrlConfig="config.keepUrlConfig || false"
            @update:keepUrlConfig="updateKeepUrlConfig"
          ></Communication>
        </v-window-item>
      </v-window>
    </v-card-text>

    <v-card-actions>
      <v-btn
        @click="saveClass"
        color="primary"
        style="margin-top: 30px"
        :disabled="writeProtection"
      >
        <v-icon left> mdi-upload </v-icon>
        {{ t("settings.general.actions.save") }}
        <v-badge
          overlap
          dot
          v-if="configChanged"
          color="red"
          style="position: relative; bottom: 12px; left: 6px"
        >
        </v-badge>
      </v-btn>

      <v-menu>
        <template v-slot:activator="{ props }">
          <v-btn
            color=""
            v-bind="props"
            style="margin-top: 30px; margin-right: 10px; margin-left: 30px"
            class="float-right"
          >
            {{ t("settings.general.actions.delete") }}
          </v-btn>
        </template>

        <v-list>
          <v-list-item>
            <v-list-item-title>
              {{ t("settings.general.actions.deleteConfirm") }}
            </v-list-item-title>

            <v-btn
              color="red"
              depressed
              @click="deleteClass"
              class="float-right"
              style="margin-top: 10px"
            >
              {{ t("settings.general.actions.deleteForever") }}</v-btn
            >
          </v-list-item>
        </v-list>
      </v-menu>
    </v-card-actions>
  </v-card>
</template>
