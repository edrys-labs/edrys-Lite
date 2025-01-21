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
          <v-btn
            icon="mdi-content-copy"
            size="small"
            variant="flat"
            @click="copyPeerID()"
          >
          </v-btn>
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
import { copyToClipboard, getPeerID } from '../ts/Utils';

export default defineComponent({
  name: 'UserMenu',
  setup() {
    const { t, locale } = useI18n();
    return { t, locale };
  },
  data() {
    return {
      peerID: getPeerID(false),
      languages: [
        { title: 'English', value: 'en' },
        { title: 'Deutsch', value: 'de' },
        { title: 'Українська', value: 'uk' },
        { title: 'العربية', value: 'ar' },
      ],
    };
  },
  methods: {
    copyPeerID() {
      copyToClipboard(this.peerID);
    },
    changeLocale(newLocale: string) {
      this.locale = newLocale;
      localStorage.setItem('locale', newLocale);
    },
  },
});
</script>
