<template>
  <v-alert
    variant="tonal"
    dense
    color="#1565c0"
    icon="mdi-information"
    :text="t('settings.stations.info')"
  >
    <v-container>
      <a :href="url" target="_blank" class="info-link">{{ url }}</a>
    </v-container>

    <template v-slot:append>
      <v-btn icon="mdi-content-copy" @click="copyUrl" variant="text"></v-btn>
    </template>
  </v-alert>
</template>

<script lang="ts">
import { copyToClipboard} from "../../ts/Utils";
import { useI18n } from 'vue-i18n';

export default {
  name: "Settings-Stations",

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
    };
  },

  methods: {
    copyUrl() {
      copyToClipboard(this.url);
    },
  },
};
</script>

<style scoped>
.info-link,
.info-link:visited,
.info-link:hover,
.info-link:active {
  color: #1e88e5;
}
</style>
