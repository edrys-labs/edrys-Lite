import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { ThemeDefinition } from 'vuetify'
import type { CustomDesign } from './CustomDesign'

/** The fonts a design can use, all bundled (no requests to font services). */
export const FONTS = {
  'noto-sans': "'Noto Sans Variable', 'Noto Sans', system-ui, sans-serif",
  'ibm-plex-sans': "'IBM Plex Sans Variable', 'Noto Sans Variable', 'Noto Sans', system-ui, sans-serif",
  fredoka: "'Fredoka Variable', 'Noto Sans Variable', 'Noto Sans', system-ui, sans-serif",
}

/**
 * Font, corners, text sizes and a few heights, the same in Light and Dark.
 * Vuetify emits each as a CSS variable (`border-radius: var(--v-radius-card)`,
 * `font-size: var(--v-text-13)`). Text sizes are named after their size in
 * Standard, so a design with smaller or larger text keeps the steps apart.
 * Circles (dots, avatars, round icons) keep `999px` or `50%`: those are shapes.
 */
const shape = {
  font: FONTS['noto-sans'],
  line: '1px', // side lines of the drawer and chat, below a module's header
  'bar-button': '36px', // icon buttons on the app bar
  'module-head': '36px', // a module's header strip
  'head-case': 'none', // module titles: none or uppercase
  'head-track': 'normal', // their letter spacing
  // hard shadows and the dotted background, drawn only by designs whose CSS
  // asks for them (Playful): outlines are --v-line wide (thinner ones 0.8x,
  // dialogs 1.2x), shadows --v-pop-offset (buttons 0.75x, dialogs 2.5x)
  'pop-offset': '0px',
  'dots-image': 'none',

  'radius-dialog': '16px',
  'radius-card': '12px', // cards, module frames, pop-up menus
  'radius-row': '10px', // list rows, chat messages, notes, segmented switches
  'radius-control': '8px', // buttons and fields (rounded="lg"), tiles in rows
  'radius-chip': '7px', // small buttons and tooltips
  'radius-tile': '6px', // small room tiles
  'radius-pill': '999px', // badges and tags with text

  'text-10': '10px',
  'text-11': '11px',
  'text-12': '12px',
  'text-13': '13px',
  'text-14': '14px',
  'text-15': '15px',
  'text-16': '16px',
  'text-17': '17px',
  'text-18': '18px',
  'text-20': '20px',
  'text-22': '22px',
}

