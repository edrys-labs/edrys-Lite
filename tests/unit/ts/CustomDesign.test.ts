import { describe, test, expect } from 'vitest'
import * as YAML from 'js-yaml'
import {
  checkDesign,
  readDesignFile,
  designFile,
  MAX_DESIGN_FILE_SIZE,
  MAX_DESIGN_NAME_LENGTH,
  type DesignCheck,
} from '../../../src/ts/CustomDesign'
import { DESIGNS, FONTS, designs, designLayout } from '../../../src/ts/Theme'

const paths = (check: DesignCheck) => check.ignored.map((i) => `${i.path}:${i.reason}`)

// Everything checkDesign hands on must be one of these shapes, whatever came in.
const SAFE_VARIABLE = new RegExp(
  [
    '^\\d+(\\.\\d+)?(px|em)$',
    '^(none|uppercase|normal)$',
    ...Object.values(FONTS).map((f) => '^' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
    '^' + String(designs.playful.light.variables!['dots-image']).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$',
  ].join('|')
)

function expectOnlySafeOutput({ design }: DesignCheck) {
  for (const value of Object.values(design.variables)) expect(value).toMatch(SAFE_VARIABLE)
  for (const half of ['light', 'dark'] as const)
    for (const value of Object.values(design.colors[half])) expect(value).toMatch(/^#[0-9a-f]{6}$/)
  for (const value of Object.values(design.layout)) expect(Number.isFinite(value)).toBe(true)
}

describe('CustomDesign', () => {
  test('every built-in design has the same color names', () => {
    const names = Object.keys(designs.standard.light.colors!).sort()
    for (const design of DESIGNS)
      for (const half of ['light', 'dark'] as const)
        expect(Object.keys(designs[design][half].colors!).sort()).toEqual(names)
  })

  test.each(DESIGNS)('the %s design as a token file passes unchanged', (base) => {
    const check = checkDesign(designFile(base))
    expect(check.ignored).toEqual([])
    expect(check.design.base).toBe(base)
    expect(check.design.layout).toEqual(designLayout(base))
    expect(check.design.colors.light).toEqual(designs[base].light.colors)
    expect(check.design.colors.dark).toEqual(designs[base].dark.colors)
    for (const [key, value] of Object.entries(check.design.variables))
      expect(value).toBe(designs[base].light.variables![key])
    expectOnlySafeOutput(check)
  })

  test.each(DESIGNS)('the %s token file reads back from YAML and JSON', (base) => {
    const file = designFile(base)
    for (const text of [YAML.dump(file), JSON.stringify(file, null, 2)]) {
      const check = readDesignFile(text)
      expect('error' in check).toBe(false)
      expect((check as DesignCheck).ignored).toEqual([])
      expect((check as DesignCheck).design).toEqual(checkDesign(file).design)
    }
  })

  test('takes valid fields and maps them to theme variables and layout', () => {
    const check = checkDesign({
      name: 'Ocean',
      base: 'compact',
      font: 'fredoka',
      shape: { 'radius-card': '6px', line: 2 },
      text: { 'text-13': '14.5px' },
      sizes: { bar: 60, 'bar-button': '40px' },
      extras: { 'title-case': 'uppercase', 'title-spacing': '0.05em' },
      light: { colors: { primary: '#0077B6' } },
      dark: { colors: { primary: '#48cae4' } },
    })
    expect(check.ignored).toEqual([])
    expect(check.design).toEqual({
      name: 'Ocean',
      base: 'compact',
      variables: {
        font: FONTS.fredoka,
        'radius-card': '6px',
        line: '2px',
        'text-13': '14.5px',
        'bar-button': '40px',
        'head-case': 'uppercase',
        'head-track': '0.05em',
      },
      layout: { bar: 60 },
      colors: { light: { primary: '#0077b6' }, dark: { primary: '#48cae4' } },
    })
  })

  test('an empty file, or one that is not an object, is plain Standard', () => {
    for (const file of [{}, null, undefined, 'standard', 42, []]) {
      const { design } = checkDesign(file)
      expect(design).toEqual({ name: '', base: 'standard', variables: {}, layout: {}, colors: { light: {}, dark: {} } })
    }
  })

  test('rejects colors that are not exactly #rrggbb', () => {
    const bad = [
      '#fff',
      '#ffffff80',
      'red',
      'rgb(1, 2, 3)',
      'url(https://evil.example/x.png)',
      '#ffffff; } body { display: none',
      '#ffffff;--x:1',
      'var(--v-theme-ink)',
      '#ggg000',
      0xffffff,
      null,
      ['#ffffff'],
      { r: 1 },
    ]
    const colors = Object.fromEntries(bad.map((value, i) => [Object.keys(designs.standard.light.colors!)[i], value]))
    const check = checkDesign({ light: { colors }, dark: { colors } })
    expect(check.design.colors).toEqual({ light: {}, dark: {} })
    expect(check.ignored).toHaveLength(bad.length * 2)
    expect(check.ignored.every((i) => i.reason === 'invalid')).toBe(true)
  })

  test('rejects sizes that are not px within limits', () => {
    const bad = [
      '12px; background: url(https://evil.example)',
      'calc(100vw)',
      '-4px',
      '4em',
      '1e3px',
      '12 px',
      '12.555px',
      'Infinity',
      Infinity,
      NaN,
      -1,
      '41px', // above text limit
      '7px', // below text limit
      '999px', // fully round is for corners only
      true,
    ]
    for (const value of bad) {
      const check = checkDesign({ text: { 'text-13': value } })
      expect(check.design.variables, String(value)).toEqual({})
      expect(paths(check)).toEqual(['text.text-13:invalid'])
    }
    expect(checkDesign({ shape: { 'radius-chip': '999px' } }).design.variables).toEqual({ 'radius-chip': '999px' })
    expect(paths(checkDesign({ shape: { 'radius-chip': '100px', line: '7px' } }))).toEqual([
      'shape.radius-chip:invalid',
      'shape.line:invalid',
    ])
    expect(paths(checkDesign({ sizes: { bar: 20, drawer: '900px', chat: 'wide' } }))).toEqual([
      'sizes.bar:invalid',
      'sizes.drawer:invalid',
      'sizes.chat:invalid',
    ])
  })

  test('drops names it does not know, at every level, including prototype keys', () => {
    const file = JSON.parse(`{
      "css": "body { display: none }",
      "__proto__": { "polluted": true },
      "constructor": { "prototype": { "polluted": true } },
      "shape": { "radius-card: 0; --x": "4px", "toString": "4px", "border-color": "4px" },
      "text": { "text-99": "12px" },
      "sizes": { "width": "100px" },
      "extras": { "shadow": "4px" },
      "light": { "colors": { "primary; --x": "#000000", "hasOwnProperty": "#000000", "border-color": "#000000" }, "css": "x" },
      "dark": { "variables": { "line": "4px" } }
    }`)
    const check = checkDesign(file)
    expect(check.design).toEqual({ name: '', base: 'standard', variables: {}, layout: {}, colors: { light: {}, dark: {} } })
    expect(paths(check).sort()).toEqual(
      [
        'css:unknown',
        '__proto__:unknown',
        'constructor:unknown',
        'shape.radius-card: 0; --x:unknown',
        'shape.toString:unknown',
        'shape.border-color:unknown',
        'text.text-99:unknown',
        'sizes.width:unknown',
        'extras.shadow:unknown',
        'light.colors.primary; --x:unknown',
        'light.colors.hasOwnProperty:unknown',
        'light.colors.border-color:unknown',
        'light.css:unknown',
        'dark.variables:unknown',
      ].sort()
    )
    expect(({} as any).polluted).toBeUndefined()
  })

  test('takes base and font only from their lists', () => {
    const check = checkDesign({ base: 'custom', font: "Comic Sans', url(https://evil.example/f.woff2)" })
    expect(check.design.base).toBe('standard')
    expect(check.design.variables).toEqual({})
    expect(paths(check)).toEqual(['base:invalid', 'font:invalid'])
    expect(paths(checkDesign({ base: ['playful'], font: 'toString' }))).toEqual(['base:invalid', 'font:invalid'])
  })

  test('takes extras only from their fixed values', () => {
    const playful = checkDesign({
      base: 'playful',
      extras: { dots: false, 'shadow-offset': '6px', 'title-case': 'none', 'title-spacing': 'normal' },
    })
    expect(playful.ignored).toEqual([])
    expect(playful.design.variables).toEqual({
      'dots-image': 'none',
      'pop-offset': '6px',
      'head-case': 'none',
      'head-track': 'normal',
    })

    const bad = checkDesign({
      base: 'playful',
      extras: { dots: 'yes', 'shadow-offset': '20px', 'title-case': 'lowercase', 'title-spacing': '1em' },
    })
    expect(bad.design.variables).toEqual({})
    expect(bad.ignored.every((i) => i.reason === 'invalid')).toBe(true)
    expect(bad.ignored).toHaveLength(4)
  })

  test('dots and shadow offset need Playful as the base', () => {
    const check = checkDesign({ base: 'compact', extras: { dots: true, 'shadow-offset': '4px' } })
    expect(check.design.variables).toEqual({})
    expect(paths(check)).toEqual(['extras.dots:needsPlayful', 'extras.shadow-offset:needsPlayful'])
  })

  test('cleans the name and rejects one that is too long or not text', () => {
    expect(checkDesign({ name: '  Ocean\nblue\u0000  ' }).design.name).toBe('Ocean blue')
    expect(checkDesign({ name: '🌊'.repeat(MAX_DESIGN_NAME_LENGTH) }).ignored).toEqual([])
    expect(paths(checkDesign({ name: 'x'.repeat(MAX_DESIGN_NAME_LENGTH + 1) }))).toEqual(['name:invalid'])
    expect(paths(checkDesign({ name: { text: 'x' } }))).toEqual(['name:invalid'])
  })

  test('groups that are not objects are ignored as a whole', () => {
    const check = checkDesign({ shape: '4px', text: [], extras: 'dots', light: '#ffffff', dark: { colors: 'black' } })
    expect(paths(check)).toEqual([
      'shape:invalid',
      'text:invalid',
      'extras:invalid',
      'light:invalid',
      'dark.colors:invalid',
    ])
  })

  test('lists at most 100 ignored fields', () => {
    const colors = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`c${i}`, '#000000']))
    expect(checkDesign({ light: { colors } }).ignored).toHaveLength(100)
  })

  test('random input never gets anything unsafe through', () => {
    const junk = ['4px', '#123456', 'none', 'url(x)', '};', 2.5, true, null, '999px', '0.1em', 'fredoka', 'playful']
    let seed = 7
    const rand = (n: number) => ((seed = (seed * 16807) % 2147483647), seed % n)
    const any = () => junk[rand(junk.length)]
    const keysOf = (obj: object) => Object.keys(obj)
    const file = designFile('playful') as any
    for (let round = 0; round < 200; round++) {
      const mutated = JSON.parse(JSON.stringify(file))
      for (const group of ['shape', 'text', 'sizes', 'extras'])
        for (const key of keysOf(mutated[group])) if (rand(3) === 0) mutated[group][key] = any()
      for (const half of ['light', 'dark'])
        for (const key of keysOf(mutated[half].colors)) if (rand(4) === 0) mutated[half].colors[key] = any()
      if (rand(2) === 0) mutated.font = any()
      expectOnlySafeOutput(checkDesign(mutated))
    }
  })

  describe('reading a file', () => {
    test('refuses a file over the size limit', () => {
      const text = `name: x\n# ${'x'.repeat(MAX_DESIGN_FILE_SIZE)}`
      expect(readDesignFile(text)).toEqual({ error: 'tooLarge' })
    })

    test('counts the size in bytes, not characters', () => {
      const text = `name: x\n# ${'ü'.repeat(MAX_DESIGN_FILE_SIZE / 2)}`
      expect(text.length).toBeLessThan(MAX_DESIGN_FILE_SIZE + 20)
      expect(readDesignFile(text)).toEqual({ error: 'tooLarge' })
    })

    test('refuses text that is not YAML or JSON', () => {
      expect(readDesignFile('name: [unclosed')).toEqual({ error: 'unreadable' })
      expect(readDesignFile('name: !!js/function "function () { return 1 }"')).toEqual({ error: 'unreadable' })
    })

    test('refuses a file that is not a mapping', () => {
      for (const text of ['', 'just text', '- a\n- b', '42', 'null']) expect(readDesignFile(text)).toEqual({ error: 'notADesign' })
    })

    test('a YAML file with bad entries still brings its good ones', () => {
      const check = readDesignFile(`
name: Forest
base: standard
light:
  colors:
    primary: '#2d6a4f'
    background: url(https://evil.example/track.png)
`) as DesignCheck
      expect(check.design.colors.light).toEqual({ primary: '#2d6a4f' })
      expect(paths(check)).toEqual(['light.colors.background:invalid'])
    })
  })
})
