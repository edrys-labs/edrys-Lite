<script lang="ts">
import { useI18n } from 'vue-i18n';

export default {
  name: "Footer",

  setup() {
    const { t, locale } = useI18n();

    return {
      t,
      locale,
    };
  },

  data() {
    return {};
  },
};
</script>

<template>
  <v-footer color="surface-variant" :app="true" elevation="15">
    <v-row justify="center" no-gutters>
      <v-tooltip :text="t('footer.github')" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            density="compact"
            icon="mdi-github"
            href="https://github.com/edrys-labs/edrys-Lite/"
            target="_"
            class="mx-2"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>

      <v-tooltip :text="t('footer.docs')" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            density="compact"
            icon="mdi-information"
            href="https://github.com/edrys-labs/documentation"
            target="_"
            class="mx-2"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>

      <v-tooltip :text="t('footer.explore')" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            density="compact"
            icon="mdi-share-circle"
            href="https://github.com/topics/edrys-lab"
            target="_"
            class="mx-2"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>
    </v-row>
  </v-footer>
</template>