/**
 * The Light and Dark halves of the Standard design. Vuetify's own names carry the base roles
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
    'panel-divider': '#dedede', // lines inside the drawer and chat
    'room-current': '#ffffff', // drawer row of the room you are in
    'room-hover': '#fafafa',
    avatar: '#e6e8ec', // behind a user's dot in the drawer
    'text-2': '#3b424d',
    line: '#d7d7d7', // outlines of buttons and fields
    dashed: '#bebebe', // dashed outline of an empty slot (create a class)
    muted: '#5f6773',
    focus: '#3664be',
    link: '#00579a',
    badge: '#e64343', // unread dot
    'danger-fill': '#c92f33', // white text on it
    'info-tint': '#e0f1ff',
    'primary-tint': '#e5efff', // selected tab, step numbers
    'primary-text': '#224fa7', // text and icons on primary-tint
    'success-tint': '#e4f8e7',
    'warning-tint': '#fee5b3',
    'teacher-tint': '#ffe5c9',
    teacher: '#733d00',
    'own-message': '#eef4fe',
    you: '#2c56a8',
    message: '#ffffff', // chat message card
    'message-edge': '#e8eaed',
    field: '#ffffff', // text inputs on a panel
    module: '#ffffff', // module frame
    'module-head': '#f3f3f3', // its header strip
    'module-line': '#e1e1e1', // below the header strip
    'module-edge': '#e4e6ea', // around the frame
    'module-icon': '#6b727c',
    row: '#ffffff', // a module row in Settings
    'row-edge': '#e4e4e4',
    'icon-tile': '#f0f0f0', // behind a module's icon
    tonal: '#ebebeb', // quiet filled button
    faint: '#a0a6ae', // drag handles
    'danger-tint': '#ffe7e4', // error pill
    'danger-line': '#f3bfba', // outline of a delete button
    subtle: '#f7f7f7', // a check row while connecting
    track: '#dedede', // behind a spinner's arc
    spinner: '#3664be',
    menu: '#ffffff', // user menu and other pop-ups
    'menu-line': '#e4e4e4', // between its sections
    'field-line': '#c4c4c4', // outline of a select in a menu
    segment: '#ffffff', // the chosen option of a segmented switch
    toast: '#1b2029', // short notices at the bottom
    'on-toast': '#eef0f3',
    'toast-action': '#9dc9f7',

    // drawn only by designs that ask for them (Playful): outlines, hard
    // shadows, the dotted background, module header and chat colors
    ink: '#1b2029',
    pop: '#1b2029', // shadow of modules and dialogs
    'pop-2': '#1b2029', // shadow of buttons and the current room
    dots: '#dedede',
    'head-1': '#f3f3f3',
    'head-2': '#f3f3f3',
    'head-3': '#f3f3f3',
    'head-4': '#f3f3f3',
    'person-1': '#ffffff',
    'person-2': '#ffffff',
    'person-3': '#ffffff',
    'person-4': '#ffffff',
  },
  variables: {
    'border-color': '#1b2029',
    ...shape,
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
    'panel-divider': '#262c35',
    'room-current': '#2c333d',
    'room-hover': '#262c35',
    avatar: '#39414c',
    'text-2': '#d4d8de',
    line: '#39414c',
    dashed: '#465060',
    muted: '#9aa3b0',
    focus: '#8db7ff',
    link: '#91c3f6',
    badge: '#f66d67',
    'danger-fill': '#c92f33',
    'info-tint': '#192f46',
    'primary-tint': '#223251',
    'primary-text': '#b1cfff',
    'success-tint': '#1f4127',
    'warning-tint': '#523709',
    'teacher-tint': '#56340e',
    teacher: '#ffd5ae',
    'own-message': '#232e42',
    you: '#9ebef8',
    message: '#262c35',
    'message-edge': '#262c35',
    field: '#161a21',
    module: '#20252d',
    'module-head': '#1a1f26',
    'module-line': '#2c333d',
    'module-edge': '#2c333d',
    'module-icon': '#9aa3b0',
    row: '#262c35',
    'row-edge': '#262c35',
    'icon-tile': '#39414c',
    tonal: '#2c333d',
    faint: '#6b7480',
    'danger-tint': '#512320',
    'danger-line': '#843c38',
    subtle: '#262c35',
    track: '#39414c',
    spinner: '#77a4f6',
    menu: '#262c35',
    'menu-line': '#39414c',
    'field-line': '#465060',
    segment: '#465060',
    toast: '#eef0f3',
    'on-toast': '#1b2029',
    'toast-action': '#00579a',

    ink: '#eef0f3',
    pop: '#eef0f3',
    'pop-2': '#eef0f3',
    dots: '#2a303a',
    'head-1': '#1a1f26',
    'head-2': '#1a1f26',
    'head-3': '#1a1f26',
    'head-4': '#1a1f26',
    'person-1': '#262c35',
    'person-2': '#262c35',
    'person-3': '#262c35',
    'person-4': '#262c35',
  },
  variables: {
    'border-color': '#eef0f3',
    ...shape,
  },
}

/** A design's half: Standard's, with some colors and variables replaced. */
function derive(
  base: ThemeDefinition,
  colors: Record<string, string>,
  variables: Record<string, string>
): ThemeDefinition {
  return {
    ...base,
    colors: { ...base.colors, ...colors },
    variables: { ...base.variables, ...variables },
  }
}

/**
 * Compact: IBM Plex Sans, smaller text, nearly square corners, a white bar
 * and a slate blue accent. Its CSS (`[data-design='compact']`) tightens the
 * drawer and chat and turns the chat into a flat list.
 */
