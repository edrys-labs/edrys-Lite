import { describe, test, expect } from 'vitest'
import { classArt } from '../../../src/ts/ClassArt'
import { ROOM_COLORS } from '../../../src/ts/Theme'

describe('class art', () => {
  test('a class gets the same picture every time', () => {
    expect(classArt('abc', 'light')).toEqual(classArt('abc', 'light'))
  })

  test('the ground is a room colour of the theme', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(ROOM_COLORS.map((c) => c.light.bg)).toContain(classArt('abc', 'light').background)
    expect(ROOM_COLORS.map((c) => c.dark.bg)).toContain(classArt('abc', 'dark').background)
    expect(new Set(ids.map((id) => classArt(id, 'light').background)).size).toBeGreaterThan(1)
  })

  test('peers are joined, two of them drawn bigger as stations', () => {
    const art = classArt('linux-basics', 'light')
    expect(art.dots.length).toBeGreaterThanOrEqual(3)
    expect(art.lines.length).toBeGreaterThanOrEqual(art.dots.length - 1)
    expect(art.dots.filter((d) => d.r > 5)).toHaveLength(2)
    for (const d of art.dots) {
      expect(d.cx).toBeGreaterThan(0)
      expect(d.cx).toBeLessThan(200)
      expect(d.cy).toBeGreaterThan(0)
      expect(d.cy).toBeLessThan(100)
    }
  })

  test('a missing id still draws', () => {
    expect(classArt(undefined as any, 'dark').dots.length).toBeGreaterThan(0)
  })
})
