/**
 * Shared authentication constants.
 *
 * Centralised here to prevent typos and drift between the login handler,
 * the refresh endpoint, the logout handler, and the OIDC callback.
 */

/** Name of the httpOnly refresh-token cookie used for token rotation. */
export const REFRESH_TOKEN_COOKIE_NAME = "refresh_token";

/**
 * Path scope for the refresh-token cookie.
 *
 * The browser only sends this cookie to the refresh endpoint, preventing
 * inadvertent exposure on other API calls.
 *
 * PROXY CONTRACT (A1-14): cookie `path` attributes are matched by the BROWSER
 * against the BROWSER-facing URL, which is always prefixed with `/api`. The web
 * layer (Edge Middleware in dev, Traefik in prod) rewrites `/api/*` → the
 * server's un-prefixed `/*`, so the Fastify route is registered at
 * `/auth/refresh` while the cookie is correctly scoped to the browser path
 * `/api/auth/refresh`. The mismatch is intentional and load-bearing: it confines
 * the cookie to exactly the one endpoint that needs it. If the `/api` proxy
 * prefix ever changes, THIS constant must change with it (and stay in sync with
 * `TRUSTED_DEVICE_COOKIE_PATH` below, which follows the same rule). The
 * server-relative `CSRF_EXEMPT_ROUTES` entry (`/auth/refresh`) is the un-proxied
 * form — they describe the same endpoint from the two sides of the proxy.
 */
export const REFRESH_TOKEN_COOKIE_PATH = "/api/auth/refresh";

/** TTL for the refresh-token cookie (7 days, in seconds). */
export const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60;

/**
 * Trusted-device cookie.
 *
 * Holds a random, server-issued device secret. Trust is keyed on a hash of this
 * secret (per user), NOT on any spoofable client field (UA/IP). The cookie is
 * httpOnly + scoped to the auth path, so it is only sent to the auth endpoints.
 */
export const TRUSTED_DEVICE_COOKIE_NAME = "td_secret";

/** Path scope for the trusted-device cookie — sent only to auth routes. */
export const TRUSTED_DEVICE_COOKIE_PATH = "/api/auth";

/** TTL for the trusted-device cookie (30 days, in seconds) — matches the DB record. */
export const TRUSTED_DEVICE_MAX_AGE = 30 * 24 * 60 * 60;

/** Trusted-device record/cookie lifetime in days. */
export const TRUSTED_DEVICE_TTL_DAYS = 30;
