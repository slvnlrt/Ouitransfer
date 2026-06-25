# TODO Post Phase 0 — Reviewer Follow-ups

> Items identified by reviewers during Phase 0 verification.
> Required for production-grade quality (state-of-the-art).
> All items completed on 2026-04-21.

---

## Security Hardening

- [x] **Harden S3 objectName prefix check against path traversal** — Reject `..` and `\0`, normalize with `path.posix.normalize`, re-verify prefix
  - File: `apps/server/src/modules/s3-storage/controller.ts`

- [x] **Audit `clientSecret` exposure in `AuthProviderResponseSchema`** — Removed from response schema + added `SAFE_PROVIDER_SELECT` in service
  - Files: `apps/server/src/modules/auth-providers/routes.ts`, `service.ts`

- [x] **Persist EMBED_SECRET in AppConfig** — Lazy-loads from DB, auto-creates if missing, cached in module variable
  - Files: `apps/server/src/modules/file/embed-token.ts`, `apps/server/prisma/seed.js`

- [x] **Re-check share security on embed access** — Password blocks embed (403), maxViews enforced atomically with conditional update
  - File: `apps/server/src/modules/file/controller.ts`

- [x] **Validate objectName namespace in `registerFileUpload*`** — `validateObjectName()` checks `\0`, `..`, and `reverse-shares/{id}/` prefix
  - File: `apps/server/src/modules/reverse-share/service.ts`

---

## Rate Limiting

- [x] **Rate-limit `POST /files/download-url` and `POST /files/download`** — 20 req/min/IP
  - File: `apps/server/src/modules/file/routes.ts`

- [x] **Fix rate-limit keyGenerator** — Uses `request.ip` (Fastify parses x-forwarded-for with trustProxy)
  - File: `apps/server/src/app.ts`

---

## Auth & Middleware Cleanup

- [x] **Add `!userId` early-return in S3 controller** — Applied to all 4 methods (getUploadUrl, getDownloadUrl, deleteObject, checkExists)
  - File: `apps/server/src/modules/s3-storage/controller.ts`

- [x] **Remove dead `request.query?.password` fallback code** — Simplified to body-only in 4 locations
  - Files: `apps/server/src/modules/share/controller.ts`, `reverse-share/controller.ts`

---

## Configuration & Defaults

- [x] **ALLOWED_IMAGE_HOSTS: realistic defaults + http/wildcard support** — `parseImageHosts()` supports `http://`, `https://`, bare hostname, `*.wildcard`. Defaults: localhost + 127.0.0.1 (both protocols)
  - File: `apps/web/next.config.ts`

- [x] **CORS cleanup** — Default `["http://localhost:5487"]` only. Production warning when `CORS_ORIGINS` unset
  - File: `apps/server/src/app.ts`

---

## Code Quality

- [x] **Audit `request.file()`/`request.files()` callers** — Only 2 callers found (avatar 5MB, logo 5MB). Both well under 50MB limit. No raw file transfer through multipart.
  - Result: No code change needed. Audit confirmed safe.

---

## Frontend Migration (Breaking Changes)

- [x] **Migrate frontend to new POST endpoints** — 20 files modified, 10 new proxy routes created:
  - Downloads: GET → POST with body
  - Share/reverse-share passwords: branching GET (no password) / POST `/access` (with password)
  - Embed: token-based via `generateEmbedToken` + new proxy route
  - Reverse-share multipart: missing proxy routes created (pre-existing gap fixed)
  - Files: `apps/web/src/http/endpoints/`, proxy routes, components

---

## Reviewer Notes (non-blocking, for future reference)

- Download rate-limit (20/min) may be insufficient against brute-force on weak share passwords — consider per-share throttling
- `embedSecret` creation uses `create` not `upsert` — near-zero race risk but could be tightened
- Embed currently unavailable in file manager (no shareId context) — wire through when viewing files within a share
- `parseImageHosts` uses magic slice indices (7/8) — cosmetic cleanup
