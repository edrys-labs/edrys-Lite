export const MAX_USERNAME_LENGTH = 32;

// Control and invisible formatting characters, such as the bidi overrides that
// reorder how a name reads. The zero-width (non-)joiners stay: emoji sequences
// and scripts like Persian need them.
const HIDDEN = /(?![‌‍])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;

/**
 * The name to show for `value`, or null if there is none to show. Other peers'
 * names are untrusted, so this runs on every name read, not only on our own.
 */
export function validUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").replace(HIDDEN, "").trim();
  if (!VISIBLE.test(name)) return null;
  return Array.from(name).length <= MAX_USERNAME_LENGTH ? name : null;
}
