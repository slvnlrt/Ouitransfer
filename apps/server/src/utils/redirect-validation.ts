import { env } from "../env.js";

/**
 * Well-known OAuth provider hostnames.
 * Extended at runtime by OAUTH_ALLOWED_REDIRECT_HOSTS env var
 * for custom OIDC providers (e.g. Keycloak, Auth0).
 */
const BUILTIN_OAUTH_HOSTS = new Set([
  "accounts.google.com",
  "github.com",
  "gitlab.com",
  "login.microsoftonline.com",
  "discord.com",
  "accounts.spotify.com",
]);

let _allowedRedirectHosts: Set<string> | null = null;

function getAllowedRedirectHosts(): Set<string> {
  if (_allowedRedirectHosts !== null) {
    return _allowedRedirectHosts;
  }

  const hosts = new Set(BUILTIN_OAUTH_HOSTS);
  const envHosts = env.OAUTH_ALLOWED_REDIRECT_HOSTS;
  if (envHosts) {
    for (const h of envHosts.split(",")) {
      const trimmed = h.trim().toLowerCase();
      if (trimmed) hosts.add(trimmed);
    }
  }
  _allowedRedirectHosts = hosts;
  return hosts;
}

/**
 * Reset the cached allowed-redirect-hosts Set (primarily for unit testing environment stubbing).
 */
export function __resetAllowedRedirectHostsForTest(): void {
  _allowedRedirectHosts = null;
}

/**
 * Validate that a redirect URL is safe:
 * - Relative URLs (starting with "/" but not "//") are always allowed
 * - Same-origin URLs are allowed
 * - Known OAuth provider hostnames are allowed
 * - Everything else is blocked
 */
export function isAllowedRedirectUrl(location: string, requestUrl: string): boolean {
  // Relative URLs are safe (same-origin implied by browser)
  if (location.startsWith("/") && !location.startsWith("//")) {
    return true;
  }

  try {
    const locationUrl = new URL(location);
    const reqUrl = new URL(requestUrl);

    // Same-origin check
    if (locationUrl.origin === reqUrl.origin) {
      return true;
    }

    // Known OAuth provider
    const allowedHosts = getAllowedRedirectHosts();
    if (allowedHosts.has(locationUrl.hostname.toLowerCase())) {
      return true;
    }

    return false;
  } catch {
    return false; // Malformed URL
  }
}
