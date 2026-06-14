import { z } from "zod";

/**
 * Validation for user-chosen share / reverse-share aliases.
 *
 * Aliases are exposed in public URLs (`/s/:alias`, `/r/:alias`), so they must
 * stay URL-clean: ASCII alphanumerics with single internal hyphens only — no
 * leading, trailing, or consecutive hyphens. Length is bounded to keep links
 * memorable and to avoid squatting of very short aliases.
 *
 * The minimum length is 8 (R2 — A4-12): 5-char alphanumerics are enumerable at
 * scale (62^5 ≈ 0.9B) and the public metadata/upload-info endpoints leak useful
 * info for valid ones; 8 chars (62^8 ≈ 2.2e14) materially raises the enumeration
 * bar while staying memorable. Auto-generated aliases are 10 chars, so they are
 * unaffected.
 *
 * Shared between the share and reverse-share modules so the two never drift.
 */
export const ALIAS_MIN_LENGTH = 8;
export const ALIAS_MAX_LENGTH = 30;

/** Alphanumerics with single internal hyphens (no leading/trailing/double `-`). */
export const ALIAS_PATTERN = /^[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;

export const aliasSchema = z
  .string()
  .min(ALIAS_MIN_LENGTH, `Alias must be at least ${ALIAS_MIN_LENGTH} characters long`)
  .max(ALIAS_MAX_LENGTH, `Alias must not exceed ${ALIAS_MAX_LENGTH} characters`)
  .regex(ALIAS_PATTERN, "Alias may contain only letters, numbers, and single internal hyphens");
