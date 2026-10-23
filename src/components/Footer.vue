<script lang="ts">
import { useI18n } from "vue-i18n";

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
            :aria-label="t('footer.github')"
            href="https://github.com/edrys-labs/edrys-Lite/"
            target="_blank"
            rel="noopener"
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
            :aria-label="t('footer.docs')"
            href="https://LiaScript.github.io/course/?https://raw.githubusercontent.com/edrys-labs/documentation/refs/heads/main/README.md"
            target="_blank"
            rel="noopener"
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
            :aria-label="t('footer.explore')"
            href="https://github.com/topics/edrys-lab"
            target="_blank"
            rel="noopener"
            class="mx-2"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>

      <v-tooltip :text="t('footer.blog')" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            density="compact"
            icon="mdi-rss-box"
            :aria-label="t('footer.blog')"
            href="https://edrys-labs.github.io/blog"
            target="_blank"
            rel="noopener"
            class="mx-2"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>
    </v-row>
  </v-footer>
</template>
