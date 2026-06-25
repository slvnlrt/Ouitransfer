/**
 * Client-side share / reverse-share alias validation.
 *
 * Mirrors the server-side rule in `apps/server/src/shared/alias-schema.ts`:
 * 8–30 characters, ASCII alphanumerics with single internal hyphens only
 * (no leading, trailing, or consecutive hyphens). Kept in sync so the UI
 * rejects the same values the API does, before a request is sent.
 */
export const ALIAS_MIN_LENGTH = 8;
export const ALIAS_MAX_LENGTH = 30;

/** Alphanumerics with single internal hyphens (no leading/trailing/double `-`). */
export const ALIAS_PATTERN = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;

export type AliasValidationError = "required" | "minLength" | "maxLength" | "pattern";

/**
 * Returns which validation rule an alias violates, or `null` when it is valid.
 * The returned key maps to the `common.aliasValidation.*` i18n messages.
 */
export function getAliasValidationError(alias: string): AliasValidationError | null {
  if (alias.length === 0) return "required";
  if (alias.length < ALIAS_MIN_LENGTH) return "minLength";
  if (alias.length > ALIAS_MAX_LENGTH) return "maxLength";
  if (!ALIAS_PATTERN.test(alias)) return "pattern";
  return null;
}
