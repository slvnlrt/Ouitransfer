import axios from "axios";

import { matchesPath } from "@/components/auth/paths/match-path";
import { publicPaths } from "@/components/auth/paths/public-paths";

const apiInstance = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
  timeout: 120000, // 2 minutes timeout for API calls
});

/**
 * Timeout for the raw-axios auth helpers (CSRF fetch, token refresh).
 *
 * These calls bypass `apiInstance` (to avoid interceptor loops) and therefore
 * do NOT inherit its 120s timeout — raw axios defaults to no timeout at all.
 * Without a bound, a request made on a dead keep-alive socket (e.g. after the
 * tab was backgrounded across a network change or laptop sleep) never settles,
 * leaving `csrfFetchPromise` / `refreshPromise` pending forever. Every request
 * awaiting them then hangs, wedging the whole UI on the loading screen until a
 * manual reload resets module state. A finite timeout guarantees they settle.
 */
const AUTH_REQUEST_TIMEOUT_MS = 30000;

// ── CSRF Token Management ─────────────────────────────────────
// The server uses double-submit cookie CSRF protection:
// 1. GET /api/csrf-token → sets httpOnly _csrf cookie + returns { token }
// 2. Frontend stores token in memory (not cookie — the cookie is the secret)
// 3. On state-changing requests, sends token as X-CSRF-Token header
// 4. Server validates header token against cookie secret

let csrfToken: string | null = null;
let csrfFetchPromise: Promise<string | null> | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  // SSR guard — CSRF tokens are browser-only
  if (typeof window === "undefined") return null;

  try {
    // Use the raw axios instance to avoid infinite interceptor loops.
    // Bound with an explicit timeout — raw axios has none by default.
    const res = await axios.get("/api/csrf-token", {
      withCredentials: true,
      timeout: AUTH_REQUEST_TIMEOUT_MS,
    });
    csrfToken = res.data.token;
    return csrfToken;
  } catch {
    return null;
  }
}

async function getCsrfToken(): Promise<string | null> {
  if (csrfToken) return csrfToken;
  // Deduplicate concurrent fetches
  if (!csrfFetchPromise) {
    csrfFetchPromise = fetchCsrfToken().finally(() => {
      csrfFetchPromise = null;
    });
  }
  return csrfFetchPromise;
}

// Attach X-CSRF-Token to state-changing requests
apiInstance.interceptors.request.use(async (config) => {
  // SSR guard
  if (typeof window === "undefined") return config;

  const method = config.method?.toUpperCase() ?? "";
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    const token = await getCsrfToken();
    if (token) {
      config.headers["X-CSRF-Token"] = token;
    }
  }
  return config;
});

// ── 401 Response Interceptor ──────────────────────────────────
// On 401: attempts a token refresh first, then redirects to /login if refresh fails.
// Skips redirect for auth endpoints (which may legitimately return 401)
// and for pages that don't require authentication.

const AUTH_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
];

let isRedirecting = false;

/** Safety timeout to reset the redirect guard if navigation is somehow prevented. */
const REDIRECT_SAFETY_TIMEOUT_MS = 5000;

/**
 * Outcome of a token-refresh attempt:
 * - `success`: the server issued a new access token.
 * - `auth_failed`: the server rejected the refresh (expired/invalid refresh
 *   token) — the session is genuinely over, so we redirect to login.
 * - `network_error`: no response (network failure or timeout) — a *transient*
 *   condition. We must NOT log the user out; we settle the original request so
 *   it can fail/retry normally instead of hanging forever.
 */
type RefreshOutcome = "success" | "auth_failed" | "network_error";

/**
 * Attempt to refresh the access token using the httpOnly refresh_token cookie.
 *
 * Both password login and OIDC login set the refresh token as an httpOnly cookie,
 * which is sent automatically by the browser via withCredentials.
 */
