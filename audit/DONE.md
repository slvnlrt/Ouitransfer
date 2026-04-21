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

---

## Phase 1: Tooling & DX Foundation

> 20 items completed (1.8 skipped), 2026-04-21.
> Plus 3 items from Phase 7 (security-critical, executed during Phase 1 as planned).

### Monorepo Foundation (1.1–1.5)

- **1.1 — pnpm-workspace.yaml** — Created `pnpm-workspace.yaml` with `packages: ["apps/*"]`
  - Date: 2026-04-21
  - Files: `pnpm-workspace.yaml` (new)
  - Verified: PASS

- **1.2 — .npmrc strict settings** — Created `.npmrc` with strict-peer-dependencies=false, auto-install-peers=true, shamefully-hoist=false, prefer-frozen-lockfile=true
  - Date: 2026-04-21
  - Files: `.npmrc` (new)
  - Verified: PASS

- **1.3 — .node-version** — Pinned Node to `24` (matching Dockerfile)
  - Date: 2026-04-21
  - Files: `.node-version` (new)
  - Verified: PASS

- **1.4 — Turborepo** — Installed `turbo@2.9.6`, created `turbo.json` with build/dev/lint/type-check/format/validate/test tasks
  - Date: 2026-04-21
  - Files: `turbo.json` (new), `package.json`, `.gitignore`
  - Verified: PASS (`pnpm turbo --version` → 2.9.6)

- **1.5 — Root workspace scripts** — Added 14 turbo-based scripts (dev, build, lint, format, type-check, validate, test + per-app variants)
  - Date: 2026-04-21
  - Files: `package.json`
  - Verified: PASS

### Replace Makefile with Justfile (1.6)

- **1.6 — Justfile** — Created 126-line Justfile with 18 recipes (Docker, Dev, Quality, Dependencies sections). Makefile deleted (no production users, no legacy to maintain)
  - Date: 2026-04-21
  - Files: `Justfile` (new)
  - Verified: PASS (`just --list` shows all 18 recipes)

### Linting & Formatting (1.7–1.8)

- **1.7 — Biome replaces ESLint+Prettier** — Installed `@biomejs/biome@2.4.12`. Created `biome.json`. Updated lint/format scripts in all 3 apps. Removed 10 ESLint/Prettier devDeps per app. Deleted 9 config files
  - Date: 2026-04-21
  - Files: `biome.json` (new), `apps/*/package.json` (3), deleted: `apps/*/eslint.config.mjs` (3), `apps/*/.prettierrc.json` (3), `apps/*/.prettierignore` (3)
  - Verified: PASS (520 files checked in 729ms)
  - Note: 730 lint errors + 321 warnings on existing code (pre-existing, not auto-fixed)

- **1.8 — oxlint** — SKIPPED (Biome covers sufficient rules for this stack)

### Testing Infrastructure (1.9–1.12)

- **1.9 — Vitest** — Installed `vitest@4.1.4` at root. Created per-app configs (server: node env, web: jsdom + @vitejs/plugin-react)
  - Date: 2026-04-21
  - Files: `package.json`, `apps/server/vitest.config.ts` (new), `apps/web/vitest.config.ts` (new), `apps/web/vitest.setup.ts` (new)
  - Verified: PASS (2 tasks, 4 tests total)

- **1.10 — React Testing Library** — Installed @testing-library/react, @testing-library/jest-dom, @testing-library/user-event, @vitejs/plugin-react, jsdom in web app
  - Date: 2026-04-21
  - Files: `apps/web/package.json`
  - Verified: PASS (RTL matchers loaded via vitest.setup.ts)

- **1.11 — Playwright E2E** — Installed `@playwright/test@1.59.1` at root. Created config (chromium, webServer for both apps). Added e2e scripts
  - Date: 2026-04-21
  - Files: `playwright.config.ts` (new), `e2e/.gitkeep` (new), `package.json`, `.gitignore`
  - Verified: PASS (config valid, browsers not yet downloaded)

- **1.12 — Initial smoke tests** — Created 3 test files: server health (2 tests), web React smoke (2 tests), E2E smoke (2 Playwright tests)
  - Date: 2026-04-21
  - Files: `apps/server/src/__tests__/health.test.ts` (new), `apps/web/src/__tests__/smoke.test.tsx` (new), `e2e/smoke.spec.ts` (new)
  - Verified: PASS (Vitest tests pass, E2E requires running services)

### Git Hooks & Commit Quality (1.13–1.14)

