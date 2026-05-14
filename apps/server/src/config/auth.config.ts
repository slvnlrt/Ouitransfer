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
 */
export const REFRESH_TOKEN_COOKIE_PATH = "/api/auth/refresh";

/** TTL for the refresh-token cookie (7 days, in seconds). */
export const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60;
