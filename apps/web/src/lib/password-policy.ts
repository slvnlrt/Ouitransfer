import { z } from "zod";

/**
 * Client-side mirror of the server password policy (A1-09).
 *
 * Keep in sync with `apps/server/src/modules/auth/password-policy.ts`:
 *   - minimum length 12,
 *   - maximum 72 BYTES (bcrypt truncation ceiling),
 *   - at least 3 of 4 character classes (lower / upper / digit / symbol).
 *
 * This is UX-only validation — the server is the authority and re-validates every
 * new password. The messages are passed in so callers can supply translated copy.
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_BYTES = 72;

function byteLength(value: string): number {
  // TextEncoder yields UTF-8 byte length, matching the server's Buffer.byteLength.
  return new TextEncoder().encode(value).length;
}

function characterClassCount(value: string): number {
  let count = 0;
  if (/[a-z]/.test(value)) count++;
  if (/[A-Z]/.test(value)) count++;
  if (/[0-9]/.test(value)) count++;
  if (/[^a-zA-Z0-9]/.test(value)) count++;
  return count;
}

export interface PasswordPolicyMessages {
  minLength: string;
  maxLength: string;
  complexity: string;
}

/** Build a Zod string schema enforcing the full client-side password policy. */
export function createPasswordPolicySchema(messages: PasswordPolicyMessages) {
  return z
    .string()
    .min(PASSWORD_MIN_LENGTH, messages.minLength)
    .refine((value) => byteLength(value) <= PASSWORD_MAX_BYTES, { message: messages.maxLength })
    .refine((value) => characterClassCount(value) >= 3, { message: messages.complexity });
}
