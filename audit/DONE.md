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