async function attemptTokenRefresh(): Promise<RefreshOutcome> {
  try {
    // Use raw axios to avoid interceptor loops.
    // The httpOnly refresh_token cookie is sent automatically.
    // Bound with an explicit timeout — raw axios has none by default.
    await axios.post(
      "/api/auth/refresh",
      {},
      { withCredentials: true, timeout: AUTH_REQUEST_TIMEOUT_MS },
    );
    return "success";
  } catch (err) {
    // A response means the server actively rejected the refresh (real auth
    // failure). No response means a network/timeout error (transient).
    if (axios.isAxiosError(err) && !err.response) {
      return "network_error";
    }
    return "auth_failed";
  }
}

/** Mutex to prevent concurrent refresh attempts */
let refreshPromise: Promise<RefreshOutcome> | null = null;

apiInstance.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (axios.isAxiosError(error) && typeof window !== "undefined") {
      const status = error.response?.status;

      // Clear cached CSRF token on 403 only if the error is CSRF-specific.
      // Generic 403s (admin gate, permission denied) must not flush the token.
      if (status === 403) {
        const msg =
          (error.response?.data as Record<string, unknown>)?.message ??
          (error.response?.data as Record<string, unknown>)?.error ??
          "";
        if (typeof msg === "string" && (msg.includes("csrf") || msg.includes("CSRF"))) {
          csrfToken = null;
        }
      }

      // Handle 401 — attempt refresh before redirecting
      if (status === 401) {
        const originalRequest = error.config;
        const requestUrl = originalRequest?.url ?? "";
        const currentPath = window.location.pathname;

        const isAuthEndpoint = AUTH_API_PREFIXES.some((prefix) => requestUrl.startsWith(prefix));
        const isRefreshEndpoint = requestUrl.includes("/auth/refresh");
        const isPublicPage = matchesPath(currentPath, publicPaths);

        // Don't attempt refresh for auth endpoints, the refresh endpoint itself, or public pages
        if (
          !isAuthEndpoint &&
          !isRefreshEndpoint &&
          !isPublicPage &&
          originalRequest &&
          !(originalRequest as unknown as Record<string, unknown>)._retry
        ) {
          (originalRequest as unknown as Record<string, unknown>)._retry = true;

          // Use mutex to prevent concurrent refresh attempts
          if (!refreshPromise) {
            refreshPromise = attemptTokenRefresh().finally(() => {
              refreshPromise = null;
            });
          }

          const outcome = await refreshPromise;
          if (outcome === "success") {
            // Retry the original request — the new cookie is set by the refresh endpoint
            return apiInstance(originalRequest);
          }

          if (outcome === "network_error") {
            // Transient failure — do NOT log the user out. Settling the original
            // error lets React Query keep any cached data (so a focus-triggered
            // 401 storm doesn't wipe the UI) and retry on the next interaction,
            // instead of leaving the request hanging on the loading screen.
            return Promise.reject(error);
          }

          // Refresh genuinely failed — redirect to login (re-check isRedirecting after async gap)
          if (!isRedirecting) {
            isRedirecting = true;
            setTimeout(() => {
              isRedirecting = false;
            }, REDIRECT_SAFETY_TIMEOUT_MS);
            window.location.href = "/login?reason=session_expired";
          }
        } else if (!isAuthEndpoint && !isRefreshEndpoint && !isPublicPage && !isRedirecting) {
          // Already retried and still 401 — redirect
          isRedirecting = true;
          setTimeout(() => {
            isRedirecting = false;
          }, REDIRECT_SAFETY_TIMEOUT_MS);
          window.location.href = "/login?reason=session_expired";
        }
      }
    }

    return Promise.reject(error);
  },
);

export default apiInstance;

// ── Test-only exports (tree-shaken in production) ─────────────
export { AUTH_API_PREFIXES, REDIRECT_SAFETY_TIMEOUT_MS };

/**
 * Reset the module-level `isRedirecting` flag.
 * Only exported for use in tests — guarded to be a no-op in production.
 */
export const __resetRedirectingForTest: () => void =
  process.env.NODE_ENV === "test"
    ? () => {
        isRedirecting = false;
      }
    : () => {};