const compactShape = {
  font: FONTS['ibm-plex-sans'],
  'bar-button': '28px',
  'module-head': '26px',
  'head-case': 'uppercase',
  'head-track': '0.07em',

  'radius-dialog': '4px',
  'radius-card': '2px',
  'radius-row': '3px',
  'radius-control': '3px',
  'radius-chip': '2px',
  'radius-tile': '2px',

  'text-10': '9.5px',
  'text-11': '10.5px',
  'text-12': '11px',
  'text-13': '12px',
  'text-14': '13px',
  'text-15': '13.5px',
  'text-16': '14px',
  'text-17': '14.5px',
  'text-18': '16px',
  'text-20': '18px',
  'text-22': '20px',
}

const compactLight = derive(
  light,
  {
    background: '#eceef1',
    surface: '#ffffff',
    'surface-variant': '#ffffff',
    'on-surface-variant': '#111827',
    'on-background': '#111827',
    'on-surface': '#111827',
    primary: '#3d5a80',
    secondary: '#5b6472',

    'bar-line': '#d9dde3',
    'bar-icon': '#374151',
    'bar-active': '#eef1f4',
    'bar-divider': '#d9dde3',
    panel: '#ffffff',
    'panel-line': '#d9dde3',
    'panel-divider': '#eceef1',
    'room-current': '#eef1f4',
    'room-hover': '#f5f6f8',
    avatar: '#e5e7eb',
    'text-2': '#374151',
    line: '#cfd4da',
    dashed: '#c3c9d2',
    muted: '#5b6472',
    focus: '#3d5a80',
    'primary-tint': '#e8edf4',
    'primary-text': '#2f4868',
    'teacher-tint': '#fff1dc',
    'own-message': '#edf1f6',
    you: '#3d5a80',
    message: '#ffffff',
    'message-edge': '#eceef1',
    module: '#ffffff',
    'module-head': '#fafbfc',
    'module-line': '#e3e6ea',
    'module-edge': '#d9dde3',
    'module-icon': '#6b7280',
    'row-edge': '#e3e6ea',
    'icon-tile': '#eef1f4',
    tonal: '#eef1f4',
    faint: '#9aa1ab',
    subtle: '#f5f6f8',
    track: '#d9dde3',
    spinner: '#3d5a80',
    'menu-line': '#e3e6ea',
    'field-line': '#cfd4da',
  },
  compactShape
)

const compactDark = derive(
  dark,
  {
    background: '#0a0c10',
    surface: '#12161c',
    'surface-variant': '#0d1015',
    'on-surface-variant': '#e6e9ee',
    'on-background': '#e6e9ee',
    'on-surface': '#e6e9ee',
    primary: '#4a6a94',
    secondary: '#8f98a6',

    'bar-line': '#242a33',
    'bar-icon': '#c3c9d2',
    'bar-active': '#1c2129',
    'bar-divider': '#2b313b',
    panel: '#0f1217',
    'panel-line': '#242a33',
    'panel-divider': '#1a1f26',
    'room-current': '#1c2129',
    'room-hover': '#161a20',
    avatar: '#2b313b',
    'text-2': '#c3c9d2',
    line: '#2f3640',
    dashed: '#3a414c',
    muted: '#8f98a6',
    focus: '#9fb6d6',
    'primary-tint': '#25303f',
    'primary-text': '#b9cbe3',
    'own-message': '#1d2635',
    you: '#a9c0e0',
    message: '#0f1217',
    'message-edge': '#1a1f26',
    field: '#0d1015',
    module: '#14181e',
    'module-head': '#12161c',
    'module-line': '#20262e',
    'module-edge': '#242a33',
    'module-icon': '#8f98a6',
    row: '#14181e',
    'row-edge': '#242a33',
    'icon-tile': '#2b313b',
    tonal: '#1c2129',
    faint: '#5b6472',
    subtle: '#14181e',
    track: '#2b313b',
    spinner: '#8aa6cc',
    menu: '#12161c',
    'menu-line': '#242a33',
    'field-line': '#2f3640',
    segment: '#2b313b',
  },
  compactShape
)

/**
 * Playful: Fredoka, bigger text, round shapes, a yellow bar, a dotted sky,
 * thick outlines with hard shadows and a color per module header and per
 * person in the chat (its CSS: `[data-design='playful']`).
 */
const INK = '#1b1530'

