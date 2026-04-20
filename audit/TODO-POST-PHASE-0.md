# TODO Post Phase 0 — Reviewer Follow-ups

> Items identified by reviewers during Phase 0 verification.
> Required for production-grade quality (state-of-the-art).
> Organized by category.

---

## Security Hardening

- [ ] **Harden S3 objectName prefix check against path traversal** — `objectName.startsWith(\`${userId}/\`)` accepts `userId/../other-user/file`. Reject `..` segments or normalize with `path.posix.normalize` then re-verify prefix
  - File: `apps/server/src/modules/s3-storage/controller.ts`

- [ ] **Audit `clientSecret` exposure in `AuthProviderResponseSchema`** — Remove or scrub `clientSecret` from admin GET responses. OIDC secrets should never be returned to the client
  - File: `apps/server/src/modules/auth-providers/routes.ts`

- [ ] **Persist EMBED_SECRET in AppConfig** — Current in-memory secret invalidates all embed tokens on server restart. Store in DB like `jwtSecret`
  - File: `apps/server/src/modules/file/embed-token.ts`

- [ ] **Re-check share security on embed access** — Currently only expiration is checked; password and maxViews are not. Decide if embed capability should bypass these
  - File: `apps/server/src/modules/file/controller.ts` (embedFile method)

- [ ] **Validate objectName namespace in `registerFileUpload*`** — Service trusts client-supplied objectName. Should verify it matches `reverse-shares/{reverseShareId}/...` pattern
  - File: `apps/server/src/modules/reverse-share/service.ts`

- [ ] **Add `.strict()` to critical Zod schemas** — `removeAdditional: "all"` only strips via Ajv; Zod routes need `.strict()` on security-critical DTOs (login, auth-providers, etc.)
  - Files: `apps/server/src/modules/auth/dto.ts`, `apps/server/src/modules/auth-providers/dto.ts`

---

## Rate Limiting

- [ ] **Rate-limit `POST /files/download-url` and `POST /files/download`** — Currently no per-route limit. Allows brute-force of weak share passwords
  - File: `apps/server/src/modules/file/routes.ts`

- [ ] **Fix rate-limit keyGenerator** — Use `request.ip` alone (Fastify parses x-forwarded-for when trustProxy=true) instead of raw header string
  - File: `apps/server/src/app.ts`

---

## Auth & Middleware Cleanup

- [ ] **Complete preValidation migration** — Remove redundant `await request.jwtVerify()` from ALL handlers whose routes already have `preValidation` (~20+ instances of double verification)
  - Files: `apps/server/src/modules/file/controller.ts`, `folder/controller.ts`, `share/controller.ts`

- [ ] **Add `!userId` early-return in `S3StorageController.getUploadUrl`** — Before the `startsWith` check, for defensive consistency with other S3 methods
  - File: `apps/server/src/modules/s3-storage/controller.ts`

- [ ] **Remove dead `request.query?.password` fallback code** — Fastify strips unlisted query params via removeAdditional, so the fallback never triggers
  - Files: `apps/server/src/modules/share/controller.ts`, `reverse-share/controller.ts`

---

## Configuration & Defaults

- [ ] **Compile realistic default ALLOWED_IMAGE_HOSTS** — Current localhost-only default will break images post-deploy. Need Gravatar, OAuth avatar hosts, STORAGE_URL host at minimum
  - File: `apps/web/next.config.ts`

- [ ] **ALLOWED_IMAGE_HOSTS: support http:// and wildcard subdomains** — Custom-host branch forces HTTPS only. Support `http://host` syntax for dev/LAN setups. Add `*.example.com` wildcard subdomain support
  - File: `apps/web/next.config.ts`

- [ ] **CORS cleanup** — Drop unused `http://localhost:3000` from defaults (no app uses port 3000); add production-mode warning when `CORS_ORIGINS` env var is unset
  - File: `apps/server/src/app.ts`

---

## Code Quality

- [ ] **Fix 7-space indent in `reverse-share/routes.ts:389`** — Minor formatting inconsistency
  - File: `apps/server/src/modules/reverse-share/routes.ts`

- [ ] **Audit `request.file()`/`request.files()` callers** — Confirm no route uploads raw file bytes >50MB through Fastify multipart (all large uploads should use S3 presigned URLs)
  - Scope: `apps/server/src/modules/`

---

## Frontend Migration (Breaking Changes)

- [ ] **Migrate frontend to new POST endpoints** — Backend breaking changes from items 0.4 and 0.11:
  - `POST /files/embed-token` → generate embed tokens (replaces raw `/e/{fileId}` URLs)
  - `POST /shares/:shareId/access` → password-protected share access (was GET with query param)
  - `POST /shares/alias/:alias/access` → same for alias-based shares
  - `POST /files/download-url` → file download URL (was GET)
  - `POST /files/download` → file download (was GET)
  - `POST /reverse-shares/:id/upload/access` → reverse-share password (was GET with query param)
  - `POST /reverse-shares/alias/:alias/upload/access` → same for alias
  - Reverse-share presigned-url/register-file/multipart: password now in body instead of querystring
  - Files: `apps/web/src/http/endpoints/`, `apps/web/src/app/(shares)/`, `apps/web/src/components/`
