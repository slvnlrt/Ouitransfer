import axios from "axios";

const apiInstance = axios.create({
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true,
  timeout: 120000, // 2 minutes timeout for API calls
});

// ── 401 Response Interceptor ──────────────────────────────────
// Redirects to /login on unauthorized responses.
// Skips redirect for auth endpoints (which may legitimately return 401)
// and for pages that don't require authentication.

const PUBLIC_PATHS = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/register-with-invite",
  "/s/",
  "/r/",
];
const AUTH_API_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/request-password-reset",
  "/api/auth/reset-password",
];

let isRedirecting = false;

apiInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      typeof window !== "undefined" &&
      !isRedirecting
    ) {
      const requestUrl = error.config?.url ?? "";
      const currentPath = window.location.pathname;

      const isAuthEndpoint = AUTH_API_PREFIXES.some((prefix) => requestUrl.startsWith(prefix));
      const isPublicPage = PUBLIC_PATHS.some((path) => currentPath.startsWith(path));

      if (!isAuthEndpoint && !isPublicPage) {
        isRedirecting = true;
        // Hard navigation clears all React state (QueryClient cache, contexts, etc.)
        window.location.href = "/login";
      }
    }

    return Promise.reject(error);
  },
);

export default apiInstance;