const playfulShape = {
  font: FONTS.fredoka,
  line: '2.5px',
  'bar-button': '46px',
  'module-head': '46px',
  'pop-offset': '4px',
  'dots-image': 'radial-gradient(rgb(var(--v-theme-dots)) 1.6px, transparent 1.8px)',

  'radius-dialog': '28px',
  'radius-card': '22px',
  'radius-row': '20px',
  'radius-control': '16px',
  'radius-chip': '999px',
  'radius-tile': '999px',

  'text-10': '12px',
  'text-11': '13px',
  'text-12': '14px',
  'text-13': '15.5px',
  'text-14': '16.5px',
  'text-15': '17px',
  'text-16': '18px',
  'text-17': '19px',
  'text-18': '20px',
  'text-20': '22px',
  'text-22': '26px',
}

const playfulLight = derive(
  light,
  {
    background: '#bfe3ff',
    surface: '#ffffff',
    'surface-variant': '#ffd23f',
    'on-surface-variant': INK,
    'on-background': INK,
    'on-surface': INK,
    primary: '#ff6fa5',
    'on-primary': INK,
    secondary: '#4d4470',
    success: '#0a7d45',

    'bar-line': INK,
    'bar-icon': INK,
    'bar-active': '#ffffff',
    'bar-divider': INK,
    panel: '#fff7e8',
    'panel-line': INK,
    'panel-divider': '#eadcc4',
    'room-current': '#ffffff',
    'room-hover': '#fff0d6',
    avatar: '#ffe9a8',
    'text-2': '#2e2650',
    line: INK,
    dashed: '#4d4470',
    muted: '#4d4470',
    focus: '#8a1144',
    'primary-tint': '#ffe0ec',
    'primary-text': '#8a1144',
    'teacher-tint': INK,
    teacher: '#ffd23f',
    'own-message': '#ffe0ec',
    you: '#8a1144',
    message: '#ffffff',
    'message-edge': INK,
    field: '#ffffff',
    module: '#ffffff',
    'module-head': '#fff3e3',
    'module-line': INK,
    'module-edge': INK,
    'module-icon': INK,
    row: '#ffffff',
    'row-edge': '#eadcc4',
    'icon-tile': '#ffe9a8',
    tonal: '#ffe9a8',
    faint: '#7a6f99',
    subtle: '#fff0d6',
    track: '#eadcc4',
    spinner: '#d6336c',
    'menu-line': '#eadcc4',
    'field-line': INK,
    segment: '#ffffff',

    ink: INK,
    pop: INK,
    'pop-2': INK,
    dots: '#8fc9f2',
    'head-1': '#ff9ec4',
    'head-2': '#9be7c4',
    'head-3': '#c9b6ff',
    'head-4': '#ffc46b',
    'person-1': '#ffd6e7',
    'person-2': '#d4f7e6',
    'person-3': '#fff1b8',
    'person-4': '#e6ddff',
  },
  playfulShape
)

const playfulDark = derive(
  dark,
  {
    background: '#1a1433',
    surface: '#2d2452',
    'surface-variant': '#241c45',
    'on-surface-variant': '#ffd23f',
    'on-background': '#f5f0ff',
    'on-surface': '#f5f0ff',
    primary: '#ff6fa5',
    'on-primary': INK,
    secondary: '#b9add9',
    success: '#5ee6a1',

    'bar-line': '#0b0818',
    'bar-icon': '#ffd23f',
    'bar-active': '#3a2f6b',
    'bar-divider': '#4b3f85',
    panel: '#221a40',
    'panel-line': '#e9e3ff',
    'panel-divider': '#3a2f6b',
    'room-current': '#3a2f6b',
    'room-hover': '#2a2150',
    avatar: '#4b3f85',
    'text-2': '#ddd3ff',
    line: '#e9e3ff',
    dashed: '#4b3f85',
    muted: '#b9add9',
    focus: '#ffd23f',
    'primary-tint': '#4a1d36',
    'primary-text': '#ffb3cf',
    'teacher-tint': '#ffd23f',
    teacher: INK,
    'own-message': '#3a2f55',
    you: '#ffb3cf',
    message: '#2d2452',
    'message-edge': '#e9e3ff',
    field: '#150f2b',
    module: '#2d2452',
    'module-head': '#261f30',
    'module-line': '#e9e3ff',
    'module-edge': '#e9e3ff',
    'module-icon': '#ffffff',
    row: '#2d2452',
    'row-edge': '#4b3f85',
    'icon-tile': '#4b3f85',
    tonal: '#3a2f6b',
    faint: '#7a6fa8',
    subtle: '#2a2150',
    track: '#4b3f85',
    spinner: '#ff6fa5',
    menu: '#2d2452',
    'menu-line': '#3a2f6b',
    'field-line': '#e9e3ff',
    segment: '#4b3f85',

    ink: '#e9e3ff',
    pop: '#ff6fa5',
    'pop-2': '#ffd23f',
    dots: '#3a2f6b',
    'head-1': '#a8326a',
    'head-2': '#16795a',
    'head-3': '#5b45b8',
    'head-4': '#b0621a',
    'person-1': '#4a1d36',
    'person-2': '#123f33',
    'person-3': '#4a3d0e',
    'person-4': '#2f2560',
  },
  playfulShape
)

