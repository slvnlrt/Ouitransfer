/**
 * Server-fixed OAuth callback URL + return-path handling (A5-04 / A6-01).
 *
 * The OAuth `redirect_uri` and the post-login redirect base are computed from the
 * trusted `appUrl` config — NEVER from `request.hostname` / `Host` / a client
 * `redirect_uri` query param. This defeats host-header poisoning and redirect_uri
 * injection: the same fixed callback URL is sent at authorize-time and token-time.
 *
 * The post-login destination is kept SEPARATE and may only be a relative path
 * (e.g. "/dashboard"); any absolute or protocol-relative value is rejected and the
 * default is used.
 */

import { getAppUrl } from "../email/url-builder.js";

const DEFAULT_RETURN_PATH = "/dashboard";

/** Strip a single trailing slash so `${base}/...` never double-slashes. */
function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The fixed OAuth callback URL for a provider, derived from `appUrl`.
 * Identical at authorize-time and token-time.
 */
export async function getOAuthCallbackUrl(providerName: string): Promise<string> {
  const base = trimTrailingSlash(await getAppUrl());
  return `${base}/api/auth/providers/${providerName}/callback`;
}

/** The trusted app origin (scheme + host), derived from `appUrl`. */
export async function getAppOrigin(): Promise<string> {
  return new URL(await getAppUrl()).origin;
}

/**
 * Normalise a client-supplied post-login return target to a safe relative path.
 * Only same-origin relative paths are honored; everything else (absolute URLs,
 * protocol-relative `//evil`, backslash tricks) falls back to {@link DEFAULT_RETURN_PATH}.
 */
export function sanitizeReturnPath(raw: string | undefined): string {
  if (!raw) return DEFAULT_RETURN_PATH;

  // Must be a root-relative path; reject protocol-relative and scheme-bearing values.
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) {
    return DEFAULT_RETURN_PATH;
  }
  // Reject embedded scheme/backslash that some browsers normalise oddly.
  if (raw.includes("\\") || /^\/+[a-z][a-z0-9+.-]*:/i.test(raw)) {
    return DEFAULT_RETURN_PATH;
  }
  return raw;
}
