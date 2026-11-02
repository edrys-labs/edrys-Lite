<template>
  <v-alert color="info" icon="mdi-information-outline" :text="t('settings.stations.info')">
    <a :href="url" target="_blank" class="alert-link">{{ url }}</a>

    <template v-slot:append>
      <v-btn
        icon="mdi-content-copy"
        size="30"
        variant="text"
        class="alert-copy"
        :aria-label="t('general.copyLink')"
        @click="copyUrl"
      ></v-btn>
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
