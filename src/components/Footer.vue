<script lang="ts">
import { useI18n } from "vue-i18n";
import { useDisplay } from "vuetify";

export default {
  name: "Footer",

  setup() {
    const { t, locale } = useI18n();
    const { xs: phone } = useDisplay();

    return {
      t,
      locale,
      phone,
    };
  },

  data() {
    return {};
  },
};
</script>

<template>
  <v-footer color="surface-variant" :app="true" :height="phone ? 52 : 48" class="edrys-bar footer">
    <v-row justify="center" align="center" no-gutters class="ga-2">
      <v-tooltip :text="t('footer.github')" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            size="36"
            rounded="lg"
            variant="text"
            icon="mdi-github"
            :aria-label="t('footer.github')"
            href="https://github.com/edrys-labs/edrys-Lite/"
            target="_blank"
            rel="noopener"
            class="bar-btn"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>

      <v-tooltip :text="t('footer.docs')" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            size="36"
            rounded="lg"
            variant="text"
            icon="mdi-book-open-page-variant-outline"
            :aria-label="t('footer.docs')"
            href="https://LiaScript.github.io/course/?https://raw.githubusercontent.com/edrys-labs/documentation/refs/heads/main/README.md"
            target="_blank"
            rel="noopener"
            class="bar-btn"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>

      <v-tooltip :text="t('footer.blog')" location="top">
        <template v-slot:activator="{ props }">
          <v-btn
            size="36"
            rounded="lg"
            variant="text"
            icon="mdi-post-outline"
            :aria-label="t('footer.blog')"
            href="https://edrys-labs.github.io/blog"
            target="_blank"
            rel="noopener"
            class="bar-btn"
            v-bind="props"
          >
          </v-btn>
        </template>
      </v-tooltip>
    </v-row>
  </v-footer>
</template>

<style scoped>
.footer .bar-btn :deep(.v-icon) {
  font-size: 18px;
}
</style>
