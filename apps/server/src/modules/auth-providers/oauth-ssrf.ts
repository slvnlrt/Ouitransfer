/**
 * SSRF-guarded egress for the OAuth/OIDC flow (A5-05 OAuth portion).
 *
 * Every server-side `fetch()` the federated-identity flow performs targets a URL
 * that is, ultimately, admin-configured or pulled from an OIDC discovery document.
 * Both are attacker-influençable (a compromised admin session, or a hostile
 * discovery doc pointing endpoints at an internal host). This module centralises
 * the egress policy so OIDC discovery, the JWKS fetch, the token endpoint, the
 * userinfo endpoint, and the GitHub email endpoint all pass through the same
 * {@link assertUrlAllowed} guard before any connection is made.
 *
 * Policy:
 *   - Reject cloud-metadata, loopback, link-local, and private-range hosts unless
 *     `OAUTH_ALLOW_PRIVATE_ENDPOINT=true` (self-hosted IdP on a trusted network)
 *     or the exact host is listed in `OAUTH_ALLOWED_ENDPOINT_HOSTS`. Metadata
 *     hosts are NEVER allowed.
 *   - In production, require https (TLS-verified by Node's default agent) so the
 *     id_token / access_token are never exchanged in cleartext, and an `http://`
 *     issuer cannot be used to MITM the flow. The private-endpoint escape hatch
 *     relaxes this for internal IdPs that legitimately speak http on a trusted LAN.
 */

import { env } from "../../env.js";
import { assertUrlAllowed, type SsrfGuardOptions } from "../../utils/ssrf-guard.js";

const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * Build the SSRF guard options for OAuth egress from the environment.
 * Exposed so the discovery/JWKS/token/userinfo paths share one policy.
 */
export function getOAuthSsrfOptions(): SsrfGuardOptions {
  const allowPrivate = env.OAUTH_ALLOW_PRIVATE_ENDPOINT === "true";
  const allowlist = (env.OAUTH_ALLOWED_ENDPOINT_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  // In production, https is required for non-private deployments so tokens are
  // never exchanged over cleartext and `http://` issuers cannot be MITM'd.
  const requireHttps = process.env.NODE_ENV === "production" && !allowPrivate;

  return { allowPrivate, allowlist, requireHttps };
}

/**
 * Validate an outbound OAuth/OIDC URL against the SSRF policy. Throws
 * {@link import("../../utils/ssrf-guard.js").SsrfValidationError} when the host is
 * a metadata/private/loopback address (and not opted in) or — in production — when
 * the scheme is not https.
 *
 * @returns the parsed {@link URL} for reuse by the caller.
 */
export function assertOAuthUrlAllowed(rawUrl: string): URL {
  return assertUrlAllowed(rawUrl, getOAuthSsrfOptions());
}

/**
 * `fetch()` that first runs the URL through {@link assertOAuthUrlAllowed} and
 * applies a default abort timeout. All server-side OAuth egress MUST go through
 * this wrapper.
 *
 * Note: this validates the literal host. DNS-rebinding (a hostname that resolves
 * to an internal IP at connect time) is not covered here — the IdP endpoints are
 * operator-configured, and the redirect/token-exchange flow already pins the
 * id_token's `iss` to the configured issuer, so a rebind cannot forge identity.
 */
export async function ssrfSafeFetch(rawUrl: string, init?: RequestInit): Promise<Response> {
  assertOAuthUrlAllowed(rawUrl);
  return fetch(rawUrl, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
    ...init,
  });
}
