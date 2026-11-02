<template>
  <FieldLabel :label="t('settings.main.className')">
    <v-text-field v-model="config.name" :counter="20" required></v-text-field>
  </FieldLabel>

  <FieldLabel :label="t('settings.main.logoUrl')">
    <v-text-field v-model="config.meta.logo" required></v-text-field>
  </FieldLabel>

  <FieldLabel :label="t('settings.main.description')">
    <v-textarea v-model="config.meta.description" auto-grow></v-textarea>
  </FieldLabel>

  <FieldLabel :label="t('settings.main.roomsNum')">
    <v-text-field
      v-model.number="config.meta.defaultNumberOfRooms"
      type="number"
      min="0"
      max="50"
    ></v-text-field>
  </FieldLabel>

  <!-- selfAssign checkbox hidden until the feature is implemented
  <v-checkbox
    v-model="config.meta.selfAssign"
    :label="t('settings.main.selfAssign')"
    outlined
  ></v-checkbox>
  -->
</template>

<script lang="ts">
import { useI18n } from 'vue-i18n';
import FieldLabel from "../FieldLabel.vue";

export default {
  name: "Settings-Main",
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
    return {};
  },
};
</script>
