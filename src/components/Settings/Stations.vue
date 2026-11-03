<template>
  <SectionHead :title="t('settings.stations.title')" :text="t('settings.stations.description')" icon="mdi-router-wireless" :color="2" />

  <ol class="steps">
    <li>{{ t('settings.stations.steps.open') }}</li>
    <li>{{ t('settings.stations.steps.name') }}</li>
    <li>{{ t('settings.stations.steps.join') }}</li>
  </ol>

  <FieldLabel :label="t('settings.stations.linkLabel')">
    <v-text-field :model-value="url" readonly hide-details class="station-link ltr">
      <template v-slot:append-inner>
        <v-btn
          :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
          variant="text"
          density="comfortable"
          class="copy-btn"
          :aria-label="t('general.copyLink')"
          :title="t('general.copyLink')"
          @click="copyUrl"
        ></v-btn>
        <!-- .stop: the field cancels the default of any click inside it, which would block the link -->
        <v-btn
          icon="mdi-open-in-new"
          variant="text"
          density="comfortable"
          :href="url"
          target="_blank"
          @click.stop
          :aria-label="t('settings.stations.open')"
          :title="t('settings.stations.open')"
        ></v-btn>
      </template>
    </v-text-field>
  </FieldLabel>

  <v-divider class="my-5"></v-divider>

  <SectionHead
    :title="t('settings.stations.connected')"
    :text="stations.length ? '' : t('settings.stations.none')"
    icon="mdi-lan-connect"
    :color="4"
  />
  <ul v-if="stations.length" class="station-list">
    <li v-for="station in stations" :key="station.name" class="station-row">
      <span class="station-tile" :style="{ background: station.tile.bg, color: station.tile.fg }">
        {{ station.initial }}
      </span>
      <span class="station-name">{{ station.label }}</span>
      <span v-if="station.people" class="station-people">
        <v-icon icon="mdi-account-outline" size="14"></v-icon>
        {{ t('classroom.sideMenu.people', { n: station.people }, station.people) }}
      </span>
      <span :class="['station-status', { offline: !station.online }]">
        <span class="status-dot" aria-hidden="true"></span>
        {{ station.online ? t('settings.stations.online') : t('settings.stations.reconnecting') }}
      </span>
    </li>
  </ul>
</template>

<script lang="ts">
import { copyToClipboard} from "../../ts/Utils";
import { useI18n } from 'vue-i18n';
import FieldLabel from "../FieldLabel.vue";
import SectionHead from "./SectionHead.vue";
import type { PropType } from "vue";

export type StationRoom = {
  name: string;
  label: string;
  initial: string;
  tile: { bg: string; fg: string };
  people: number;
  online: boolean;
};

export default {
  name: "Settings-Stations",
  components: { FieldLabel, SectionHead },

  props: {
    config: {
      type: Object,
      required: true,
    },

    // live station rooms, from the classroom's drawer data
    stations: {
      type: Array as PropType<StationRoom[]>,
      default: () => [],
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    return {
      url: window.location.toString().replace("classroom", "station"),
      copied: false,
    };
  },

  methods: {
    copyUrl() {
      copyToClipboard(this.url);
      this.copied = true;
      setTimeout(() => (this.copied = false), 2000);
    },
  },
};
</script>

<style scoped>
/* numbered circles, in line with the section text */
.steps {
  counter-reset: step;
  margin: 0 0 20px;
  padding-inline-start: 44px;
  list-style: none;
  font-size: 13px;
  line-height: 1.5;
}

.steps li {
  display: flex;
  align-items: center;
  gap: 10px;
  counter-increment: step;
}

.steps li::before {
  content: counter(step);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary-tint));
  color: rgb(var(--v-theme-primary-text));
  font-size: 11px;
  font-weight: 700;
}

.steps li + li {
  margin-top: 8px;
}

.station-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.station-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
  padding-block: 8px;
  padding-inline: 8px 12px;
  border-radius: 10px;
  background: rgb(var(--v-theme-row));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-row-edge));
}

.station-tile {
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

.station-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 600;
}

.station-people,
.station-status {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-text-2));
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-success));
}

.station-status.offline .status-dot {
  background: none;
  border: 1.5px solid rgb(var(--v-theme-muted));
}

.station-link :deep(input) {
  font-family: "JetBrains Mono Variable", monospace;
  font-size: 13px;
}
</style>
