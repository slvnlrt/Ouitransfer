# Ouitransfer Remediation — Completed Items

> Tracking file for all completed audit remediation items.
> Each entry includes: item ID, description, files changed, date, and verification status.

---

## Phase 0: Security Emergency

### 0.1 — Re-enable prototype pollution protection
- **Date**: 2026-04-20
- **Files**: `apps/server/src/app.ts`
- **Change**: `onProtoPoisoning: "ignore"` -> `"error"`, `onConstructorPoisoning: "ignore"` -> `"error"`
- **Verified**: PASS

### 0.2 — Set reasonable body limit (50MB)
- **Date**: 2026-04-20
- **Files**: `apps/server/src/app.ts`, `apps/server/src/server.ts`, `apps/server/src/modules/reverse-share/routes.ts`, `apps/web/next.config.ts`
- **Change**: Reduced body/file limits from 1PB to 50MB across all 4 locations
- **Verified**: PASS (note: uploads use S3 presigned URLs, so 50MB only affects API metadata payloads)

### 0.5 — Restrict CORS to known frontend origins
- **Date**: 2026-04-20
- **Files**: `apps/server/src/app.ts`
- **Change**: Replaced `origin: true` with allowlist from `CORS_ORIGINS` env var (defaults to localhost:3000,5487)
- **Verified**: PASS

### 0.6 — Default SECURE_SITE to "true"
- **Date**: 2026-04-20
- **Files**: `apps/server/src/env.ts`, `apps/server/src/server.ts`
- **Change**: Default changed from `"false"` to `"true"`. Startup warning added when `SECURE_SITE=false`
- **Verified**: PASS

### 0.12 — Scope TLS bypass to S3 client only
- **Date**: 2026-04-20
- **Files**: `apps/server/src/config/storage.config.ts`
- **Change**: Removed global `NODE_TLS_REJECT_UNAUTHORIZED=0`. S3 client now uses `NodeHttpHandler` with scoped `rejectUnauthorized` flag
- **Verified**: PASS

### 0.13 — Restrict Next.js image remote patterns
- **Date**: 2026-04-20
- **Files**: `apps/web/next.config.ts`
- **Change**: Replaced `hostname: "**"` wildcards with localhost defaults + `ALLOWED_IMAGE_HOSTS` env var
- **Verified**: PASS

### 0.16 — Enable removeAdditional to strip unknown fields
- **Date**: 2026-04-20
- **Files**: `apps/server/src/app.ts`
- **Change**: `removeAdditional: false` -> `removeAdditional: "all"`
- **Verified**: PASS (note: only affects Ajv-validated routes, not Zod-validated ones)

### 0.3 — Add JWT preValidation to all /s3/* routes
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/s3-storage/routes.ts`, `apps/server/src/modules/s3-storage/controller.ts`
- **Change**: Added JWT preValidation hook to all 4 routes. Controller now validates ownership: upload-url checks objectName prefix `{userId}/`, download-url/delete/exists check DB ownership via `prisma.file.findFirst`
- **Verified**: PASS
- **Follow-up**: Harden prefix check against path traversal (`..`), add `!userId` early-return in getUploadUrl

### 0.7 — Replace exec() with native fs.statfs()
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/storage/service.ts`
- **Change**: Removed `child_process` exec entirely (406→177 lines). Replaced with Node.js native `statfs()`. Removed 5 shell-parsing methods. Also fixed rogue PrismaClient instance → shared singleton
- **Verified**: PASS

### 0.14 — Move auth checks to preValidation hooks
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/file/routes.ts`, `apps/server/src/modules/folder/routes.ts`, `apps/server/src/modules/share/routes.ts`, `apps/server/src/modules/file/controller.ts`, `apps/server/src/modules/folder/controller.ts`, `apps/server/src/modules/share/controller.ts`
- **Change**: Added preValidation to POST /files, POST /folders, DELETE /shares/:id. Removed redundant `await request.jwtVerify()` from corresponding controller methods
- **Verified**: PASS
- **Follow-up**: Other controller methods still have redundant in-handler jwtVerify calls (double verification). Complete migration in a future pass

### 0.15 — Replace z.any() with proper Zod schema on auth provider update
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/auth-providers/routes.ts`
- **Change**: Used existing `UpdateAuthProviderSchema` for PUT /providers/:id body. Defined `AuthProviderResponseSchema` for all admin response schemas. Zero `z.any()` remaining in file
- **Verified**: PASS
- **Follow-up**: Audit whether `clientSecret` should be excluded from admin GET responses to prevent secret leakage

---

## Reviewer Follow-ups (State-of-the-Art Improvements)

> Items identified during review of batches 1 & 2. Not blocking but required for production-grade quality.

### From Batch 1 Review

- [ ] **Audit `request.file()`/`request.files()` callers** — Confirm no route uploads raw file bytes >50MB through Fastify multipart (all large uploads should use S3 presigned URLs)
- [ ] **Compile realistic default ALLOWED_IMAGE_HOSTS** — Current localhost-only default will break images post-deploy. Need Gravatar, OAuth avatar hosts, STORAGE_URL host at minimum
- [ ] **CORS cleanup** — Drop unused `http://localhost:3000` from defaults (no app uses port 3000); add production-mode warning when `CORS_ORIGINS` env var is unset
- [ ] **ALLOWED_IMAGE_HOSTS: support http:// and wildcard subdomains** — Custom-host branch forces HTTPS only. Support `http://host` syntax for dev/LAN setups. Add `*.example.com` wildcard subdomain support. Verify port behavior with Next 15
- [ ] **Fix 7-space indent in `reverse-share/routes.ts:389`** — Minor formatting inconsistency
- [ ] **Add `.strict()` to critical Zod schemas** — `removeAdditional: "all"` only strips via Ajv; Zod routes need `.strict()` on security-critical DTOs (login, auth-providers, etc.)

