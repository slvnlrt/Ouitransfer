/**
 * Proxy route configuration — maps frontend API paths to backend endpoints.
 *
 * Replaces 110 individual proxy route files with a single declarative config.
 * Routes are matched top-to-bottom: more specific patterns (static segments)
 * must appear before less specific (dynamic :param segments) at the same depth.
 */

export interface RouteConfig {
  /** Frontend path pattern without /api/ prefix. Use :param for dynamic segments. */
  path: string;
  /** HTTP method */
  method: string;
  /** Backend path pattern. Use :param matching the frontend pattern. */
  backendPath: string;

  // ── Request options ──
  /** Request body handling: "raw" for FormData, "duplex" for streaming upload */
  body?: "raw" | "duplex";
  /** Transform request body before forwarding */
  bodyTransform?: (text: string) => string;
  /** Set false to skip cookie forwarding (default: true) */
  cookie?: false;
  /** Forward Authorization header */
  auth?: true;
  /** Add X-Real-IP and X-User-Agent via getClientHeaders() */
  clientHeaders?: true;
  /** Forward x-forwarded-host and x-forwarded-proto */
  forwardedHost?: true;
  /** Forward additional request headers matching these prefixes */
  extraHeaders?: string[];
  /** Forward query string to backend */
  query?: true;

  // ── Response options ──
  /** Stream response body (file downloads) */
  stream?: true;
  /** Forward all response headers from backend */
  allResponseHeaders?: true;

  // ── Special behavior ──
  /** Handle 3xx redirects (OAuth flows) */
  redirect?: true;
  /** AbortController timeout in ms */
  timeout?: number;
  /** Check backend /health before request */
  healthCheck?: true;
  /** Return 410 Gone */
  deprecated?: true;
}

// ── Body transform helpers ──

const wrapFiles = (text: string): string => {
  const data = JSON.parse(text);
  if (!Array.isArray(data.files)) {
    throw new Error("Request body must contain a 'files' array");
  }
  return JSON.stringify({ files: data.files, folders: [] });
};

const wrapFolders = (text: string): string => {
  const data = JSON.parse(text);
  if (!Array.isArray(data.folders)) {
    throw new Error("Request body must contain a 'folders' array");
  }
  return JSON.stringify({ files: [], folders: data.folders });
};

// ── Helper ──

type Opts = Partial<Omit<RouteConfig, "path" | "method" | "backendPath">>;

function r(method: string, path: string, backendPath: string, opts?: Opts): RouteConfig {
  return { path, method, backendPath, ...opts };
}

// ── Route table ──
// Organized by domain. Within each domain, routes are ordered by segment count
// (descending) then by specificity (static segments before dynamic).

