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

// ── Refresh Token Management ──────────────────────────────────
// Stored in memory only (not localStorage — XSS risk).
// Set on login, cleared on logout / failed refresh.
let refreshTokenValue: string | null = null;

export function setRefreshToken(token: string | null): void {
  refreshTokenValue = token;
}

export function getRefreshToken(): string | null {
  return refreshTokenValue;
}

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
    // Use the raw axios instance to avoid infinite interceptor loops
    const res = await axios.get("/api/csrf-token", { withCredentials: true });
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
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
];

let isRedirecting = false;

/** Safety timeout to reset the redirect guard if navigation is somehow prevented. */
const REDIRECT_SAFETY_TIMEOUT_MS = 5000;

/**
 * Attempt to refresh the access token using the stored refresh token.
 * Returns true if refresh succeeded, false otherwise.
 *
 * The refresh token may come from:
 * 1. In-memory `refreshTokenValue` (set after password-based login)
 * 2. An httpOnly `refresh_token` cookie (set by OIDC callback)
 *
 * For case 2, the cookie is sent automatically by the browser — we still
 * send the body field if available so the server checks both sources.
 */
async function attemptTokenRefresh(): Promise<boolean> {
  try {
    // Use raw axios to avoid interceptor loops.
    // Send the in-memory token in the body if available; for OIDC users
    // the httpOnly cookie will be sent automatically via withCredentials.
    const body: Record<string, string> = {};
    if (refreshTokenValue) {
      body.refreshToken = refreshTokenValue;
    }

    const res = await axios.post("/api/auth/refresh", body, { withCredentials: true });
    const newRefreshToken = res.data?.refreshToken;
    if (newRefreshToken) {
      refreshTokenValue = newRefreshToken;
      return true;
    }
    return false;
  } catch {
    // Refresh failed — clear the stored token
    refreshTokenValue = null;
    return false;
  }
}

/** Mutex to prevent concurrent refresh attempts */
let refreshPromise: Promise<boolean> | null = null;

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

          const success = await refreshPromise;
          if (success) {
            // Retry the original request — the new cookie is set by the refresh endpoint
            return apiInstance(originalRequest);
          }

          // Refresh failed — redirect to login (re-check isRedirecting after async gap)
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
