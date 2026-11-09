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

    <div class="user-menu">
      <section>
        <div class="label">{{ t('general.userId') }}</div>
        <div class="user-id">
          <span>{{ peerID }}</span>
          <v-tooltip :text="copied ? t('general.copied') : t('general.copyFullId')" location="top">
            <template v-slot:activator="{ props: tooltipProps }">
              <v-btn
                v-bind="tooltipProps"
                :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
                size="30"
                variant="flat"
                color="tonal"
                class="copy-btn"
                :aria-label="t('general.copyFullId')"
                @click.stop="copyPeerID()"
              ></v-btn>
            </template>
          </v-tooltip>
        </div>
      </section>

      <section v-if="nameEditable" class="gap">
        <label for="user-menu-username" class="label">{{ t('general.displayName') }}</label>
        <input
          id="user-menu-username"
          v-model="username"
          class="name-field"
          type="text"
          autocomplete="off"
          :maxlength="maxUsernameLength"
          @change="commitUsername"
        />
        <div class="hint">{{ t('general.displayNameHint') }}</div>
      </section>

      <section v-if="$slots['user-role']">
        <div class="label">{{ t('general.userRole') }}</div>
        <div class="value"><slot name="user-role"></slot></div>
      </section>

      <section class="gap">
        <label for="user-menu-language" class="label">{{ t('general.language') }}</label>
        <div class="select">
          <select id="user-menu-language" :value="locale" @change="onLocaleChange">
            <option v-for="language in languages" :key="language.value" :value="language.value">
              {{ language.title }}
            </option>
          </select>
          <v-icon icon="mdi-chevron-down" size="16" aria-hidden="true"></v-icon>
        </div>
      </section>

      <section class="gap">
        <div class="label" id="theme-label">{{ t('general.theme.title') }}</div>
        <div class="segments" role="radiogroup" aria-labelledby="theme-label">
          <label v-for="option in themeOptions" :key="option.value" class="segment">
            <input
              type="radio"
              name="theme"
              :value="option.value"
              :checked="themePreference === option.value"
              @change="setThemePreference(option.value)"
            />
            <v-icon :icon="option.icon" size="14" aria-hidden="true"></v-icon>
            {{ t(`general.theme.${option.value}`) }}
          </label>
        </div>
      </section>
    </div>
  </v-menu>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useI18n } from 'vue-i18n';
import { copyToClipboard, getDisplayPeerID, getPeerID } from '../ts/Utils';
import { themePreference, setThemePreference, type ThemePreference } from '../ts/Theme';
import { loadUsername, MAX_USERNAME_LENGTH, saveUsername } from '../ts/UserNames';

export default defineComponent({
  name: 'UserMenu',
  props: {
    nameEditable: { type: Boolean, default: true },
  },
  emits: ['username-change'],
  setup() {
    const { t, locale } = useI18n();
    return { t, locale, themePreference, setThemePreference };
  },
  data() {
    return {
      peerID: getDisplayPeerID(),
      copied: false,
      username: loadUsername(),
      maxUsernameLength: MAX_USERNAME_LENGTH,
      languages: [
        { title: 'English', value: 'en' },
        { title: 'Deutsch', value: 'de' },
        { title: 'Українська', value: 'uk' },
        { title: 'العربية', value: 'ar' },
        { title: 'Español', value: 'es' },
      ],
      themeOptions: [
        { value: 'light', icon: 'mdi-white-balance-sunny' },
        { value: 'dark', icon: 'mdi-weather-night' },
        { value: 'system', icon: 'mdi-monitor' },
      ] as { value: ThemePreference; icon: string }[],
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
    commitUsername() {
      this.username = saveUsername(this.username);
      this.$emit('username-change', this.username);
    },
    onLocaleChange(event: Event) {
      this.changeLocale((event.target as HTMLSelectElement).value);
    },
    changeLocale(newLocale: string) {
      this.locale = newLocale;
      localStorage.setItem('locale', newLocale);
    },
  },
});
</script>

<style scoped>
.user-menu {
  width: 300px;
  overflow: hidden;
  border-radius: 12px;
  background: rgb(var(--v-theme-menu));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 12px 32px rgba(20, 25, 35, 0.14), 0 0 0 1px rgb(var(--v-theme-module-edge));
}

.v-theme--dark .user-menu {
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45), 0 0 0 1px rgb(var(--v-theme-line));
}

section {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 14px 16px;
}

section + section {
  border-top: 1px solid rgb(var(--v-theme-menu-line));
}

section.gap {
  gap: 8px;
}

section:last-child {
  padding-bottom: 16px;
}

.label {
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-muted));
}

.value {
  font-size: 14px;
  font-weight: 500;
}

.user-id {
  display: flex;
  align-items: center;
  gap: 8px;
}

.user-id span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
  font-family: 'JetBrains Mono Variable', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 500;
}

.copy-btn {
  border-radius: 7px;
  color: rgb(var(--v-theme-text-2)) !important;
}

.copy-btn :deep(.v-icon) {
  font-size: 15px;
}

.hint {
  font-size: 12px;
  color: rgb(var(--v-theme-muted));
}

.name-field {
  box-sizing: border-box;
  width: 100%;
  height: 38px;
  padding-inline: 12px;
  border: 1px solid rgb(var(--v-theme-field-line));
  border-radius: 8px;
  background: rgb(var(--v-theme-field));
  color: inherit;
  font: inherit;
  font-size: 14px;
}

.name-field:focus-visible {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

.select {
  position: relative;
}

.select select {
  box-sizing: border-box;
  width: 100%;
  height: 38px;
  padding-inline: 12px 32px;
  border: 1px solid rgb(var(--v-theme-field-line));
  border-radius: 8px;
  background: rgb(var(--v-theme-field));
  color: inherit;
  font: inherit;
  font-size: 14px;
  appearance: none;
  cursor: pointer;
}

.select .v-icon {
  position: absolute;
  top: 11px;
  inset-inline-end: 10px;
  color: rgb(var(--v-theme-muted));
  pointer-events: none;
}

.select select:focus-visible,
.segment:has(input:focus-visible) {
  outline: 2px solid rgb(var(--v-theme-focus));
  outline-offset: 2px;
}

/* Light / Dark / System: the chosen one is raised out of a tonal track */
.segments {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 2px;
  padding: 3px;
  border-radius: 10px;
  background: rgb(var(--v-theme-tonal));
}

.segment {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 32px;
  border-radius: 7px;
  color: rgb(var(--v-theme-muted));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.segment input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.segment:has(input:checked) {
  background: rgb(var(--v-theme-segment));
  color: rgb(var(--v-theme-on-surface));
}

.v-theme--light .segment:has(input:checked) {
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.12);
}
</style>
