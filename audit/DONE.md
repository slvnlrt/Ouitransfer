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

### 0.15 — Replace z.any() with proper Zod schema on auth provider update
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/auth-providers/routes.ts`
- **Change**: Used existing `UpdateAuthProviderSchema` for PUT /providers/:id body. Defined `AuthProviderResponseSchema` for all admin response schemas. Zero `z.any()` remaining in file
- **Verified**: PASS

---

## Phase 0 Batch 3

### 0.4 — Add token-based auth to /embed endpoint
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/file/embed-token.ts` (NEW), `apps/server/src/modules/file/controller.ts`, `apps/server/src/modules/file/routes.ts`
- **Change**: Replaced raw file ID access with signed JWT embed tokens (jose HS256, 24h TTL). Route changed to `GET /embed/:token`. New `POST /files/embed-token` for token generation (authenticated). Share existence + expiration re-verified at access time
- **Verified**: PASS
- **Breaking**: Existing embed URLs using raw file IDs will stop working

### 0.8 — Install and configure @fastify/rate-limit
- **Date**: 2026-04-20
- **Files**: `apps/server/package.json`, `apps/server/src/app.ts`, `apps/server/src/modules/auth/routes.ts`, `apps/server/src/modules/two-factor/routes.ts`, `apps/server/src/modules/file/routes.ts`, `apps/server/src/modules/s3-storage/routes.ts`
- **Change**: Global 100 req/min/IP. Auth: login 5/min, 2FA 5/min, forgot-password 3/min, reset-password 3/min. Uploads: presigned-url 30/min
- **Verified**: PASS

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

### 0.11 — Move share passwords from query parameters to request body
- **Date**: 2026-04-20
- **Files**: `apps/server/src/modules/share/routes.ts`, `apps/server/src/modules/share/controller.ts`, `apps/server/src/modules/file/routes.ts`, `apps/server/src/modules/file/controller.ts`, `apps/server/src/modules/reverse-share/routes.ts`, `apps/server/src/modules/reverse-share/controller.ts`
- **Change**: Password removed from all querystring schemas. New POST endpoints for password access (`/shares/:id/access`, `/shares/alias/:alias/access`). `GET /files/download-url` and `GET /files/download` → POST with body. Reverse-share passwords also moved to body
- **Verified**: PASS
- **Breaking**: Frontend must be updated to use POST instead of GET for password-protected access

---

## Post-Phase 0: Reviewer Follow-ups

> 14 items identified during Phase 0 review, all completed 2026-04-21.
> See `audit/TODO-POST-PHASE-0.md` for full details and reviewer notes.

### Security Hardening (5 items)
- **S3 path traversal hardening** — Reject `..`/`\0`, normalize with `path.posix.normalize`, re-verify prefix in all 4 S3 methods
- **clientSecret scrubbed from API responses** — Removed from `AuthProviderResponseSchema` + `SAFE_PROVIDER_SELECT` in service
- **EMBED_SECRET persisted in AppConfig** — DB-stored, lazy-loaded, auto-created, module-cached
- **Share security enforced on embed** — Password blocks (403), maxViews atomic conditional update (410)
- **objectName namespace validation** — `validateObjectName()` in reverse-share service

### Rate Limiting (2 items)
- **Download endpoints rate-limited** — `POST /files/download-url` and `/download` at 20/min/IP
- **keyGenerator fixed** — Uses `request.ip` instead of raw `x-forwarded-for` header

### Auth & Middleware (2 items)
- **`!userId` early-return** — Applied to all 4 S3 controller methods
- **Dead password query fallback removed** — 4 locations in share + reverse-share controllers

### Configuration (2 items)
- **ALLOWED_IMAGE_HOSTS improved** — `parseImageHosts()` supports http/https/wildcard. Defaults: localhost + 127.0.0.1
- **CORS cleanup** — Default `["http://localhost:5487"]` only + production warning

### Code Quality (1 item)
- **Multipart callers audited** — Only avatar (5MB) and logo (5MB) use `request.file()`. Safe.

### Frontend Migration (1 item)
- **Full frontend migration** — 20 files modified, 10 new proxy routes. Downloads POST, share/reverse-share password branching, embed token flow
- **Verified**: 13/14 PASS, 1 PARTIAL (userId early-return extended to all S3 methods post-review)
