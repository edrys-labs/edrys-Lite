import { describe, test, expect } from 'vitest';
import en from '@/locales/en.yaml';
import de from '@/locales/de.yaml';
import uk from '@/locales/uk.yaml';
import ar from '@/locales/ar.yaml';
import es from '@/locales/es.yaml';

// Every UI string must exist in every language: a key missing from one
// locale silently falls back to English (or shows the raw key).

function flatten(obj: any, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value && typeof value === 'object') Object.assign(out, flatten(value, prefix + key + '.'));
    else out[prefix + key] = value;
  }
  return out;
}

const english = flatten(en);

describe.each([
  ['de', de],
  ['uk', uk],
  ['ar', ar],
  ['es', es],
])('locale %s', (_name, locale) => {
  const translated = flatten(locale);

  test('has exactly the English keys', () => {
    expect(Object.keys(translated).sort()).toEqual(Object.keys(english).sort());
  });

  test('has no empty strings', () => {
    const empty = Object.entries(translated).filter(([, v]) => typeof v === 'string' && v.trim() === '');
    expect(empty).toEqual([]);
  });
});
