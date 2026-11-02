<template>
  <v-menu :close-on-content-click="false">
    <template v-slot:activator="{ props }">
      <v-btn
        v-bind="props"
        icon="mdi-dots-vertical"
        size="36"
        rounded="lg"
        variant="text"
        class="bar-btn"
        :aria-label="t('general.menu')"
      ></v-btn>
    </template>

    <v-list>
      <v-list-item>
        <v-list-item-title>{{ t('general.userId') }}:</v-list-item-title>
        <v-list-item-subtitle>
          {{ peerID }}
          <v-tooltip :text="copied ? t('general.copied') : t('general.copyFullId')" location="top">
            <template v-slot:activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
                :color="copied ? 'success' : undefined"
                size="small"
                variant="flat"
                :aria-label="t('general.copyFullId')"
                @click.stop="copyPeerID()"
              >
              </v-btn>
            </template>
          </v-tooltip>
        </v-list-item-subtitle>
      </v-list-item>
      <v-divider></v-divider>
      <slot name="user-role"></slot>
      <v-divider class="mt-1"></v-divider>
      <v-list-item>
        <v-list-item-title class="mb-1">{{ t('general.language') }}:</v-list-item-title>
        <v-select
          v-model="locale"
          :items="languages"
          item-title="title"
          item-value="value"
          variant="outlined"
          density="compact"
          @update:model-value="changeLocale"
          @click.stop
        ></v-select>
      </v-list-item>
      <v-list-item>
        <v-list-item-title class="mb-1" id="theme-label">{{ t('general.theme.title') }}:</v-list-item-title>
        <v-btn-toggle
          :model-value="themePreference"
          @update:model-value="setThemePreference"
          mandatory
          divided
          density="compact"
          variant="outlined"
          role="radiogroup"
          aria-labelledby="theme-label"
        >
          <v-btn value="light" prepend-icon="mdi-white-balance-sunny" role="radio" :aria-checked="themePreference === 'light'">{{ t('general.theme.light') }}</v-btn>
          <v-btn value="dark" prepend-icon="mdi-weather-night" role="radio" :aria-checked="themePreference === 'dark'">{{ t('general.theme.dark') }}</v-btn>
          <v-btn value="system" prepend-icon="mdi-monitor" role="radio" :aria-checked="themePreference === 'system'">{{ t('general.theme.system') }}</v-btn>
        </v-btn-toggle>
      </v-list-item>
    </v-list>
  </v-menu>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyToClipboard, getDisplayPeerID, getPeerID } from '../ts/Utils';
import { themePreference, setThemePreference } from '../ts/Theme';

export default defineComponent({
  name: 'UserMenu',
  setup() {
    const { t, locale } = useI18n();
    return { t, locale, themePreference, setThemePreference };
  },
  data() {
    return {
      peerID: getDisplayPeerID(),
      copied: false,
      languages: [
        { title: 'English', value: 'en' },
        { title: 'Deutsch', value: 'de' },
        { title: 'Українська', value: 'uk' },
        { title: 'العربية', value: 'ar' },
        { title: 'Español', value: 'es' },
      ],
    };
  },
  methods: {
    copyPeerID() {
      copyToClipboard(getPeerID(false));
      this.copied = true;
      setTimeout(() => {
        this.copied = false;
      }, 2000);
    },
    changeLocale(newLocale: string) {
      this.locale = newLocale;
      localStorage.setItem('locale', newLocale);
    },
  },
});
</script>
