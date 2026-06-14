/**
 * Ingest-time sanitization for directory-sourced strings (A5-08).
 *
 * LDAP/AD attribute values (`displayName` → firstName/lastName, `mail`) are
 * untrusted input: in many environments users can edit their own display name,
 * so a value like `<img src=x onerror=alert(1)>` can be persisted and later
 * rendered in admin user lists / dashboards (stored-XSS seed). The frontend
 * escapes on output, but defense-in-depth requires normalizing on ingest too.
 *
 * This is NOT HTML-encoding (we store the literal value); it strips characters
 * that have no legitimate place in a name/email — control characters and the
 * Unicode bidi/zero-width set abused for spoofing (the same set used by
 * `sanitize-filename.ts`) — and caps length so a hostile directory cannot stuff
 * arbitrarily large payloads into a user record.
 */

/**
 * C0/C1 control characters — tab, newline, NUL, etc. have no place in a
 * single-line name or email and can break log/CSV/UI rendering.
 * U+0000–U+001F and U+007F–U+009F.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: deliberately matching control chars to strip them
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Unicode bidirectional-override and zero-width characters — invisible or
 * text-reordering, abused to spoof the visible value. Mirrors the set stripped
 * by `sanitize-filename.ts`:
 *   - U+200B–U+200F  zero-width space/joiner/non-joiner + LRM/RLM bidi marks
 *   - U+202A–U+202E  LRE/RLE/PDF/LRO/RLO bidi embedding + overrides
 *   - U+2066–U+2069  LRI/RLI/FSI isolates + PDI
 *   - U+FEFF         zero-width no-break space (BOM)
 */
const BIDI_AND_ZERO_WIDTH = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;

/** Conservative caps. Display-name parts and emails are short in practice. */
const MAX_NAME_LENGTH = 256;
const MAX_EMAIL_LENGTH = 320; // RFC 5321 maximum total email length

/**
 * Normalize a directory-sourced display string (used for displayName before it
 * is split, and the resulting first/last name parts). Strips control and
 * bidi/zero-width characters, collapses surrounding whitespace, and caps length.
 */
export function sanitizeDirectoryName(value: string): string {
  if (!value) return "";
  let safe = value.replace(CONTROL_CHARS, "");
  safe = safe.replace(BIDI_AND_ZERO_WIDTH, "");
  safe = safe.trim();
  if (safe.length > MAX_NAME_LENGTH) {
    safe = safe.slice(0, MAX_NAME_LENGTH).trim();
  }
  return safe;
}

/**
 * Normalize a directory-sourced email. Strips control/bidi/zero-width chars and
 * surrounding whitespace, lowercases, and rejects implausible values: an email
 * that, after cleaning, does not contain a single `@` with non-empty local and
 * domain parts, contains internal whitespace, or exceeds the RFC length cap is
 * treated as unusable.
 *
 * @returns the normalized email, or `null` when the value is implausible (the
 *   caller should skip the user — a malformed email is not safe to persist).
 */
export function sanitizeDirectoryEmail(value: string): string | null {
  if (!value) return null;
  let safe = value.replace(CONTROL_CHARS, "");
  safe = safe.replace(BIDI_AND_ZERO_WIDTH, "");
  safe = safe.trim().toLowerCase();

  if (!safe || safe.length > MAX_EMAIL_LENGTH) return null;
  if (/\s/.test(safe)) return null; // internal whitespace → not a valid address

  const at = safe.indexOf("@");
  if (at <= 0 || at !== safe.lastIndexOf("@")) return null; // need exactly one @, non-empty local
  const domain = safe.slice(at + 1);
  if (!domain.includes(".")) return null; // need a dotted domain

  return safe;
}
