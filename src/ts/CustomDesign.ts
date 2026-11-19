import * as YAML from 'js-yaml'
import { DESIGNS, FONTS, designs, designLayout, type Design } from './Theme'

/**
 * A class's own design: a token file (YAML or JSON) on top of a built-in
 * design. Everything in it is checked here before it reaches the page,
 * because Vuetify writes theme values as they are into a <style> element
 * (`--v-<name>: <value>`): an unchecked name or value could add any CSS, and
 * a color Vuetify can't read stops the class from rendering. Lab files are
 * often imported from elsewhere without being read, so a bad entry is
 * dropped and listed, never applied, and the rest of the file still counts.
 *
 * Only names from fixed lists are taken, colors only as `#rrggbb`, sizes
 * only as px within limits, everything else only from a fixed set of values.
 */

export const MAX_DESIGN_FILE_SIZE = 50_000 // bytes
export const MAX_DESIGN_NAME_LENGTH = 40
const MAX_IGNORED = 100

export type Layout = { bar: number; drawer: number; chat: number }

export interface CustomDesign {
  name: string
  base: Design
  /** Theme variables replacing the base's, the same in Light and Dark. */
  variables: Record<string, string>
  /** Bar height and panel widths replacing the base's. */
  layout: Partial<Layout>
  /** Colors replacing the base's, per half. */
  colors: { light: Record<string, string>; dark: Record<string, string> }
}

export interface IgnoredEntry {
  /** Where it was in the file, e.g. `light.colors.primary`. */
  path: string
  /** unknown: not a field; invalid: a value out of range or of the wrong kind;
   * needsPlayful: only drawn when the base is Playful */
  reason: 'unknown' | 'invalid' | 'needsPlayful'
}

export interface DesignCheck {
  design: CustomDesign
  ignored: IgnoredEntry[]
}

export type DesignFileError = 'tooLarge' | 'unreadable' | 'notADesign'

type Range = { min: number; max: number; also?: number[] }

const RADIUS: Range = { min: 0, max: 64, also: [999] } // 999px: fully round
const SHAPE: Record<string, Range> = {
  'radius-dialog': RADIUS,
  'radius-card': RADIUS,
  'radius-row': RADIUS,
  'radius-control': RADIUS,
  'radius-chip': RADIUS,
  'radius-tile': RADIUS,
  'radius-pill': RADIUS,
  line: { min: 0, max: 6 },
}
const TEXT_SIZE: Range = { min: 8, max: 40 }
const TEXT = Object.fromEntries(
  ['10', '11', '12', '13', '14', '15', '16', '17', '18', '20', '22'].map((n) => [`text-${n}`, TEXT_SIZE])
) as Record<string, Range>
const SIZES: Record<string, Range> = {
  bar: { min: 32, max: 120 },
  drawer: { min: 160, max: 480 },
  chat: { min: 240, max: 600 },
  'bar-button': { min: 20, max: 72 },
  'module-head': { min: 20, max: 72 },
}
const LAYOUT_KEYS = new Set(['bar', 'drawer', 'chat'])
const SHADOW_OFFSET: Range = { min: 0, max: 16 }
const TITLE_SPACING: Range = { min: 0, max: 0.3 } // em

const COLOR_NAMES = new Set(Object.keys(designs.standard.light.colors ?? {}))
const TOP_LEVEL = new Set(['name', 'base', 'font', 'shape', 'text', 'sizes', 'extras', 'light', 'dark'])
const EXTRAS = new Set(['title-case', 'title-spacing', 'dots', 'shadow-offset'])
const PLAYFUL_ONLY = new Set(['dots', 'shadow-offset'])

const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x)

const has = <T extends object>(obj: T, key: string): key is Extract<keyof T, string> =>
  Object.prototype.hasOwnProperty.call(obj, key)

/** `12`, `12px` or `2.5px` within the range, as `12px`; undefined otherwise. */
function px(value: unknown, range: Range): string | undefined {
  const n = number(value, /^(\d{1,4}(?:\.\d{1,2})?)px$/)
  if (n === undefined) return undefined
  if ((n < range.min || n > range.max) && !range.also?.includes(n)) return undefined
  return `${n}px`
}

function number(value: unknown, pattern: RegExp): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : undefined
  if (typeof value !== 'string') return undefined
  const match = pattern.exec(value.trim())
  return match ? Number(match[1]) : undefined
}

function color(value: unknown): string | undefined {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toLowerCase() : undefined
}

function name(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return Array.from(text).length <= MAX_DESIGN_NAME_LENGTH ? text : undefined
}

/**
 * Checks a parsed token file. Whatever isn't a known field with a valid value
 * is left out and listed in `ignored`; an unknown or missing base is Standard.
 */
