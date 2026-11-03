<template>
  <h3 class="section-title">{{ t('settings.stations.title') }}</h3>
  <p class="section-text">{{ t('settings.stations.description') }}</p>

  <ol class="steps">
    <li>{{ t('settings.stations.steps.open') }}</li>
    <li>{{ t('settings.stations.steps.name') }}</li>
    <li>{{ t('settings.stations.steps.join') }}</li>
  </ol>

  <FieldLabel :label="t('settings.stations.linkLabel')">
    <v-text-field :model-value="url" readonly class="station-link">
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
</template>

<script lang="ts">
import { copyToClipboard} from "../../ts/Utils";
import { useI18n } from 'vue-i18n';
import FieldLabel from "../FieldLabel.vue";

export default {
  name: "Settings-Stations",
  components: { FieldLabel },

  props: {
    config: {
      type: Object,
      required: true,
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
.section-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
}

.section-text {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 1.5;
  color: rgb(var(--v-theme-text-2));
}

.steps {
  margin: 0 0 20px;
  padding-inline-start: 20px;
  font-size: 13px;
  line-height: 1.5;
}

.steps li + li {
  margin-top: 6px;
}

.station-link :deep(input) {
  font-family: "JetBrains Mono Variable", monospace;
  font-size: 13px;
}
</style>
