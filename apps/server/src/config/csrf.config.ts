/**
 * CSRF exemption configuration.
 *
 * The PRIMARY mechanism for CSRF exemption is per-route config:
 *   `config: { csrfExempt: true }` on the route definition.
 * This co-locates the exemption with the route and is type-safe.
 *
 * The CSRF_EXEMPT_ROUTES set below is a FALLBACK safety net — it catches
 * requests even if a route registration is missing or misconfigured.
 *
 * Exported so that tests can import the production list directly and verify
 * against it — preventing drift between test assumptions and production behaviour.
 */

/**
 * Exact URL paths that are exempt from CSRF validation (fallback safety net).
 *
 * All routes listed here SHOULD also have `config: { csrfExempt: true }` on
 * their route definition. This set exists as defense-in-depth — if a route
 * is accidentally registered without the config flag, the fallback still
 * prevents CSRF enforcement on public unauthenticated endpoints.
 *
 * @deprecated for NEW routes — use `config: { csrfExempt: true }` on the
 * route definition instead of adding entries here. This set is maintained
 * for backward compatibility and defense-in-depth.
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
