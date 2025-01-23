<template>
  <v-alert
    outlined
    dense
    type="info"
    :text="t('settings.stations.info')"
  >
    <v-container>
      <a :href="url" target="_blank">{{ url }}</a>
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