export const routes: RouteConfig[] = [
  // ═══════════════════════════════════════════════════════════════
  // ADMIN
  // ═══════════════════════════════════════════════════════════════
  r("GET", "admin/audit-logs", "/admin/audit-logs", { query: true }),
  r("GET", "admin/stats", "/admin/stats"),

  // LDAP
  r("GET", "admin/ldap/config", "/admin/ldap/config"),
  r("PUT", "admin/ldap/config", "/admin/ldap/config"),
  r("POST", "admin/ldap/test", "/admin/ldap/test"),
  r("POST", "admin/ldap/sync", "/admin/ldap/sync"),
  r("GET", "admin/ldap/sync/logs/:id", "/admin/ldap/sync/logs/:id"),
  r("GET", "admin/ldap/sync/logs", "/admin/ldap/sync/logs", { query: true }),
  r("GET", "admin/ldap/status", "/admin/ldap/status"),

  // ═══════════════════════════════════════════════════════════════
  // APP
  // ═══════════════════════════════════════════════════════════════
  r("GET", "app/configs/public", "/app/configs/public"),
  r("GET", "app/check-upload", "/storage/check-upload", { query: true }),
  r("GET", "app/configs", "/app/configs"),
  r("GET", "app/disk-space", "/storage/disk-space"),
  r("GET", "app/health", "/health"),
  r("GET", "app/health-status", "/health/status"),
  r("GET", "app/info", "/app/info"),
  r("DELETE", "app/remove-logo", "/app/logo"),
  r("GET", "app/system-info", "/app/system-info"),
  r("POST", "app/test-smtp", "/app/test-smtp"),
  r("POST", "app/upload-logo", "/app/logo", { body: "raw" }),

  // ═══════════════════════════════════════════════════════════════
  // BACKGROUND IMAGES
  // NOTE: POST uses /upload suffix to disambiguate from GET on collection.
  // Full-size images are served via presigned URLs in the list response (fullUrl field).
  // ═══════════════════════════════════════════════════════════════
  r("GET", "background-images", "/background-images"),
  r("POST", "background-images/upload", "/background-images", { body: "raw" }),
  r("PATCH", "background-images/order", "/background-images/order"),
  r("PATCH", "background-images/:id", "/background-images/:id"),
  r("DELETE", "background-images/:id", "/background-images/:id"),

  // ═══════════════════════════════════════════════════════════════
  // CSRF
  // ═══════════════════════════════════════════════════════════════
  r("GET", "csrf-token", "/csrf-token"),

  // ═══════════════════════════════════════════════════════════════
  // AUTH — 2FA
  // ═══════════════════════════════════════════════════════════════
  r("POST", "auth/2fa/backup-codes", "/auth/2fa/backup-codes", { auth: true }),
  r("POST", "auth/2fa/disable", "/auth/2fa/disable", { auth: true }),
  r("POST", "auth/2fa/login", "/auth/2fa/login", { cookie: false, clientHeaders: true }),
  r("POST", "auth/2fa/setup", "/auth/2fa/setup", { auth: true }),
  r("GET", "auth/2fa/status", "/auth/2fa/status", { auth: true }),
  r("POST", "auth/2fa/verify-setup", "/auth/2fa/verify-setup", { auth: true }),
  r("POST", "auth/2fa/verify", "/auth/2fa/verify", { auth: true }),

  // ═══════════════════════════════════════════════════════════════
  // AUTH — Core
  // ═══════════════════════════════════════════════════════════════
  r("GET", "auth/config", "/auth/config", { cookie: false, allResponseHeaders: true }),
  r("POST", "auth/forgot-password", "/auth/forgot-password", { cookie: false }),
  r("POST", "auth/login", "/auth/login", { cookie: false, clientHeaders: true }),
  r("POST", "auth/logout", "/auth/logout"),
  r("GET", "auth/me", "/auth/me"),
  r("POST", "auth/refresh", "/auth/refresh", { clientHeaders: true }),
  r("POST", "auth/reset-password", "/auth/reset-password", { cookie: false }),

  // ═══════════════════════════════════════════════════════════════
  // AUTH — Providers (static before dynamic at same depth)
  // ═══════════════════════════════════════════════════════════════
  // 4-seg: manage/:id (static "manage" at [2]) before :provider/* (dynamic at [2])
  r("PUT", "auth/providers/manage/:id", "/auth/providers/:id", { auth: true }),
  r("DELETE", "auth/providers/manage/:id", "/auth/providers/:id", { auth: true }),
  r("GET", "auth/providers/:provider/authorize", "/auth/providers/:provider/authorize", {
    cookie: false,
    forwardedHost: true,
    query: true,
    redirect: true,
  }),
  r("GET", "auth/providers/:provider/callback", "/auth/providers/:provider/callback", {
    cookie: false,
    forwardedHost: true,
    query: true,
    redirect: true,
  }),
  // 3-seg: static
  r("GET", "auth/providers/all", "/auth/providers/all", { auth: true }),
  r("PUT", "auth/providers/order", "/auth/providers/order", { auth: true }),
  // 2-seg
  r("GET", "auth/providers", "/auth/providers", {
    cookie: false,
    forwardedHost: true,
    query: true,
  }),
  r("POST", "auth/providers", "/auth/providers", { auth: true }),

  // ═══════════════════════════════════════════════════════════════
  // AUTH — Trusted Devices
  // ═══════════════════════════════════════════════════════════════
  r("DELETE", "auth/trusted-devices/:id", "/auth/trusted-devices/:id", {
    auth: true,
    clientHeaders: true,
  }),
  r("GET", "auth/trusted-devices", "/auth/trusted-devices", { auth: true, clientHeaders: true }),
  r("DELETE", "auth/trusted-devices", "/auth/trusted-devices", { auth: true, clientHeaders: true }),

  // ═══════════════════════════════════════════════════════════════
  // CONFIG
  // ═══════════════════════════════════════════════════════════════
  r("PATCH", "config/update/bulk", "/app/configs"),
  r("PATCH", "config/update/:key", "/app/configs/:key"),
  r("GET", "config/list", "", { deprecated: true }),

  // ═══════════════════════════════════════════════════════════════
  // FILES (static 2-seg routes before dynamic files/:id)
  // ═══════════════════════════════════════════════════════════════
  // 3-seg
  r("POST", "files/multipart/abort", "/files/multipart/abort"),
  r("POST", "files/multipart/complete", "/files/multipart/complete"),
  r("POST", "files/multipart/create", "/files/multipart/create"),
  r("GET", "files/multipart/list-parts", "/files/multipart/list-parts", { query: true }),
  r("GET", "files/multipart/part-url", "/files/multipart/part-url", { query: true }),
  r("PUT", "files/:id/move", "/files/:id/move"),
  // 2-seg static (before dynamic files/:id)
  r("POST", "files/check", "/files/check"),
  r("POST", "files/download-url", "/files/download-url"),
  r("POST", "files/download", "/files/download", {
    stream: true,
    auth: true,
    extraHeaders: ["x-forwarded", "user-agent", "accept"],
  }),
  r("POST", "files/embed-token", "/files/embed-token"),
  r("GET", "files/presigned-url", "/files/presigned-url", { query: true }),
  r("POST", "files/upload", "/files/upload", {
    body: "duplex",
    query: true,
    auth: true,
    extraHeaders: ["x-forwarded", "user-agent", "accept"],
  }),
  r("PUT", "files/upload", "/files/upload", {
    body: "duplex",
    query: true,
    auth: true,
    extraHeaders: ["x-forwarded", "user-agent", "accept"],
  }),
  // 2-seg dynamic
  r("PATCH", "files/:id", "/files/:id"),
  r("DELETE", "files/:id", "/files/:id"),
  // 1-seg
  r("GET", "files", "/files", { query: true }),
  r("POST", "files", "/files"),

  // ═══════════════════════════════════════════════════════════════
  // FOLDERS
  // ═══════════════════════════════════════════════════════════════
  r("GET", "folders/:id/contents", "/folders/:id/contents"),
  r("GET", "folders/:id/files", "/folders/:id/files"),
  r("PUT", "folders/:id/move", "/folders/:id/move"),
  r("GET", "folders/:id", "/folders/:id"),
  r("PATCH", "folders/:id", "/folders/:id"),
  r("DELETE", "folders/:id", "/folders/:id"),
  r("GET", "folders", "/folders", { query: true }),
  r("POST", "folders", "/folders"),

  // ═══════════════════════════════════════════════════════════════
  // INVITE TOKENS
  // ═══════════════════════════════════════════════════════════════
  r("GET", "invite-tokens/:token", "/invite-tokens/:token", { cookie: false }),
  r("POST", "invite-tokens", "/invite-tokens"),

  // ═══════════════════════════════════════════════════════════════
  // REGISTER WITH INVITE
  // ═══════════════════════════════════════════════════════════════
  r("POST", "register-with-invite", "/register-with-invite", { cookie: false }),

  // ═══════════════════════════════════════════════════════════════
  // REVERSE SHARES — Alias multipart (5-seg)
  // ═══════════════════════════════════════════════════════════════
  r(
    "POST",
    "reverse-shares/alias/:alias/multipart/abort",
    "/reverse-shares/alias/:alias/multipart/abort",
    {
      cookie: false,
    },
  ),
  r(
    "POST",
    "reverse-shares/alias/:alias/multipart/complete",
    "/reverse-shares/alias/:alias/multipart/complete",
    { cookie: false },
  ),
  r(
    "POST",
    "reverse-shares/alias/:alias/multipart/create",
    "/reverse-shares/alias/:alias/multipart/create",
    { cookie: false },
  ),
  r(
    "POST",
    "reverse-shares/alias/:alias/multipart/list-parts",
    "/reverse-shares/alias/:alias/multipart/list-parts",
    { cookie: false },
  ),
  r(
    "POST",
    "reverse-shares/alias/:alias/multipart/part-url",
    "/reverse-shares/alias/:alias/multipart/part-url",
    { cookie: false },
  ),
  r(
    "POST",
    "reverse-shares/alias/:alias/upload/access",
    "/reverse-shares/alias/:alias/upload/access",
    {
      cookie: false,
    },
  ),

  // ═══════════════════════════════════════════════════════════════
  // REVERSE SHARES — Files (4-seg static before dynamic at [2])
  // ═══════════════════════════════════════════════════════════════
  r("DELETE", "reverse-shares/files/delete/:fileId", "/reverse-shares/files/:fileId"),
  r("GET", "reverse-shares/files/download/:fileId", "/reverse-shares/files/:fileId/download", {
    stream: true,
  }),
  r("POST", "reverse-shares/files/:fileId/copy", "/reverse-shares/files/:fileId/copy", {
    healthCheck: true,
    timeout: 600_000,
  }),

  // ═══════════════════════════════════════════════════════════════
  // REVERSE SHARES — Alias (4-seg)
  // ═══════════════════════════════════════════════════════════════
  r(
    "POST",
    "reverse-shares/alias/:alias/presigned-url",
    "/reverse-shares/alias/:alias/presigned-url",
    {
      cookie: false,
    },
  ),
  r(
    "POST",
    "reverse-shares/alias/:alias/register-file",
    "/reverse-shares/alias/:alias/register-file",
    {
      cookie: false,
    },
  ),
  r("GET", "reverse-shares/alias/:alias/upload", "/reverse-shares/alias/:alias/upload", {
    cookie: false,
  }),

  // ═══════════════════════════════════════════════════════════════
  // REVERSE SHARES — Upload by ID (4-seg)
  // ═══════════════════════════════════════════════════════════════
  r("POST", "reverse-shares/upload/:id/access", "/reverse-shares/:id/upload/access", {
    cookie: false,
  }),

  // ═══════════════════════════════════════════════════════════════
  // REVERSE SHARES — 3-seg (static [1] before dynamic :reverseShareId)
  // ═══════════════════════════════════════════════════════════════
  r("PATCH", "reverse-shares/activate/:id", "/reverse-shares/:id/activate"),
  r("POST", "reverse-shares/check-password/:id", "/reverse-shares/:id/check-password", {
    cookie: false,
  }),
  r("PATCH", "reverse-shares/deactivate/:id", "/reverse-shares/:id/deactivate"),
  r("DELETE", "reverse-shares/delete/:id", "/reverse-shares/:id"),
  r("GET", "reverse-shares/details/:id", "/reverse-shares/:id"),
  r("PUT", "reverse-shares/files/:fileId", "/reverse-shares/files/:fileId"),
  r("DELETE", "reverse-shares/files/:fileId", "/reverse-shares/files/:fileId"),
  r("PUT", "reverse-shares/password/:id", "/reverse-shares/:id/password"),
  r("POST", "reverse-shares/presigned-url/:id", "/reverse-shares/:id/presigned-url", {
    cookie: false,
  }),
  r("POST", "reverse-shares/register-upload/:id", "/reverse-shares/:id/register-file", {
    cookie: false,
  }),
  r("GET", "reverse-shares/upload/:id", "/reverse-shares/:id/upload", { cookie: false }),
  // Dynamic at [1] — must be last among 3-seg reverse-shares routes
  r("POST", "reverse-shares/:reverseShareId/alias", "/reverse-shares/:reverseShareId/alias"),

  // ═══════════════════════════════════════════════════════════════
  // REVERSE SHARES — 2-seg
  // ═══════════════════════════════════════════════════════════════
  r("POST", "reverse-shares/create", "/reverse-shares"),
  r("GET", "reverse-shares/list", "/reverse-shares"),
  r("PUT", "reverse-shares/update", "/reverse-shares"),

  // ═══════════════════════════════════════════════════════════════
  // SHARES — 4-seg (static [2] before dynamic where applicable)
  // ═══════════════════════════════════════════════════════════════
  r("POST", "shares/alias/create/:shareId", "/shares/:shareId/alias"),
  r("GET", "shares/alias/get/:alias", "/shares/alias/:alias", { cookie: false }),
  r("POST", "shares/alias/:alias/access", "/shares/alias/:alias/access", { cookie: false }),
  r("POST", "shares/files/add/:shareId", "/shares/:shareId/items", { bodyTransform: wrapFiles }),
  r("DELETE", "shares/files/remove/:shareId", "/shares/:shareId/items", {
    bodyTransform: wrapFiles,
  }),
  r("POST", "shares/folders/add/:shareId", "/shares/:shareId/items", {
    bodyTransform: wrapFolders,
  }),
  r("DELETE", "shares/folders/remove/:shareId", "/shares/:shareId/items", {
    bodyTransform: wrapFolders,
  }),
  r("PATCH", "shares/password/update/:shareId", "/shares/:shareId/password"),
  r("POST", "shares/recipients/add/:shareId", "/shares/:shareId/recipients"),
  r("POST", "shares/recipients/notify/:shareId", "/shares/:shareId/notify"),
  r("DELETE", "shares/recipients/remove/:shareId", "/shares/:shareId/recipients"),

  // ═══════════════════════════════════════════════════════════════
  // SHARES — 3-seg (static [1] before dynamic :shareId)
  // ═══════════════════════════════════════════════════════════════
  r("DELETE", "shares/delete/:id", "/shares/:id"),
  r("GET", "shares/details/:shareId", "/shares/:shareId", { cookie: false }),
  r("POST", "shares/:shareId/access", "/shares/:shareId/access", { cookie: false }),

  // ═══════════════════════════════════════════════════════════════
  // SHARES — 2-seg
  // ═══════════════════════════════════════════════════════════════
  r("POST", "shares/create", "/shares"),
  r("GET", "shares/list", "/shares/me"),
  r("PUT", "shares/update", "/shares"),

  // ═══════════════════════════════════════════════════════════════
  // GROUPS (4-seg before 3-seg before 2-seg)
  // ═══════════════════════════════════════════════════════════════
  r("POST", "groups/:id/members/add", "/groups/:id/members"),
  r("DELETE", "groups/:id/members/remove/:userId", "/groups/:id/members/:userId"),
  r("GET", "groups/details/:id", "/groups/:id"),
  r("PUT", "groups/update/:id", "/groups/:id"),
  r("DELETE", "groups/delete/:id", "/groups/:id"),
  r("POST", "groups/create", "/groups"),
  r("GET", "groups/list", "/groups"),

  // ═══════════════════════════════════════════════════════════════
  // USERS (static 2-seg before dynamic users/:id if any)
  // ═══════════════════════════════════════════════════════════════
  r("POST", "users/avatar/upload", "/users/avatar", { body: "raw" }),
  r("DELETE", "users/avatar/remove", "/users/avatar"),
  r("GET", "users/quota/:id", "/users/:id/quota"),
  r("PATCH", "users/quota/:id", "/users/:id/quota"),
  r("PATCH", "users/activate/:id", "/users/:id/activate"),
  r("PATCH", "users/deactivate/:id", "/users/:id/deactivate"),
  r("DELETE", "users/delete/:id", "/users/:id"),
  r("GET", "users/details/:id", "/users/:id", { query: true }),
  r("GET", "users/list", "/users", { query: true }),
  r("POST", "users/register", "/auth/register"),
  r("PUT", "users/update", "/users"),
];