export function checkDesign(file: unknown): DesignCheck {
  const ignored: IgnoredEntry[] = []
  const ignore = (path: string, reason: IgnoredEntry['reason']) => {
    if (ignored.length < MAX_IGNORED) ignored.push({ path, reason })
  }
  const input = isRecord(file) ? file : {}
  const field = (key: string) => (has(input, key) ? input[key] : undefined)

  for (const key of Object.keys(input)) if (!TOP_LEVEL.has(key)) ignore(key, 'unknown')

  const design: CustomDesign = {
    name: '',
    base: 'standard',
    variables: {},
    layout: {},
    colors: { light: {}, dark: {} },
  }

  if (field('name') !== undefined) {
    const checked = name(field('name'))
    if (checked !== undefined) design.name = checked
    else ignore('name', 'invalid')
  }

  if (field('base') !== undefined) {
    const base = field('base')
    if (typeof base === 'string' && (DESIGNS as string[]).includes(base)) design.base = base as Design
    else ignore('base', 'invalid')
  }

  if (field('font') !== undefined) {
    const font = field('font')
    if (typeof font === 'string' && has(FONTS, font)) design.variables.font = FONTS[font]
    else ignore('font', 'invalid')
  }

  // shape, text and sizes: px values within each field's limits
  const groups: [string, Record<string, Range>][] = [
    ['shape', SHAPE],
    ['text', TEXT],
    ['sizes', SIZES],
  ]
  for (const [group, ranges] of groups) {
    const block = field(group)
    if (block === undefined) continue
    if (!isRecord(block)) {
      ignore(group, 'invalid')
      continue
    }
    for (const key of Object.keys(block)) {
      if (!has(ranges, key)) {
        ignore(`${group}.${key}`, 'unknown')
        continue
      }
      const value = px(block[key], ranges[key])
      if (value === undefined) ignore(`${group}.${key}`, 'invalid')
      else if (LAYOUT_KEYS.has(key)) design.layout[key as keyof Layout] = parseFloat(value)
      else design.variables[key] = value
    }
  }

  const extras = field('extras')
  if (extras !== undefined) {
    if (!isRecord(extras)) ignore('extras', 'invalid')
    else
      for (const key of Object.keys(extras)) {
        const path = `extras.${key}`
        const value = extras[key]
        if (!EXTRAS.has(key)) ignore(path, 'unknown')
        else if (PLAYFUL_ONLY.has(key) && design.base !== 'playful') ignore(path, 'needsPlayful')
        else if (key === 'title-case') {
          if (value === 'none' || value === 'uppercase') design.variables['head-case'] = value
          else ignore(path, 'invalid')
        } else if (key === 'title-spacing') {
          const em = value === 'normal' ? 0 : number(value, /^(\d(?:\.\d{1,3})?)em$/)
          if (em !== undefined && em >= TITLE_SPACING.min && em <= TITLE_SPACING.max)
            design.variables['head-track'] = em === 0 ? 'normal' : `${em}em`
          else ignore(path, 'invalid')
        } else if (key === 'dots') {
          if (typeof value === 'boolean')
            design.variables['dots-image'] = value ? String(designs.playful.light.variables?.['dots-image']) : 'none'
          else ignore(path, 'invalid')
        } else if (key === 'shadow-offset') {
          const offset = px(value, SHADOW_OFFSET)
          if (offset !== undefined) design.variables['pop-offset'] = offset
          else ignore(path, 'invalid')
        }
      }
  }

  for (const half of ['light', 'dark'] as const) {
    const block = field(half)
    if (block === undefined) continue
    if (!isRecord(block)) {
      ignore(half, 'invalid')
      continue
    }
    for (const key of Object.keys(block)) if (key !== 'colors') ignore(`${half}.${key}`, 'unknown')
    const colors = has(block, 'colors') ? block.colors : undefined
    if (colors === undefined) continue
    if (!isRecord(colors)) {
      ignore(`${half}.colors`, 'invalid')
      continue
    }
    for (const key of Object.keys(colors)) {
      const path = `${half}.colors.${key}`
      if (!COLOR_NAMES.has(key)) ignore(path, 'unknown')
      else {
        const value = color(colors[key])
        if (value === undefined) ignore(path, 'invalid')
        else design.colors[half][key] = value
      }
    }
  }

  return { design, ignored }
}

/** Reads and checks a token file's text (YAML or JSON). */
export function readDesignFile(text: string): DesignCheck | { error: DesignFileError } {
  if (new TextEncoder().encode(text).length > MAX_DESIGN_FILE_SIZE) return { error: 'tooLarge' }
  let file: unknown
  try {
    file = JSON.parse(text)
  } catch (e) {
    try {
      // js-yaml 4's default schema: plain data only, no functions or classes
      file = YAML.load(text)
    } catch (e) {
      return { error: 'unreadable' }
    }
  }
  if (!isRecord(file)) return { error: 'notADesign' }
  return checkDesign(file)
}

/**
 * A built-in design as a complete token file, a starting point for a
 * class's own. Every value in it passes checkDesign.
 */
export function designFile(base: Design) {
  const variables = designs[base].light.variables ?? {}
  const v = (key: string) => String(variables[key])
  const layout = designLayout(base)
  const font = (Object.keys(FONTS) as (keyof typeof FONTS)[]).find((f) => FONTS[f] === v('font'))
  const pick = (ranges: Record<string, Range>) =>
    Object.fromEntries(Object.keys(ranges).filter((k) => !LAYOUT_KEYS.has(k)).map((k) => [k, v(k)]))

  return {
    name: '',
    base,
    font,
    shape: pick(SHAPE),
    text: pick(TEXT),
    sizes: {
      bar: `${layout.bar}px`,
      drawer: `${layout.drawer}px`,
      chat: `${layout.chat}px`,
      'bar-button': v('bar-button'),
      'module-head': v('module-head'),
    },
    extras: {
      'title-case': v('head-case'),
      'title-spacing': v('head-track'),
      ...(base === 'playful' ? { dots: v('dots-image') !== 'none', 'shadow-offset': v('pop-offset') } : {}),
    },
    light: { colors: { ...designs[base].light.colors } },
    dark: { colors: { ...designs[base].dark.colors } },
  }
}
