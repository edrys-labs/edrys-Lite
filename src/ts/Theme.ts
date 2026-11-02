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
    'bar-icon': '#ffffff',
    'bar-active': '#545454', // pressed bar button, room pill
    'bar-divider': '#6a6a6a',
    panel: '#f3f3f3', // drawer, chat, module header
    'panel-line': '#dedede',
    'room-current': '#ffffff', // drawer row of the room you are in
    'room-hover': '#fafafa',
    avatar: '#e6e8ec', // behind a user's dot in the drawer
    'text-2': '#3b424d',
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
    'bar-icon': '#d4d8de',
    'bar-active': '#262c35',
    'bar-divider': '#39414c',
    panel: '#1d222a',
    'panel-line': '#262c35',
    'room-current': '#2c333d',
    'room-hover': '#262c35',
    avatar: '#39414c',
    'text-2': '#d4d8de',
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

/** The theme on screen, for colors that are computed rather than named. */
export const activeTheme = ref<'light' | 'dark'>(resolveTheme(themePreference.value))

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
    activeTheme.value = resolveTheme(themePreference.value)
    themeName.value = activeTheme.value
  }
  watch(themePreference, apply)
  darkQuery?.addEventListener?.('change', apply)
  apply()
}

/**
 * Room colors, one entry per palette slot. Worked out from OKLCH hues
 * (green 150, blue 250, amber 65, purple 300, teal 195, rose 10, indigo 275,
 * gold 95): tiles L0.93/C0.05 behind L0.42/C0.12 in light, L0.38/C0.08 behind
 * L0.9/C0.07 in dark; the station dot L0.6/C0.12; the border (Settings)
 * L0.68/C0.11.
 */
export const ROOM_COLORS = [
  { // green
    light: { bg: '#d1f2d7', fg: '#005e26' },
    dark: { bg: '#1d4e2b', fg: '#beecc6' },
    dot: '#439458',
    border: '#63ab74',
  },
  { // blue
    light: { bg: '#cfebff', fg: '#004f8b' },
    dark: { bg: '#1d456b', fg: '#bbe2ff' },
    dot: '#4284c5',
    border: '#619dda',
  },
  { // amber
    light: { bg: '#ffe2c6', fg: '#783b00' },
    dark: { bg: '#5f3808', fg: '#ffd5ae' },
    dot: '#b16f23',
    border: '#c7894a',
  },
  { // purple
    light: { bg: '#ede1ff', fg: '#583a84' },
    dark: { bg: '#493766', fg: '#e5d4ff' },
    dot: '#8c6ebd',
    border: '#a388d2',
  },
  { // teal
    light: { bg: '#c2f3f2', fg: '#005f61' },
    dark: { bg: '#004f4f', fg: '#a7edec' },
    dot: '#009696',
    border: '#21adad',
  },
  { // rose
    light: { bg: '#ffdbe0', fg: '#812a3e' },
    dark: { bg: '#652e39', fg: '#ffccd3' },
    dot: '#bc5f70',
    border: '#d27a89',
  },
  { // indigo
    light: { bg: '#dee6ff', fg: '#3c448d' },
    dark: { bg: '#363e6c', fg: '#d0dbff' },
    dot: '#6c79c7',
    border: '#8592dc',
  },
  { // gold
    light: { bg: '#f2e8c3', fg: '#624a00' },
    dark: { bg: '#504100', fg: '#ecdeaa' },
    dot: '#977e0d',
    border: '#ae9740',
  },
]

// the Lobby and other rooms without a palette slot
const NEUTRAL_ROOM = {
  light: { bg: '#dfe2e7', fg: '#3b424d' },
  dark: { bg: '#465060', fg: '#d4d8de' },
  dot: '#8a919b',
}

/**
 * The tile of a room (its initial on a tinted square), from its palette slot,
 * or gray without one. `dot` marks a station in the user list.
 */
export function roomTile(slot: number | null, theme: 'light' | 'dark') {
  const colors = slot === null ? NEUTRAL_ROOM : ROOM_COLORS[slot % ROOM_COLORS.length]
  return { ...colors[theme], dot: colors.dot }
}
