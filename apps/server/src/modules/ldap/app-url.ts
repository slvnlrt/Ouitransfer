/**
 * `appUrl` validation for LDAP welcome / password-set links (A5-13).
 *
 * New LDAP users receive a password-set link built from the admin-configured
 * `appUrl`. That link carries a reset token (a credential), so a wrong or hostile
 * `appUrl` would deliver valid reset tokens to an attacker-controlled host. We
 * therefore require `appUrl` to be a canonical `http(s)://` origin before it is
 * used to build any credential-bearing link.
 *
 * R5 (A6-07) landed the central `appUrl` config validator in
 * `config/config-validation.ts`, which is now the single source of truth for what
 * a canonical origin is. This module delegates to it (re-exporting
 * `isCanonicalHttpOrigin`) and keeps only the LDAP-specific welcome-link policy
 * (the divergence warning vs the configured `appUrl`).
 */

import { getLogger } from "../../utils/logger.js";
import { isCanonicalHttpOrigin } from "../config/config-validation.js";

export { isCanonicalHttpOrigin };

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
