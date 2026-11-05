import { describe, test, expect } from 'vitest'
import { classArt } from '../../../src/ts/ClassArt'
import { CLASS_ART_COLORS } from '../../../src/ts/Theme'

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'linux-basics', '4UHFS3LPGw6vGHGO']

describe('class art', () => {
  test('a class gets the same picture every time', () => {
    expect(classArt('abc', 'light')).toEqual(classArt('abc', 'light'))
  })

  test('the ground and dots come from the class art palette of the theme', () => {
    for (const theme of ['light', 'dark'] as const) {
      const palette = CLASS_ART_COLORS.map((c) => c[theme])
      const art = classArt('abc', theme)
      const colors = palette.find((c) => c.bg === art.background)
      expect(colors).toBeDefined()
      for (const dot of art.dots) expect(colors!.dots).toContain(dot.fill)
      for (const line of art.lines) expect(line.color).toBe(colors!.line)
    }
    expect(new Set(ids.map((id) => classArt(id, 'light').background)).size).toBeGreaterThan(1)
  })

  test('at least three peers, joined, two of them drawn bigger as stations', () => {
    for (const id of ids) {
      const art = classArt(id, 'light')
      expect(art.dots.length).toBeGreaterThanOrEqual(3)
      expect(art.lines.length).toBeGreaterThanOrEqual(art.dots.length - 1)
      expect(art.dots.filter((d) => d.r > 5)).toHaveLength(2)
      for (const d of art.dots) {
        expect(d.cx).toBeGreaterThan(0)
        expect(d.cx).toBeLessThan(200)
        expect(d.cy).toBeGreaterThan(0)
        expect(d.cy).toBeLessThan(100)
      }
    }
  })

  test('a missing id still draws', () => {
    expect(classArt(undefined as any, 'dark').dots.length).toBeGreaterThan(0)
  })
})
