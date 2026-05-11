import crypto from "node:crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Uses crypto.timingSafeEqual under the hood. Returns false (without
 * leaking length information beyond the boolean) when the strings
 * differ in length — the short-circuit is unavoidable but an attacker
 * already knows the expected length for fixed-format tokens.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf-8"), Buffer.from(b, "utf-8"));
}