- **1.13 — Lefthook replaces Husky** — Removed husky, deleted `.husky/`, cleared git hooks path. Installed `lefthook@2.1.6`. Created `lefthook.yml` with pre-commit (Biome), pre-push (validate), commit-msg (commitlint)
  - Date: 2026-04-21
  - Files: `lefthook.yml` (new), `package.json`, deleted: `.husky/`
  - Verified: PASS

- **1.14 — commitlint** — Installed `@commitlint/cli@20.5.0` + `@commitlint/config-conventional@20.5.0`. Created config with custom `security` type
  - Date: 2026-04-21
  - Files: `commitlint.config.cjs` (new), `package.json`, `lefthook.yml`
  - Verified: PASS (valid messages pass, invalid rejected)

### CI/CD Pipeline (1.15–1.17)

- **1.15 — GitHub Actions CI** — Created `ci.yml` with 4 jobs: lint, type-check, test (parallel), build (depends on lint+type-check). Uses pnpm/action-setup, .node-version, frozen-lockfile, concurrency
  - Date: 2026-04-21
  - Files: `.github/workflows/ci.yml` (new)
  - Verified: PASS (syntax valid)

- **1.16 — GitHub Actions Docker** — Created `docker.yml` triggered on v* tags. Builds+pushes to ghcr.io with buildx + GHA cache
  - Date: 2026-04-21
  - Files: `.github/workflows/docker.yml` (new)
  - Verified: PASS (syntax valid)

- **1.17 — GitHub Actions E2E** — Created `e2e.yml` with Playwright on push/PR to main. Uploads report artifact
  - Date: 2026-04-21
  - Files: `.github/workflows/e2e.yml` (new)
  - Verified: PASS (syntax valid)

### Dead Code & Dependencies (1.18–1.21)

- **1.18 — Knip** — Installed `knip@6.6.0`. Created `knip.json` with workspace config. Found: 17 unused files, 12 unused deps, 6 unused devDeps, 134 unused exports, 5 unlisted deps
  - Date: 2026-04-21
  - Files: `knip.json` (new), `package.json`
  - Verified: PASS (report generated, issues cataloged for future phases)

- **1.19 — Renovate** — Created `renovate.json` with config:recommended, pin strategy, Monday schedule, automerge patch/minor
  - Date: 2026-04-21
  - Files: `renovate.json` (new)
  - Verified: PASS

- **1.20 — .envrc + malformed URL fix** — Created `.envrc` (direnv), root `.env.example` (66 lines). Fixed `http:localhost:3333` → `http://localhost:3333` in `apps/web/.env.example`
  - Date: 2026-04-21
  - Files: `.envrc` (new), `.env.example` (new), `apps/web/.env.example`
  - Verified: PASS

- **1.21 — Changesets** — Installed `@changesets/cli@2.31.0`. Initialized `.changeset/` with fixed versioning (all 3 apps together). Added changeset/version-packages/release scripts
  - Date: 2026-04-21
  - Files: `.changeset/config.json` (new), `.changeset/README.md` (new), `package.json`
  - Verified: PASS

---

## Phase 7 (Partial): Security-Critical Dependency Replacements

> 3 items completed during Phase 1 execution (as planned in CONSOLIDATED-TODO-LIST.md execution notes).

- **7.1 — speakeasy → otpauth** — Migrated `two-factor/service.ts` from speakeasy to `otpauth@9.5.0`. 3 call sites rewritten. Same RFC 6238 params (SHA1, 6 digits, 30s, window=1). Base32 secrets backward-compatible (no user migration needed). Removed speakeasy + @types/speakeasy
  - Date: 2026-04-21
  - Files: `apps/server/src/modules/two-factor/service.ts`, `apps/server/package.json`
  - Verified: PASS (type-check passes for service.ts, zero speakeasy references remaining)

- **7.2 — crypto-js removed** — Dead dependency with zero usages. Removed `crypto-js` + `@types/crypto-js` from server. All crypto already uses native `node:crypto`
  - Date: 2026-04-21
  - Files: `apps/server/package.json`
  - Verified: PASS (grep confirms zero imports)

- **7.3 — react-qr-reader removed** — Dead dependency with zero usages (archived beta). Removed from web. `react-qr-code` (different package, used for QR generation) preserved
  - Date: 2026-04-21
  - Files: `apps/web/package.json`
  - Verified: PASS (grep confirms zero imports, react-qr-code intact)
