import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { ref, nextTick } from 'vue'

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
    expect(themeName.value).toBe('light')

    setThemePreference('dark')
    await nextTick()
    expect(themeName.value).toBe('dark')

    setThemePreference('system')
    await nextTick()
    expect(themeName.value).toBe('light')

    osDark = true
    osListener?.()
    expect(themeName.value).toBe('dark')
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

  test('both themes define the same colors', async () => {
    const { themes } = await loadTheme()
    expect(Object.keys(themes.dark.colors!).sort()).toEqual(Object.keys(themes.light.colors!).sort())
  })
})
