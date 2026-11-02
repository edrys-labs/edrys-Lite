import { ref, watch, type Ref } from 'vue'
import type { ThemeDefinition } from 'vuetify'

/**
 * The Light and Dark themes. Vuetify's own names carry the base roles
 * (`surface-variant` is the app bar, which already uses that color). The
 * others are custom colors, available as `color="panel"` on components and
 * as `rgb(var(--v-theme-panel))` in CSS.
 */
const light: ThemeDefinition = {
  dark: false,
  colors: {
    background: '#dedede', // behind the modules
    surface: '#ffffff',
    'surface-variant': '#383838', // app bar and footer
    'on-surface-variant': '#ffffff',
    'on-background': '#1b2029',
    'on-surface': '#1b2029',
    primary: '#3664be', // main actions
    'on-primary': '#ffffff',
    secondary: '#5f6773',
    error: '#b71824',
    info: '#004985',
    success: '#005725',
    warning: '#5d3904',

    'bar-line': '#2e2e2e',
    panel: '#f3f3f3', // drawer, chat, module header
    'panel-line': '#dedede',
    line: '#d7d7d7', // outlines of buttons and fields
    muted: '#5f6773',
    focus: '#3664be',
    link: '#00579a',
    badge: '#e64343', // unread dot
    'danger-fill': '#c92f33', // white text on it
    'info-tint': '#e0f1ff',
    'success-tint': '#e4f8e7',
    'warning-tint': '#fee5b3',
    'teacher-tint': '#ffe5c9',
    teacher: '#733d00',
    'own-message': '#eef4fe',
    you: '#2c56a8',
  },
  variables: {
    'border-color': '#1b2029',
  },
}

const dark: ThemeDefinition = {
  dark: true,
  colors: {
    background: '#2a303a',
    surface: '#1d222a',
    'surface-variant': '#161a21',
    'on-surface-variant': '#eef0f3',
    'on-background': '#eef0f3',
    'on-surface': '#eef0f3',
    primary: '#3e6dc8',
    'on-primary': '#ffffff',
    secondary: '#9aa3b0',
    error: '#fa8880',
    info: '#c6e1ff',
    success: '#a8ebb5',
    warning: '#fde1a7',

    'bar-line': '#262c35',
    panel: '#1d222a',
    'panel-line': '#262c35',
    line: '#39414c',
    muted: '#9aa3b0',
    focus: '#8db7ff',
    link: '#91c3f6',
    badge: '#f66d67',
    'danger-fill': '#c92f33',
    'info-tint': '#192f46',
    'success-tint': '#1f4127',
    'warning-tint': '#523709',
    'teacher-tint': '#56340e',
    teacher: '#ffd5ae',
    'own-message': '#232e42',
    you: '#9ebef8',
  },
  variables: {
    'border-color': '#eef0f3',
  },
}

export const themes = { light, dark }

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'theme'
const darkQuery = window.matchMedia?.('(prefers-color-scheme: dark)')

function savedPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch (e) {
    // private mode or blocked storage: fall back to the system setting
  }
  return 'system'
}

/** The user's choice: a fixed theme, or follow the operating system. */
export const themePreference = ref<ThemePreference>(savedPreference())

/** The theme to show for a preference right now. */
export function resolveTheme(preference: ThemePreference): 'light' | 'dark' {
  if (preference !== 'system') return preference
  return darkQuery?.matches ? 'dark' : 'light'
}

export function setThemePreference(preference: ThemePreference) {
  themePreference.value = preference
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch (e) {
    // the choice still applies for this visit
  }
}

/** Keeps Vuetify's theme in step with the preference and, for 'system', the OS. */
export function followThemePreference(themeName: Ref<string>) {
  const apply = () => {
    themeName.value = resolveTheme(themePreference.value)
  }
  watch(themePreference, apply)
  darkQuery?.addEventListener?.('change', apply)
  apply()
}
