import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'
import en from '@/locales/en.yaml'

// Theme.ts reads the saved choice and the OS setting when it loads, so each
// test sets those up first and then imports a fresh copy of the module.

let osDark = false
let osListener: (() => void) | null = null

function fakeMatchMedia() {
  return {
    get matches() {
      return osDark
    },
    addEventListener: (_type: string, listener: () => void) => {
      osListener = listener
    },
  }
}

async function loadTheme() {
  vi.resetModules()
  return await import('../../../src/ts/Theme')
}

beforeEach(() => {
  osDark = false
  osListener = null
  localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(fakeMatchMedia))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Theme', () => {
  test('follows the system when nothing is saved', async () => {
    osDark = true
    const { themePreference, resolveTheme } = await loadTheme()
    expect(themePreference.value).toBe('system')
    expect(resolveTheme('system')).toBe('dark')
  })

  test('uses a saved choice over the system', async () => {
    osDark = true
    localStorage.setItem('theme', 'light')
    const { themePreference, resolveTheme } = await loadTheme()
    expect(themePreference.value).toBe('light')
    expect(resolveTheme(themePreference.value)).toBe('light')
  })

  test('ignores an unknown saved value', async () => {
    localStorage.setItem('theme', 'purple')
    const { themePreference } = await loadTheme()
    expect(themePreference.value).toBe('system')
  })

  test('saves a fixed choice and forgets it for system', async () => {
    const { setThemePreference, themePreference } = await loadTheme()
    setThemePreference('dark')
    expect(themePreference.value).toBe('dark')
    expect(localStorage.getItem('theme')).toBe('dark')
    setThemePreference('system')
    expect(localStorage.getItem('theme')).toBeNull()
  })

  test('switches the Vuetify theme on a new choice and on an OS change', async () => {
    const { followThemePreference, setThemePreference } = await loadTheme()
    const themeName = ref('')
    followThemePreference(themeName)
    expect(themeName.value).toBe('standard-light')
    expect(document.documentElement.dataset.theme).toBe('light')

    setThemePreference('dark')
    await nextTick()
    expect(themeName.value).toBe('standard-dark')
    expect(document.documentElement.dataset.theme).toBe('dark')

    setThemePreference('system')
    await nextTick()
    expect(themeName.value).toBe('standard-light')

    osDark = true
    osListener?.()
    expect(themeName.value).toBe('standard-dark')
  })

  test('the design picks the theme, the preference picks its half', async () => {
    const { followThemePreference, setThemePreference, setDesign, activeDesign } = await loadTheme()
    const themeName = ref('')
    followThemePreference(themeName)
    setDesign('standard')
    setThemePreference('dark')
    await nextTick()
    expect(themeName.value).toBe('standard-dark')
    expect(activeDesign.value).toBe('standard')
  })

  test('an unknown design shows as Standard', async () => {
    const { setDesign, activeDesign } = await loadTheme()
    for (const design of ['neon', '', null, undefined, 42, { light: {} }, '__proto__', 'constructor']) {
      setDesign(design)
      expect(activeDesign.value).toBe('standard')
    }
  })

  test("a class's own design gets its own Vuetify themes on top of its base", async () => {
    const { followThemePreference, setThemePreference, setDesign, activeDesign, activeBase, activeLayout, themes } =
      await loadTheme()
    const themeName = ref('')
    // as Vuetify holds them: with its own defaults merged in
    const registered = ref<Record<string, any>>(
      Object.fromEntries(
        Object.entries(themes).map(([name, t]) => [name, { ...t, variables: { ...t.variables, 'vuetify-default': '1' } }])
      )
    )
    followThemePreference(themeName, registered)
    const custom = {
      name: 'Ocean',
      base: 'playful' as const,
      variables: { 'radius-card': '4px' },
      layout: { chat: 300 },
      colors: { light: { primary: '#112233' }, dark: { primary: '#445566' } },
    }
    setDesign('custom', custom)
    await nextTick()

    expect(activeDesign.value).toBe('custom')
    expect(activeBase.value).toBe('playful')
    expect(themeName.value).toBe('custom-light')
    // Playful's own CSS still applies
    expect(document.documentElement.dataset.design).toBe('playful')
    expect(activeLayout.value).toEqual({ bar: 68, drawer: 300, chat: 300 })

    const light = registered.value['custom-light']
    expect(light.dark).toBe(false)
    expect(light.colors.primary).toBe('#112233')
    expect(light.colors.background).toBe(themes['playful-light'].colors!.background)
    expect(light.variables['radius-card']).toBe('4px')
    expect(light.variables.font).toBe(themes['playful-light'].variables!.font)
    expect(light.variables['vuetify-default']).toBe('1')
    // a missing dark color comes from the base's dark half, not from light
    const dark = registered.value['custom-dark']
    expect(dark.dark).toBe(true)
    expect(dark.colors.primary).toBe('#445566')
    expect(dark.colors.surface).toBe(themes['playful-dark'].colors!.surface)

    setThemePreference('dark')
    await nextTick()
    expect(themeName.value).toBe('custom-dark')

    // a change replaces the themes
    setDesign('custom', { ...custom, base: 'compact', colors: { light: {}, dark: {} } })
    await nextTick()
    expect(document.documentElement.dataset.design).toBe('compact')
    expect(registered.value['custom-dark'].colors.primary).toBe(themes['compact-dark'].colors!.primary)

    setDesign('standard')
    await nextTick()
    expect(themeName.value).toBe('standard-dark')
    expect(document.documentElement.dataset.design).toBe('standard')
    expect(activeLayout.value).toEqual({ bar: 56, drawer: 264, chat: 360 })
  })

  test("the accent for modules is the design's main color in the half on screen, none for Standard's", async () => {
    const { setDesign, activeTheme, activeAccent, designs } = await loadTheme()
    activeTheme.value = 'light'
    setDesign('standard')
    expect(activeAccent.value).toBeNull()

    setDesign('playful')
    expect(activeAccent.value).toEqual({ primary: '#ff6fa5', onPrimary: designs.playful.light.colors!['on-primary'] })
    setDesign('compact')
    activeTheme.value = 'dark'
    expect(activeAccent.value).toEqual({ primary: '#4a6a94', onPrimary: '#ffffff' })

    const custom = (colors: any) => ({ name: '', base: 'standard' as const, variables: {}, layout: {}, colors })
    setDesign('custom', custom({ light: {}, dark: { primary: '#112233', 'on-primary': '#ffffff' } }))
    expect(activeAccent.value).toEqual({ primary: '#112233', onPrimary: '#ffffff' })
    // a design whose colors are Standard's sends none
    activeTheme.value = 'light'
    expect(activeAccent.value).toBeNull()
  })

  test('custom without its own design shows as Standard', async () => {
    const { setDesign, activeDesign } = await loadTheme()
    setDesign('custom')
    expect(activeDesign.value).toBe('standard')
  })

  test('a preview half is shown without changing the saved choice', async () => {
    const { followThemePreference, previewTheme, activeTheme, themePreference } = await loadTheme()
    const themeName = ref('')
    followThemePreference(themeName)
    previewTheme.value = 'dark'
    await nextTick()
    expect(themeName.value).toBe('standard-dark')
    expect(activeTheme.value).toBe('dark')
    expect(themePreference.value).toBe('system')
    expect(localStorage.getItem('theme')).toBeNull()

    previewTheme.value = null
    await nextTick()
    expect(themeName.value).toBe('standard-light')
  })

  test('tells computed colors which theme is on screen', async () => {
    const { followThemePreference, setThemePreference, activeTheme } = await loadTheme()
    followThemePreference(ref(''))
    expect(activeTheme.value).toBe('light')

    setThemePreference('dark')
    await nextTick()
    expect(activeTheme.value).toBe('dark')
  })

  test('room tiles are gray without a slot and tinted with one', async () => {
    const { roomTile, ROOM_COLORS } = await loadTheme()
    expect(roomTile(null, 'light')).toEqual({ bg: '#dfe2e7', fg: '#3b424d', dot: '#8a919b' })
    expect(roomTile(null, 'dark').bg).toBe('#465060')
    expect(roomTile(0, 'light')).toEqual({ ...ROOM_COLORS[0].light, dot: ROOM_COLORS[0].dot })
    expect(roomTile(0, 'dark')).toEqual({ ...ROOM_COLORS[0].dark, dot: ROOM_COLORS[0].dot })
    // more rooms than colors: the palette repeats
    expect(roomTile(ROOM_COLORS.length, 'light')).toEqual(roomTile(0, 'light'))
  })

  test('every room color is a 6-digit hex, a light tile behind dark text and the other way round', async () => {
    const { ROOM_COLORS } = await loadTheme()
    const lightness = (hex: string) => parseInt(hex.slice(1, 3), 16) + parseInt(hex.slice(3, 5), 16) + parseInt(hex.slice(5, 7), 16)
    for (const c of ROOM_COLORS) {
      for (const hex of [c.light.bg, c.light.fg, c.dark.bg, c.dark.fg, c.dot, c.border]) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/)
      }
      expect(lightness(c.light.bg)).toBeGreaterThan(lightness(c.light.fg))
      expect(lightness(c.dark.bg)).toBeLessThan(lightness(c.dark.fg))
    }
  })

  test('every design has a light and a dark half with the same colors and variables', async () => {
    const { themes, DESIGNS, themeName } = await loadTheme()
    expect(Object.keys(themes).sort()).toEqual(DESIGNS.flatMap((d) => [themeName(d, 'dark'), themeName(d, 'light')]).sort())
    const standard = themes[themeName('standard', 'light')]
    for (const design of DESIGNS) {
      const light = themes[themeName(design, 'light')]
      const dark = themes[themeName(design, 'dark')]
      expect(light.dark).toBe(false)
      expect(dark.dark).toBe(true)
      for (const half of [light, dark]) {
        expect(Object.keys(half.colors!).sort()).toEqual(Object.keys(standard.colors!).sort())
        expect(Object.keys(half.variables!).sort()).toEqual(Object.keys(standard.variables!).sort())
      }
    }
  })

  test('every design has a bar height, panel widths and a name with a hint (the other locales copy the keys)', async () => {
    const { DESIGNS, designLayout } = await loadTheme()
    for (const design of DESIGNS) {
      const { bar, drawer, chat } = designLayout(design)
      for (const px of [bar, drawer, chat]) expect(px).toBeGreaterThan(0)
      expect((en as any).settings.design.designs[design]).toEqual({ name: expect.any(String), hint: expect.any(String) })
    }
  })
})