/**
 * Designs, each with a Light and a Dark half. The user's Light/Dark/System
 * choice picks the half, the class picks the design.
 */
export const designs = {
  standard: { light, dark },
  compact: { light: compactLight, dark: compactDark },
  playful: { light: playfulLight, dark: playfulDark },
}

export type Design = keyof typeof designs
export const DESIGNS = Object.keys(designs) as Design[]

/**
 * Sizes Vuetify takes as props (in px): the app bar's height, the rooms
 * drawer's and the chat's width. Phones keep their own.
 */
const layouts: Record<Design, { bar: number; drawer: number; chat: number }> = {
  standard: { bar: 56, drawer: 264, chat: 360 },
  compact: { bar: 40, drawer: 228, chat: 300 },
  playful: { bar: 68, drawer: 300, chat: 390 },
}

export function designLayout(design: Design) {
  return layouts[design]
}

/** A built-in design, or the class's own (`custom`, see CustomDesign.ts). */
export type DesignChoice = Design | 'custom'

/** Vuetify's name for one half of a design, e.g. `standard-dark`. */
export function themeName(design: DesignChoice, theme: 'light' | 'dark') {
  return `${design}-${theme}`
}

export const themes: Record<string, ThemeDefinition> = Object.fromEntries(
  DESIGNS.flatMap((design) =>
    (['light', 'dark'] as const).map((theme) => [themeName(design, theme), designs[design][theme]])
  )
)

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

/**
 * A half shown for a while instead of the user's choice, without saving it:
 * Settings shows the half whose colors are being changed. Null otherwise.
 */
export const previewTheme = ref<'light' | 'dark' | null>(null)

export function setThemePreference(preference: ThemePreference) {
  themePreference.value = preference
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch (e) {
    // the choice still applies for this visit
  }
}

/** The design on screen; anything unknown shows as Standard. */
export const activeDesign = ref<DesignChoice>('standard')

/** The class's own design while `activeDesign` is `custom`, already checked. */
const activeCustom = shallowRef<CustomDesign | null>(null)

/**
 * Shows a built-in design, or with `custom` the class's own (checked by
 * CustomDesign.ts, which is where a class's setting comes in).
 */
export function setDesign(design: unknown, custom?: CustomDesign) {
  if (design === 'custom' && custom) {
    activeCustom.value = custom
    activeDesign.value = 'custom'
    return
  }
  activeCustom.value = null
  activeDesign.value = DESIGNS.includes(design as Design) ? (design as Design) : 'standard'
}

/** The built-in design on screen, or the one a class's own design is based on. */
export const activeBase = computed<Design>(() =>
  activeDesign.value === 'custom' ? activeCustom.value?.base ?? 'standard' : activeDesign.value
)

/** The active design's bar height and panel widths. */
export const activeLayout = computed(() => ({
  ...designLayout(activeBase.value),
  ...(activeDesign.value === 'custom' ? activeCustom.value?.layout : {}),
}))

/**
 * One half of the class's own design: its base's half (as Vuetify holds it,
 * with Vuetify's own defaults filled in) with the checked colors and
 * variables replaced.
 */