### From Batch 2 Review

- [ ] **Harden S3 objectName prefix check against path traversal** — `objectName.startsWith(\`${userId}/\`)` accepts `userId/../other-user/file`. Reject `..` segments or normalize with `path.posix.normalize` then re-verify prefix
- [ ] **Add `!userId` early-return in `S3StorageController.getUploadUrl`** — Before the `startsWith` check, for defensive consistency with other S3 methods
- [ ] **Audit `clientSecret` exposure in `AuthProviderResponseSchema`** — Remove or scrub `clientSecret` from admin GET responses. OIDC secrets should never be returned to the client
- [ ] **Complete preValidation migration** — Remove redundant `await request.jwtVerify()` from ALL handlers whose routes already have `preValidation` (currently ~20+ instances of double verification)

---

## Phase 0 Batch 3

### 0.4 — Add token-based auth to /embed endpoint
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/file/embed-token.ts` (NEW), `apps/server/src/modules/file/controller.ts`, `apps/server/src/modules/file/routes.ts`
- **Change**: Replaced raw file ID access with signed JWT embed tokens (jose HS256, 24h TTL). Route changed to `GET /embed/:token`. New `POST /files/embed-token` for token generation (authenticated). Share existence + expiration re-verified at access time
- **Verified**: PASS
- **Breaking**: Existing embed URLs using raw file IDs will stop working
- **Follow-up**: Frontend components need updating to call `POST /files/embed-token`; consider persisting EMBED_SECRET in AppConfig for restart survival; consider re-checking share security (maxViews, password) on embed access

### 0.8 — Install and configure @fastify/rate-limit
- **Date**: 2026-04-20
- **Files**: `apps/server/package.json`, `apps/server/src/app.ts`, `apps/server/src/modules/auth/routes.ts`, `apps/server/src/modules/two-factor/routes.ts`, `apps/server/src/modules/file/routes.ts`, `apps/server/src/modules/s3-storage/routes.ts`
- **Change**: Global 100 req/min/IP. Auth: login 5/min, 2FA 5/min, forgot-password 3/min, reset-password 3/min. Uploads: presigned-url 30/min
- **Verified**: PASS
- **Follow-up**: Consider using `request.ip` alone instead of raw `x-forwarded-for` header string for key generation

### 0.9 — Fix 2FA flow with server-side challenge token
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/auth/challenge.ts` (NEW), `apps/server/src/modules/auth/controller.ts`, `apps/server/src/modules/auth/dto.ts`, `apps/server/src/modules/auth/routes.ts`, `apps/web/src/app/login/hooks/use-login.ts`, `apps/web/src/http/endpoints/auth/two-factor/types.ts`
- **Change**: Login now returns `challengeToken` (signed JWT, 5min TTL) instead of raw `userId`. 2FA completion verifies challenge token server-side before accepting TOTP code. Frontend updated
- **Verified**: PASS

### 0.10 — Generate objectName server-side for reverse-share uploads
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/reverse-share/service.ts`, `apps/server/src/modules/reverse-share/controller.ts`, `apps/server/src/modules/reverse-share/dto.ts`, `apps/server/src/modules/reverse-share/routes.ts`
- **Change**: Client sends `filename`+`extension` instead of `objectName`. Server generates `reverse-shares/{id}/{timestamp}-{uuid}-{sanitized}.{ext}`. Multipart path also fixed (was using alias, now uses reverseShare.id + sanitization + crypto.randomUUID)
- **Verified**: PASS (after multipart fix)
- **Follow-up**: Validate that `objectName` in `registerFileUpload` matches expected namespace for the reverse share

### 0.11 — Move share passwords from query parameters to request body
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/share/routes.ts`, `apps/server/src/modules/share/controller.ts`, `apps/server/src/modules/file/routes.ts`, `apps/server/src/modules/file/controller.ts`, `apps/server/src/modules/reverse-share/routes.ts`, `apps/server/src/modules/reverse-share/controller.ts`
- **Change**: Password removed from all querystring schemas. New POST endpoints for password access (`/shares/:id/access`, `/shares/alias/:alias/access`). `GET /files/download-url` and `GET /files/download` → POST with body. Reverse-share passwords also moved to body
- **Verified**: PASS
- **Breaking**: Frontend must be updated to use POST instead of GET for password-protected access
- **Follow-up**: Add rate limit to `POST /files/download-url` and `POST /files/download`; remove dead `request.query?.password` fallback code; clean up `registerFileUpload` objectName trust

### From Batch 3 Review

- [ ] **Persist EMBED_SECRET in AppConfig** — Current in-memory secret invalidates all embed tokens on server restart. Consider DB-stored secret like jwtSecret
- [ ] **Re-check share security on embed access** — Currently only expiration is checked; password and maxViews are not. Decide if embed capability should bypass these
- [ ] **Rate-limit `POST /files/download-url` and `POST /files/download`** — Currently no per-route limit. Allows brute-force of weak share passwords
- [ ] **Validate objectName namespace in `registerFileUpload*`** — Service trusts client-supplied objectName. Should verify it matches `reverse-shares/{reverseShareId}/...` pattern
- [ ] **Remove dead `request.query?.password` fallback code** — Fastify strips unlisted query params via removeAdditional, so the fallback never triggers
- [ ] **Rate-limit keyGenerator** — Use `request.ip` alone (Fastify parses x-forwarded-for when trustProxy=true) instead of raw header string
- [ ] **Frontend migration** — Update frontend to use new POST endpoints for downloads/shares/embeds (breaking changes from 0.4, 0.11)
