/**
 * Shared client-side email validation.
 *
 * This is a lightweight shape check (non-empty local part, "@", non-empty
 * domain with a dot) used to give immediate feedback in the UI. The server
 * performs the authoritative validation via Zod's `z.email()`. Keeping a single
 * source of truth here prevents the four prior inline copies from drifting.
 */

/** Lightweight email shape: `local@domain.tld` with no whitespace. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns true when `email` matches the lightweight client-side shape check. */
export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}
