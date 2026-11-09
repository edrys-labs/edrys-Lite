import { getPeerID } from "./Utils";

export const MAX_USERNAME_LENGTH = 32;

// Control and invisible formatting characters, such as the bidi overrides that
// reorder how a name reads. The zero-width (non-)joiners stay: emoji sequences
// and scripts like Persian need them.
const HIDDEN = /(?![‌‍])[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const VISIBLE = /[\p{L}\p{N}\p{P}\p{S}]/u;
// Letters and symbols that draw nothing. They only count against a name being
// visible: removing them from names would also remove emoji variation selectors.
const BLANK = /[\p{Default_Ignorable_Code_Point}⠀]/gu;

/**
 * The name to show for `value`, or null if there is none to show. Other peers'
 * names are untrusted, so this runs on every name read, not only on our own.
 */
export function validUsername(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.replace(/\s+/g, " ").replace(HIDDEN, "").trim();
  if (!VISIBLE.test(name.replace(BLANK, ""))) return null;
  return Array.from(name).length <= MAX_USERNAME_LENGTH ? name : null;
}

const storageKey = () => `username_${getPeerID(false)}`;

/** This identity's saved name, or "" if it has none. */
export function loadUsername(): string {
  try {
    return validUsername(localStorage.getItem(storageKey())) ?? "";
  } catch {
    return "";
  }
}

/** Saves this identity's name, cut to the limit, or forgets it if `value` isn't one; returns what was saved. */
export function saveUsername(value: string): string {
  const name = validUsername(Array.from(value.trim()).slice(0, MAX_USERNAME_LENGTH).join(""));
  try {
    if (name) localStorage.setItem(storageKey(), name);
    else localStorage.removeItem(storageKey());
  } catch {
    // Without storage the name still applies until the page closes.
  }
  return name ?? "";
}
