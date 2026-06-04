<template>
  <v-menu>
    <template v-slot:activator="{ props }">
      <v-btn v-bind="props" icon="mdi-dots-vertical"> </v-btn>
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
    </v-list>
  </v-menu>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyToClipboard, getDisplayPeerID, getPeerID } from '../ts/Utils';

export default defineComponent({
  name: 'UserMenu',
  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
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
