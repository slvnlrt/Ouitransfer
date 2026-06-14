/**
 * `appUrl` validation for LDAP welcome / password-set links (A5-13).
 *
 * New LDAP users receive a password-set link built from the admin-configured
 * `appUrl`. That link carries a reset token (a credential), so a wrong or hostile
 * `appUrl` would deliver valid reset tokens to an attacker-controlled host. We
 * therefore require `appUrl` to be a canonical `http(s)://` origin before it is
 * used to build any credential-bearing link.
 *
 * NOTE (cross-batch): R5 owns the central `appUrl` config validator. This is the
 * minimal LDAP-local guard; when R5 lands its validator the two should be
 * consolidated (this module can delegate to it).
 */

import { getLogger } from "../../utils/logger.js";

/**
 * Whether `value` is a canonical, credential-safe `http(s)://` origin:
 *   - parseable as a URL,
 *   - http or https scheme only (rejects `javascript:`, `ftp:`, `data:`, …),
 *   - has a hostname,
 *   - carries no userinfo (`user:pass@`), which could mask the real host.
 */
export function isCanonicalHttpOrigin(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!url.hostname) return false;
  if (url.username || url.password) return false;
  return true;
}

/**
 * Assert that `appUrl` is a canonical http(s):// origin before it is used to
 * build a credential-bearing link. Throws when it is not.
 *
 * When `expectedOrigin` is provided (e.g. the global config `appUrl` the email
 * layer will actually use), a divergence is logged as a warning — a mismatch is
 * a strong signal of misconfiguration even though it is not fatal on its own.
 */
export function assertSafeAppUrl(appUrl: string, expectedOrigin?: string): void {
  if (!isCanonicalHttpOrigin(appUrl)) {
    throw new Error(
      `LDAP appUrl "${appUrl}" is not a valid http(s):// origin; refusing to build a credential-bearing welcome link`,
    );
  }
  if (expectedOrigin && isCanonicalHttpOrigin(expectedOrigin)) {
    const a = new URL(appUrl).origin;
    const b = new URL(expectedOrigin).origin;
    if (a !== b) {
      getLogger().warn(
        { ldapAppUrl: a, configuredAppUrl: b },
        "LDAP appUrl origin diverges from the configured application appUrl — welcome links may point at an unexpected host",
      );
    }
  }
}
