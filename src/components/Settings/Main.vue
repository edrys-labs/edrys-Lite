<template>
  <v-text-field
    v-model="config.name"
    :counter="20"
    :label="t('settings.main.className')"
    outlined
    required
    :disabled="writeProtection"
  ></v-text-field>

  <v-text-field
    v-model="config.meta.logo"
    :label="t('settings.main.logoUrl')"
    outlined
    required
    :disabled="writeProtection"
  ></v-text-field>

  <v-textarea
    v-model="config.meta.description"
    filled
    :label="t('settings.main.description')"
    auto-grow
    :disabled="writeProtection"
  ></v-textarea>

  <v-text-field
    v-model="config.meta.defaultNumberOfRooms"
    :label="t('settings.main.roomsNum')"
    type="number"
    outlined
    :disabled="writeProtection"
  ></v-text-field>

  <v-checkbox
    v-model="config.meta.selfAssign"
    :label="t('settings.main.selfAssign')"
    outlined
    :disabled="writeProtection"
  ></v-checkbox>
</template>

<script lang="ts">
import { useI18n } from 'vue-i18n';

export default {
  name: "Settings-Main",

  props: {
    config: {
      type: Object,
      required: true,
    },

    writeProtection: {
      type: Boolean,
      required: true,
    },
  },

  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },

  data() {
    return {};
  },
};
</script>
