<script lang="ts">
import Main from "./Settings/Main.vue";
import Members from "./Settings/Members.vue";
import Modules from "./Settings/Modules.vue";
import Stations from "./Settings/Stations.vue";
import Share from "./Settings/Share.vue";
import { useI18n } from "vue-i18n";
import Communication from "./Settings/Communication.vue";
import { decodeCommConfig } from "../ts/Utils";
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

    rooms: {
      type: Array,
      default: () => [],
    },

    stations: {
      type: Array,
      default: () => [],
    },
  },

  emits: ["close", "saveClass", "deleteClass", "updateClass"],

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    // Backfill stable module ids on the source before cloning so the clone and
    // the original agree (otherwise the id-only diff would falsely flag unsaved
    // changes).
    for (const module of this.config.modules || []) {
      if (!module.id) module.id = crypto.randomUUID();
    }

    return {
      tab: 0,
      configClone: JSON.parse(JSON.stringify(this.config)),
      configChanged: false,
      tabs: [
        { key: "Main", icon: "mdi-book-open-outline" },
        { key: "Members", icon: "mdi-account-group-outline" },
        { key: "Modules", icon: "mdi-view-grid-outline" },
        { key: "Stations", icon: "mdi-router-wireless" },
        { key: "Share", icon: "mdi-share-variant-outline" },
        { key: "Communication", icon: "mdi-access-point-network" },
      ],
    };
  },

  methods: {
    updateModules() {
      debug.components.settings("updateModules", this.scrapedModules);
    },
    saveClass() {
      Object.assign(this.config, JSON.parse(JSON.stringify(this.configClone)));
      this.$emit("saveClass", this.config);
      this.configChanged = false;

      if (this.$refs.CommunicationComponent) {
        this.$refs.CommunicationComponent.onSettingsSaved();
      }
    },
    deleteClass() {
      this.$emit("deleteClass");
    },
    updateClass() {
      this.$emit("updateClass", this.configClone);
    },
    updateMembers(members: any) {
      this.configClone.members = members;
    },
    updateCommunicationConfig(encodedConfig: string) {
      if (this.configClone.communicationConfig === encodedConfig) return;
      this.configClone.communicationConfig = encodedConfig;
      this.configChanged = true;
    },

    updateKeepUrlConfig(keepConfig: boolean) {
      this.configClone.keepUrlConfig = keepConfig;
      this.configChanged = true;
    },

    refreshConfigChanged() {
      this.configChanged =
        JSON.stringify(this.configClone) !== JSON.stringify(this.config);
    },
  },

  watch: {
    configClone: { handler: "refreshConfigChanged", deep: true },
    config: { handler: "refreshConfigChanged", deep: true },
  },

  computed: {
    decodedCommunicationConfig() {
      const encodedConfig = this.configClone.communicationConfig;
      if (!encodedConfig) return {};

      return decodeCommConfig(encodedConfig) || {};
    },
  },

  components: { Main, Members, Modules, Stations, Share, Communication },
};
</script>

<template>
  <v-card class="settings">
    <div class="settings-head">
      <h2>{{ t("settings.general.title") }}</h2>
      <v-btn
        icon="mdi-close"
        size="36"
        variant="text"
        class="head-btn"
        :aria-label="t('classroom.popup.close')"
        @click="$emit('close')"
      ></v-btn>
    </div>

    <div class="settings-tabs">
      <v-tabs v-model="tab" slider-color="primary" height="44" show-arrows>
        <v-tab
          v-for="(item, i) in tabs"
          :key="item.key"
          :value="i"
          :prepend-icon="item.icon"
        >
          {{ t("settings.general." + item.key) }}
        </v-tab>
      </v-tabs>
    </div>

    <v-card-text class="settings-body">
      <v-window v-model="tab">
        <v-window-item>
          <Main :config="configClone"></Main>
        </v-window-item>

        <v-window-item>
          <Members
            :members="configClone.members"
            :classId="configClone.id || ''"
            @updateMembers="updateMembers"
          ></Members>
        </v-window-item>

        <v-window-item>
          <Modules
            :config="configClone"
            :scraped-modules="scrapedModules"
            :rooms="rooms"
          ></Modules>
        </v-window-item>

        <v-window-item>
          <Stations :config="configClone" :stations="stations"></Stations>
        </v-window-item>

        <v-window-item>
          <Share :config="configClone"></Share>
        </v-window-item>

        <v-window-item>
          <Communication
            ref="CommunicationComponent"
            :config="configClone.communicationConfig || ''"
            @update:config="updateCommunicationConfig"
            :classId="configClone.id || ''"
            :keepUrlConfig="configClone.keepUrlConfig || false"
            @update:keepUrlConfig="updateKeepUrlConfig"
          ></Communication>
        </v-window-item>
      </v-window>
    </v-card-text>

    <div class="settings-foot">
      <v-menu location="top start">
        <template v-slot:activator="{ props }">
          <v-btn v-bind="props" variant="outlined" color="error" class="delete-class">
            {{ t("settings.general.actions.delete") }}
          </v-btn>
        </template>

        <v-card class="confirm">
          <p>{{ t("settings.general.actions.deleteConfirm") }}</p>
          <div class="confirm-actions">
            <v-btn variant="text" height="34">{{ t("settings.general.actions.cancel") }}</v-btn>
            <v-btn color="danger-fill" variant="flat" height="34" @click="deleteClass">
              {{ t("settings.general.actions.deleteForever") }}
            </v-btn>
          </div>
        </v-card>
      </v-menu>

      <v-spacer></v-spacer>
      <span v-if="configChanged" class="unsaved">{{ t("settings.general.unsaved") }}</span>

      <v-btn color="primary" variant="flat" prepend-icon="mdi-upload" class="save" @click="saveClass">
        {{ t("settings.general.actions.save") }}
        <span v-if="configChanged" class="save-dot" aria-hidden="true"></span>
      </v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.settings-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 0 24px;
}

.settings-head h2 {
  flex: 1;
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.head-btn {
  color: rgb(var(--v-theme-muted));
}

.settings-tabs {
  padding: 10px 16px 0;
  border-bottom: 1px solid rgb(var(--v-theme-panel-line));
}

.settings-tabs :deep(.v-tab) {
  padding: 0 14px;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: rgb(var(--v-theme-muted));
}

.settings-tabs :deep(.v-tab.v-tab--selected) {
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
}

.settings-tabs :deep(.v-tab .v-icon) {
  font-size: 17px;
}

.settings-body {
  height: 550px;
  padding: 0 !important;
}

/* padding inside the window: it clips at its edge, and an outlined field's
   label sits above the field */
.settings-body > .v-window {
  padding: 20px 24px;
}

.settings-foot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 14px 24px;
  border-top: 1px solid rgb(var(--v-theme-panel-line));
}

.delete-class {
  border-color: rgb(var(--v-theme-danger-line));
}

.unsaved {
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
}
</style>
