/**
 * CSRF exemption configuration.
 *
 * Exported so that tests can import the production list directly and verify
 * against it — preventing drift between test assumptions and production behaviour.
 */

/**
 * Exact URL paths that are exempt from CSRF validation.
 * These are public unauthenticated mutation endpoints where the caller
 * cannot feasibly obtain a CSRF token first (e.g. the login endpoint).
 */
export const CSRF_EXEMPT_ROUTES = new Set([
  "/auth/login",
  "/auth/refresh",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/2fa/login",
  "/register-with-invite",
  "/health",
  "/csrf-token",
]);

/**
 * Dynamic URL patterns exempt from CSRF.
 * Each function returns `true` if the URL matches the pattern.
 */
export const CSRF_EXEMPT_DYNAMIC: Array<(url: string) => boolean> = [
  // POST /shares/:shareId/access
  (url) => url.startsWith("/shares/") && url.endsWith("/access"),
  // POST /shares/alias/:alias/access
  (url) => url.startsWith("/shares/alias/") && url.endsWith("/access"),
  // POST /reverse-shares/alias/:alias/* (public upload flow)
  (url) => url.startsWith("/reverse-shares/alias/"),
  // POST /reverse-shares/:id/presigned-url
  (url) => url.startsWith("/reverse-shares/") && url.endsWith("/presigned-url"),
  // POST /reverse-shares/:id/register-file
  (url) => url.startsWith("/reverse-shares/") && url.endsWith("/register-file"),
  // POST /reverse-shares/:id/check-password
  (url) => url.startsWith("/reverse-shares/") && url.endsWith("/check-password"),
  // POST /reverse-shares/:id/upload/access (anonymous upload to password-protected reverse share)
  (url) => url.startsWith("/reverse-shares/") && url.endsWith("/upload/access"),
];