function customHalf(
  custom: CustomDesign,
  half: 'light' | 'dark',
  registered: Record<string, ThemeDefinition>
): ThemeDefinition {
  const base = registered[themeName(custom.base, half)] ?? designs[custom.base][half]
  return {
    ...base,
    colors: { ...base.colors, ...custom.colors[half] },
    variables: { ...base.variables, ...custom.variables },
  }
}

/**
 * Keeps Vuetify's theme in step with the design, the preference and, for
 * 'system', the OS. `<html data-theme>` carries the half for styles that
 * differ between Light and Dark (`[data-theme='dark'] .card`), whatever the
 * design; `<html data-design>` the built-in design, for what only one design
 * draws (`[data-design='playful'] .item`), so a class's own design gets its
 * base's. Its two halves go into Vuetify's themes as `custom-light` and
 * `custom-dark`, replaced whenever it changes.
 */
export function followThemePreference(
  vuetifyTheme: Ref<string>,
  vuetifyThemes: Ref<Record<string, ThemeDefinition>> = ref({})
) {
  const apply = () => {
    activeTheme.value = previewTheme.value ?? resolveTheme(themePreference.value)
    const custom = activeDesign.value === 'custom' ? activeCustom.value : null
    if (custom) {
      const registered = vuetifyThemes.value
      vuetifyThemes.value['custom-light'] = customHalf(custom, 'light', registered)
      vuetifyThemes.value['custom-dark'] = customHalf(custom, 'dark', registered)
    }
    vuetifyTheme.value = themeName(activeDesign.value, activeTheme.value)
    document.documentElement.dataset.theme = activeTheme.value
    document.documentElement.dataset.design = activeBase.value
  }
  watch([themePreference, previewTheme, activeDesign, activeCustom], apply)
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

/**
 * Pictures of classes without a logo (ClassArt.ts), one entry per palette
 * slot, from the same hues as ROOM_COLORS: ground L0.95/C0.03 in light,
 * L0.3/C0.04 in dark; lines L0.8/C0.05 and L0.5/C0.05; dots in the slot's
 * hue (L0.55/C0.13, dark L0.7/C0.1) and its hue + 110° (L0.6/C0.12, dark
 * L0.72/C0.1).
 */
export const CLASS_ART_COLORS = [
  { // green
    light: { bg: '#e1f5e4', line: '#a8c7ad', dots: ['#298646', '#5480c7'] },
    dark: { bg: '#1f3423', line: '#4f6c54', dots: ['#6fb07d', '#80a5e3'] },
  },
  { // blue
    light: { bg: '#e0f1ff', line: '#a6c1dd', dots: ['#2a75ba', '#b95f7d'] },
    dark: { bg: '#1e2f41', line: '#4d667f', dots: ['#6da3da', '#d88aa2'] },
  },
  { // amber
    light: { bg: '#fdebda', line: '#d5b89d', dots: ['#a45e00', '#00977c'] },
    dark: { bg: '#3c2a18', line: '#775e45', dots: ['#c99159', '#57b9a1'] },
  },
  { // purple
    light: { bg: '#f1eaff', line: '#c2b7da', dots: ['#7e5db1', '#b86838'] },
    dark: { bg: '#31293f', line: '#675d7c', dots: ['#a890d4', '#d7926b'] },
  },
  { // teal
    light: { bg: '#d8f5f5', line: '#99c8c8', dots: ['#008889', '#916cb9'] },
    dark: { bg: '#113434', line: '#3f6c6c', dots: ['#41b2b2', '#b395d7'] },
  },
  { // rose
    light: { bg: '#ffe7ea', line: '#dcb1b6', dots: ['#af4c60', '#778a2d'] },
    dark: { bg: '#3f2529', line: '#7d585d', dots: ['#d48490', '#9cae65'] },
  },
  { // indigo
    light: { bg: '#e8edff', line: '#b4bcdf', dots: ['#5c69bc', '#bd615b'] },
    dark: { bg: '#282c42', line: '#5b6180', dots: ['#8c99dd', '#dc8c85'] },
  },
  { // gold
    light: { bg: '#f5efd8', line: '#c8be9a', dots: ['#8a6f00', '#0094a2'] },
    dark: { bg: '#342e15', line: '#6c6342', dots: ['#b29e51', '#48b7c2'] },
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
