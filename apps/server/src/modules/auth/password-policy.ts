/**
 * Centralised password policy (A1-09 / A1-17).
 *
 * One source of truth for every password rule, applied identically at the Zod
 * route boundary (`buildPasswordSchema`) and in the imperative middleware
 * (`assertPasswordPolicy`). Keeping both in sync is mandatory — Fastify + Zod
 * strip unknown fields but do NOT cross-validate against the middleware, so a
 * rule added in only one place is a silent gap.
 *
 * Rules:
 *   - Minimum length: the admin-configured `passwordMinLength` (default 12).
 *   - Maximum length: {@link PASSWORD_MAX_BYTES} *bytes* (UTF-8). bcrypt silently
 *     truncates input at 72 bytes, so anything longer is partially ignored —
 *     rejecting it outright prevents a misleadingly "strong" password whose tail
 *     is dead weight, and blocks a long-string DoS against the hash function.
 *   - Complexity: at least 3 of the 4 character classes (lower, upper, digit,
 *     symbol). This is intentionally a "3 of 4" rule rather than "all 4" so that
 *     long passphrases remain acceptable without forcing symbol soup.
 */

import { z } from "zod";

import { ValidationError } from "../../utils/app-error.js";
import { getConfigValue } from "../config/service.js";

/**
 * bcrypt work factor for ALL password hashing (registration, reset, invite,
 * admin user-create/update). Raised from 10 → 12 (A1-17 / A8-14): bcryptjs is
 * pure-JS and ~3-5x slower than native bcrypt, so cost 12 here is a meaningful
 * uplift without an unacceptable latency cost on auth endpoints.
 */
export const BCRYPT_COST = 12;

/**
 * Maximum password length in BYTES (not characters). bcrypt only consumes the
 * first 72 bytes of its input; anything beyond is ignored. We measure bytes (via
 * UTF-8 encoding) because multi-byte characters reach the 72-byte ceiling in
 * fewer than 72 characters.
 */
export const PASSWORD_MAX_BYTES = 72;

/** Number of distinct character classes a password must contain. */
const REQUIRED_CHARACTER_CLASSES = 3;

/** Default minimum length used when the config row is missing/unparseable. */
const DEFAULT_MIN_LENGTH = 12;

/** UTF-8 byte length of a string. */
function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/** How many of the four character classes the password draws from. */
function characterClassCount(value: string): number {
  let count = 0;
  if (/[a-z]/.test(value)) count++;
  if (/[A-Z]/.test(value)) count++;
  if (/[0-9]/.test(value)) count++;
  // Anything that is not an ASCII letter or digit counts as a "symbol" class —
  // this covers punctuation, whitespace, and non-ASCII (e.g. accented) glyphs.
  if (/[^a-zA-Z0-9]/.test(value)) count++;
  return count;
}

/** Resolve the configured minimum length, falling back to the safe default. */
export async function getPasswordMinLength(): Promise<number> {
  try {
    const parsed = Number(await getConfigValue("passwordMinLength"));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_LENGTH;
  } catch {
    return DEFAULT_MIN_LENGTH;
  }
}

/**
 * Build a Zod schema enforcing the full password policy (min length, max bytes,
 * complexity). `minLength` is the admin-configured value resolved by the caller.
 */
export function buildPasswordSchema(minLength: number) {
  return z
    .string()
    .min(minLength, `Password must be at least ${minLength} characters`)
    .refine((value) => byteLength(value) <= PASSWORD_MAX_BYTES, {
      message: `Password must not exceed ${PASSWORD_MAX_BYTES} bytes`,
    })
    .refine((value) => characterClassCount(value) >= REQUIRED_CHARACTER_CLASSES, {
      message: "Password must include at least 3 of: lowercase, uppercase, number, symbol",
    })
    .describe("User password");
}

/** Convenience: resolve the configured min length and build the schema. */
export async function createPasswordPolicySchema() {
  return buildPasswordSchema(await getPasswordMinLength());
}

/**
 * Imperative form of the policy for the `preValidation` middleware. Throws
 * {@link ValidationError} on the first violated rule. Must mirror
 * {@link buildPasswordSchema} exactly.
 */
export async function assertPasswordPolicy(password: string): Promise<void> {
  const minLength = await getPasswordMinLength();

  if (password.length < minLength) {
    throw new ValidationError(`Password must be at least ${minLength} characters long`);
  }
  if (byteLength(password) > PASSWORD_MAX_BYTES) {
    throw new ValidationError(`Password must not exceed ${PASSWORD_MAX_BYTES} bytes`);
  }
  if (characterClassCount(password) < REQUIRED_CHARACTER_CLASSES) {
    throw new ValidationError(
      "Password must include at least 3 of: lowercase, uppercase, number, symbol",
    );
  }
}
