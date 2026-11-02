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

  test('both themes define the same colors', async () => {
    const { themes } = await loadTheme()
    expect(Object.keys(themes.dark.colors!).sort()).toEqual(Object.keys(themes.light.colors!).sort())
  })
})
