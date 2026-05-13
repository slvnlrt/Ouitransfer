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

---

## Phase 2: Architecture Restructuring

### 2.1 — Create packages/shared for cross-app utilities (mime-types)
- **Date**: 2026-04-21
- **Files**: `packages/shared/package.json` (new), `packages/shared/tsconfig.json` (new), `packages/shared/src/mime-types.ts` (new), `apps/server/package.json`, `apps/web/package.json`, `apps/server/src/modules/file/controller.ts`, `apps/server/src/providers/s3-storage.provider.ts`, `apps/web/src/hooks/use-file-preview.ts`, `apps/web/src/app/api/(proxy)/reverse-shares/files/download/[fileId]/route.ts`
- **Change**: Merged duplicate mime-types files (378 LOC server + 435 LOC web) into single `@ouitransfer/shared` workspace package (~330 LOC). Exports `getMimeType`, `getContentType`, `isImageMimeType`, `isAudioMimeType`, `isVideoMimeType`, `extractFilenameFromContentDisposition`, `detectMimeTypeWithFallback`. Updated 4 import sites. Deleted old `apps/server/src/utils/mime-types.ts` and `apps/web/src/utils/mime-types.ts`
- **Verified**: PASS (web type-check passes, all imports resolve)

### 2.2 — Create packages/config for shared tsconfig base
- **Date**: 2026-04-21
- **Files**: `packages/config/package.json` (new), `packages/config/tsconfig/base.json` (new), `packages/config/tsconfig/server.json` (new), `packages/config/tsconfig/nextjs.json` (new), `apps/server/tsconfig.json`, `apps/web/tsconfig.json`, `apps/docs/tsconfig.json`
- **Change**: Extracted shared tsconfig settings (strict, esModuleInterop, skipLibCheck, etc.) into `@ouitransfer/config` base configs. Server extends `server.json` (node16 module), web/docs extend `nextjs.json` (bundler resolution). Removed unused `baseUrl`/`paths` from server tsconfig
- **Verified**: PASS (web type-check passes; server pre-existing Prisma/any errors unchanged)

### 2.3 — Unify TypeScript versions
- **Date**: 2026-04-21
- **Files**: `apps/server/package.json`
- **Change**: Aligned server TypeScript from `^5.7.3` to `^5.8.3` (matching web/docs)
- **Verified**: PASS

### 2.4 — Remove ignoreDuringBuilds and ignoreBuildErrors from docs
- **Date**: 2026-04-21
- **Files**: `apps/docs/next.config.mjs`, `biome.json`, `apps/docs/src/components/KeyGenerator.tsx`, all docs source files (biome auto-fix)
- **Change**: Removed `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true` from docs next.config. Added CSS Tailwind directive support to root biome.json (`css.parser.tailwindDirectives: true`). Fixed button missing `type` attribute. Auto-fixed CRLF, import sorting, `node:` protocol prefixes across all docs files
- **Verified**: PASS (docs type-check and lint both pass with 0 errors)

### 2.5 — Reduce 110-route proxy layer to catch-all handler
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy-routes.ts` (new), `apps/web/src/lib/proxy.ts` (new), `apps/web/src/app/api/[...proxy]/route.ts` (new), `apps/web/tsconfig.json`, deleted `apps/web/src/app/api/(proxy)/` (110 files)
- **Change**: Replaced 110 individual proxy route files (~3,500+ LOC) with 3 files (~580 LOC): route config table (122 entries with feature flags), generic proxy handler (matching, header building, JSON/streaming/passthrough response builders), and catch-all Next.js route. Supports all 6 original patterns: json-simple, json-with-client-headers, streaming, passthrough-body, custom (body transforms, OAuth redirects), deprecated. `API_BASE_URL` defined once instead of 110 times
- **Verified**: PASS (web type-check passes, lint clean)

### 2.6 — Hoist shared dependencies via pnpm catalogs
- **Date**: 2026-04-21
- **Files**: `pnpm-workspace.yaml`, `package.json`, `apps/server/package.json`, `apps/web/package.json`, `apps/docs/package.json`
- **Change**: Added pnpm `catalog:` protocol with 20 shared dependency versions (next, react, zod, typescript, vitest, tailwindcss, lucide-react, etc.). Converted 36 version specifiers across 4 package.json files to `catalog:`. Also aligned `@radix-ui/react-dialog` (^1.1.6 -> ^1.1.15) and `tw-animate-css` (^1.2.8 -> ^1.3.4)
- **Verified**: PASS (pnpm install succeeds, web + docs type-check pass)

### 2.7 — Align drifting dependency versions
- **Date**: 2026-04-21
- **Files**: `apps/server/package.json`, `apps/docs/package.json`
- **Change**: Aligned `prisma` CLI `^6.3.1` -> `^6.11.0` (match @prisma/client), `@types/node` `^22.13.4` -> `^22.14.0`, `tailwind-merge` `^3.2.0` -> `^3.3.1`
- **Verified**: PASS

### 2.8 — Evaluate replacing supervisord with docker compose multi-container
- **Date**: 2026-04-21
- **Files**: `Dockerfile`
- **Change**: **Decision: KEEP single-container supervisord approach.** Rationale: (1) Self-hosted product prioritizes zero-config UX — single `docker compose up` with one service is simplest for users. (2) MinIO is an internal implementation detail; exposing as separate container leaks abstraction. (3) No scaling needs for a file transfer tool. (4) Cross-container UID/GID permission dance + SQLite file locking adds fragility. (5) `ENABLE_S3=true` mode would require conditional service inclusion. **Additionally**: Updated Dockerfile to copy `packages/shared/` and `packages/config/` in both server and web build stages (required for workspace dependencies added in 2.1/2.2)
- **Verified**: PASS (Dockerfile syntax correct, packages/ COPY added to all 4 affected stages)

### Phase 2 Review Follow-ups

### C1 — Shared package ESM/CJS incompatibility (critical)
- **Date**: 2026-04-21
- **Files**: `apps/server/package.json`, all 59 files in `apps/server/src/`, `packages/shared/tsconfig.json`, `packages/config/tsconfig/server.json`, `turbo.json`
- **Change**: Full ESM migration. Added `"type": "module"` to server. Migrated ~152 relative imports to `.js` extensions. Converted `require("@scalar/fastify-api-reference")` to dynamic `import()`. Shared package now builds with tsc (removed `noEmit`). Server + shared tsconfigs use `nodenext` module/resolution. Turbo `dev` task now depends on `^build` so shared package builds first.
- **Verified**: PASS (server type-check 0 ESM errors, shared build succeeds)

### C2 — `body: "raw"` missing `duplex: "half"` flag (critical)
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy.ts`
- **Change**: Extended duplex condition to cover both `body: "raw"` and `body: "duplex"` (both stream `req.body` as ReadableStream)
- **Verified**: PASS

### W2 — allResponseHeaders hop-by-hop filter
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy.ts`
- **Change**: Added `HOP_BY_HOP_HEADERS` Set (transfer-encoding, connection, keep-alive, upgrade, etc.). Filter them from `buildAllHeadersResponse`. Use `.append()` for Set-Cookie instead of `.set()`.
- **Verified**: PASS

### W3 — DELETE methods no longer send empty JSON body
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy.ts`
- **Change**: Skip body/Content-Type for DELETE unless `bodyTransform` is configured. DELETE with bodyTransform (shares items) still works.
- **Verified**: PASS

### W4 — Redirect status preservation
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy.ts`
- **Change**: Replaced `NextResponse.redirect()` (forces 307) with `new NextResponse(null, { status: apiRes.status, headers: { location } })`. Resolves relative URLs via `new URL(location, req.url)`.
- **Verified**: PASS

### W5 + W6 — Abort signal cleanup + client disconnect propagation
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy.ts`
- **Change**: Replaced manual `setTimeout`/`clearTimeout` with `AbortSignal.timeout()`. Always forward `req.signal`; combined with timeout via `AbortSignal.any([req.signal, AbortSignal.timeout()])` (Node 20+).
- **Verified**: PASS

### W7 — Dead route deleted
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy-routes.ts`
- **Change**: Removed dead route `r("GET", "reverse-shares/files/:fileId", ...)` — no frontend caller, superseded by `reverse-shares/files/download/:fileId` with `stream: true`.
- **Verified**: PASS

### W8 — Dead endpoint definitions cleaned up
- **Date**: 2026-04-21
- **Files**: `apps/web/src/http/endpoints/folders/index.ts`, `types.ts`, `apps/web/src/http/endpoints/auth/index.ts`, `types.ts`
- **Change**: Deleted `checkFolder`, `getOIDCConfig`, `initiateOIDCLogin` functions and their types (CheckFolderBody, CheckFolder201, CheckFolderResult, OidcConfig200, OIDCConfigResult, OIDCConfigData). No callers found.
- **Verified**: PASS (web type-check clean)

### W11 — Dockerfile runtime packages/ copy
- **Date**: 2026-04-21
- **Files**: `Dockerfile`
- **Change**: Added `COPY --from=server-builder /app/packages ./packages` in runner stage so pnpm symlinks resolve at runtime.
- **Verified**: PASS

### W12 — wrapFiles/wrapFolders validation
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy-routes.ts`
- **Change**: Added `Array.isArray()` validation in `wrapFiles` and `wrapFolders`. Throws descriptive error if expected key is missing instead of silently passing empty arrays.
- **Verified**: PASS

### S8 — Dockerfile pnpm consistency
- **Date**: 2026-04-21
- **Files**: `Dockerfile`
- **Change**: `npx prisma generate` → `pnpm exec prisma generate`. `pnpm build` → `pnpm run build`.
- **Verified**: PASS

### S9 — biome.json excludes comment
- **Date**: 2026-04-21
- **Files**: `biome.json`
- **Change**: Added `_comment` field in `files` section explaining shadcn/ui and magicui generated file exclusions.
- **Verified**: PASS

### S12 — Server tsconfig / base config cleanup
- **Date**: 2026-04-21
- **Files**: `packages/config/tsconfig/server.json`, `apps/server/tsconfig.json`
- **Change**: Removed `outDir`/`rootDir` from base server preset (resolved relative to base file location, not child — was misleading). Child configs keep their own `outDir`/`rootDir` which resolve correctly relative to their location.
- **Verified**: PASS

### S13 — API_BASE_URL trailing slash
- **Date**: 2026-04-21
- **Files**: `apps/web/src/lib/proxy.ts`
- **Change**: Added `.replace(/\/+$/, "")` to defensively trim trailing slashes from `API_BASE_URL`.
- **Verified**: PASS

### Fix — `@smithy/node-http-handler` missing declaration
- **Date**: 2026-04-21
- **Files**: `apps/server/package.json`
- **Change**: Added `@smithy/node-http-handler` as direct dependency. The code imports it directly for custom HTTPS agent configuration (self-signed certs), but it was only available as a transitive dep of `@aws-sdk/client-s3`. pnpm strict mode requires explicit declaration.
- **Verified**: PASS (server type-check now 0 errors)

---

## Phase 3: Code Quality & Type Safety

### 3.1 — Type Fastify request decoration properly
- **Date**: 2026-04-28
- **Files**: `apps/server/src/types/fastify.d.ts`, 12 controller files
- **Change**: Added `declare module "@fastify/jwt" { interface FastifyJWT { user: { userId: string; isAdmin: boolean } } }`. Removed all 66 `(request as any).user` casts across controllers.
- **Verified**: PASS (server type-check clean)

### 3.2 — Escalate noExplicitAny to error + fix all any types
- **Date**: 2026-04-28
- **Files**: `biome.json`, 40+ server modules, 30+ web components, 13 web hooks, endpoint types
- **Change**: Changed `noExplicitAny` from `"off"` to `"error"` in biome.json. Eliminated ~355 explicit `: any` annotations (168 server, 187 web). Created proper interfaces: `AuthProviderModel`, `FileBrowserFile`/`FileBrowserFolder`, `ShareViewFile`/`ShareViewFolder`, `DashboardFile`, `UppyProgressEvent`/`UppyUploadResult`, `DragDropItem`, `TraversalFolder`, `UpdateShareData`, `MoveItemFile`/`MoveItemFolder`, etc. All catch blocks migrated to `catch (error: unknown)` with type narrowing. ~22 justified `biome-ignore` suppressions for genuinely unavoidable cases (WebCrypto polyfills, react-hook-form generics, vendor prefixes).
- **Verified**: PASS (0 biome violations on 372 files, type-check 4/4 clean)

### 3.3 — Fix __DELETE__ sentinel pattern
- **Date**: 2026-04-28
- **Files**: `apps/web/src/hooks/use-enhanced-file-manager.ts`, `apps/web/src/app/files/hooks/use-file-browser.ts`
- **Change**: Extended `handleImmediateUpdate` parameter type to include `"__DELETE__"` literal. Removed all 5 `as any` casts. Added proper type guard branching for delete vs move paths.
- **Verified**: PASS

### 3.4 — Implement centralized Fastify error handler (PARTIAL)
- **Date**: 2026-04-28
- **Files**: `apps/server/src/utils/error-handler.ts` (new), `apps/server/src/app.ts`
- **Change**: Created `globalErrorHandler()` covering Zod validation (400), JWT auth (401), Prisma errors (P2002→409, P2025→404, P2003/P2014→409), Fastify 4xx/5xx, unknown→500. Consistent response shape `{ error, code, statusCode, details? }`. Registered with `app.setErrorHandler()` + `app.setNotFoundHandler()`.
- **Limitation**: Controllers still have their own try/catch blocks returning `{ error: "..." }` — the global handler is only reached for errors that escape controller code (Zod validation, unhandled throws). Two error shapes coexist. Controller migration deferred to Phase 5 item 5.16.
- **Verified**: PASS

### 3.5 — Fix silent catch blocks
- **Date**: 2026-04-28
- **Files**: `apps/server/src/modules/file/controller.ts`
- **Change**: Added `request.log.debug("Optional JWT verification skipped — anonymous access")` to both empty catch blocks (expected failures for public share access).
- **Verified**: PASS

### 3.6 — Fix exhaustive-deps suppressions
- **Date**: 2026-04-28
- **Files**: 8 web files (5 customization forms, files-grid, use-file-browser, use-public-share)
- **Change**: Fixed all 8 `eslint-disable-next-line react-hooks/exhaustive-deps` comments. Customization forms: added stable `useCallback` deps. files-grid: introduced `loadedFileIds` ref to avoid infinite loop. use-file-browser: used existing `loadFilesRef.current` pattern. use-public-share: added memoized `loadShare` to deps.
- **Verified**: PASS

### 3.7 — Replace console.* with Pino logger on server
- **Date**: 2026-04-28
- **Files**: `apps/server/src/utils/logger.ts` (new), `apps/server/src/app.ts`, 31 module files
- **Change**: Created `setLogger`/`getLogger` singleton pattern. Changed log level from `"warn"` to `process.env.LOG_LEVEL || "info"`. Replaced ~87 console.* calls with `request.log.*` (controllers) or `getLogger().*` (services). Structured logging with metadata objects.
- **Verified**: PASS

### 3.8 — Add structured frontend logging
- **Date**: 2026-04-28
- **Files**: `apps/web/src/lib/logger.ts` (new), 17 hook/utility files, ~35 .tsx component files
- **Change**: Created level-filtered logger (`NEXT_PUBLIC_LOG_LEVEL`). Replaced 54 console.* calls in hooks/utilities initially, then completed the remaining 57 console.* calls in .tsx component files in the review follow-up.
- **Verified**: PASS

### 3.9 — Break up files exceeding 500 lines
- **Date**: 2026-04-28
- **Files**: 4 server modules split, 5 web components split, 11 new files created
- **Change**: Server: `reverse-share/service.ts` 1017→399L (+upload.service.ts +multipart.service.ts), `reverse-share/controller.ts` 744→513L (+multipart.controller.ts), `file/controller.ts` 873→365L (+download/embed/multipart controllers), `auth-providers/service.ts` 814→263L (+oauth-flow.service.ts +user-linking.service.ts). Web: `files-table.tsx` 972→464L, `files-grid.tsx` 919→367L, `received-files-modal.tsx` 918→530L, `shares-table.tsx` 652→538L, `share-details-modal.tsx` 682→543L. Left 3 web files intact (already internally decomposed).
- **Verified**: PASS

### 3.10 — Fix typo in filename
- **Date**: 2026-04-28
- **Files**: `apps/web/src/components/auth/paths/unauthenticated-only-paths.ts` (renamed from `unahthenticated-only-paths.ts`), `redirect-handler.tsx`
- **Verified**: PASS

### 3.11 — Unify PrismaClient to singleton
- **Date**: 2026-04-28
- **Files**: `apps/server/src/modules/reverse-share/service.ts`, `apps/server/src/modules/user/service.ts`
- **Change**: Replaced `new PrismaClient()` with import from `../../shared/prisma.js` in both files.
- **Verified**: PASS

### 3.12 — Use Prisma migrations instead of schema push
- **Date**: 2026-04-28
- **Files**: `apps/server/prisma/migrations/20260428082804_init/migration.sql` (new), `migration_lock.toml` (new), `prisma/seed.js`, `package.json`
- **Change**: Created initial migration (317L, 16 tables). Fixed seed CJS→ESM. Added `db:migrate` and `db:migrate:dev` scripts.
- **Verified**: PASS

### 3.13 — Real integration tests
- **Date**: 2026-04-28
- **Files**: `apps/server/src/__tests__/health.test.ts`, `apps/web/src/__tests__/smoke.test.tsx`
- **Change**: Server: Fastify inject() health endpoint test. Web: 3 Button component rendering tests with @testing-library/react.
- **Verified**: PASS (all tests green)

### 3.14 — Knip configuration for docs MDX
- **Date**: 2026-04-28
- **Files**: `knip.json`
- **Change**: Added `src/app/layout.config.tsx` and `content/**/*.mdx` to docs entry/project patterns.
- **Verified**: PASS

### 3.15 — Proxy route resolution test
- **Date**: 2026-04-28
- **Files**: `apps/web/src/lib/__tests__/proxy-routes.test.ts` (new)
- **Change**: 62 tests covering static vs dynamic ordering, multi-segment paths, parameter extraction, route table invariants.
- **Verified**: PASS (62/62 green)

### 3.16 — Clean up regex in extractFilenameFromContentDisposition
- **Date**: 2026-04-28
- **Files**: `packages/shared/src/mime-types.ts`
- **Change**: Replaced greedy single-capture regex with two-group pattern for quoted/unquoted filenames. Added JSDoc for RFC 5987 UTF-8 limitation.
- **Verified**: PASS (build + type-check)

### 3.17 — Subpath export guidance
- **Date**: 2026-04-28
- **Files**: `packages/shared/package.json`
- **Change**: Added `_exportGuide` field documenting subpath export pattern for future utilities.
- **Verified**: PASS

### Phase 3 Review Follow-ups (Fixed)

### I-3 — AuthProviderModel replaced with Prisma import
- **Date**: 2026-04-28
- **Files**: `apps/server/src/modules/auth-providers/types.ts`
- **Change**: Replaced 22-line manual interface with `import type { AuthProvider } from "@prisma/client"; export type AuthProviderModel = AuthProvider;`
- **Verified**: PASS

### I-4 — Export matchRoute for real test coverage
- **Date**: 2026-04-28
- **Files**: `apps/web/src/lib/proxy.ts`, `apps/web/src/lib/__tests__/proxy-routes.test.ts`
- **Change**: Exported `matchRoute`, removed inline copy in test, 62 tests now verify production code.
- **Verified**: PASS (62/62 tests green)

### I-5 — Fix noImplicitAnyLet violations + enable rule
- **Date**: 2026-04-28
- **Files**: `biome.json`, `apps/web/src/hooks/useUppyUpload.ts`, `apps/web/src/app/profile/components/color-picker-form.tsx`
- **Change**: Fixed 3 implicit-any-let violations, enabled `noImplicitAnyLet: "error"` in biome.
- **Verified**: PASS

### I-7 — Debug logging for silent catch in download controller
- **Date**: 2026-04-28
- **Files**: `apps/server/src/modules/file/download.controller.ts`
- **Change**: Added `request.log.debug({ err }, "JWT verification failed for reverse-share download")` to previously silent catch block.
- **Verified**: PASS

### I-8 — Replace console.warn with Pino in app.ts
- **Date**: 2026-04-28
- **Files**: `apps/server/src/app.ts`
- **Change**: CORS security warning now uses `app.log.warn(...)` instead of `console.warn(...)`.
- **Verified**: PASS

### M-2 — seed.js crypto import protocol
- **Date**: 2026-04-28
- **Files**: `apps/server/prisma/seed.js`
- **Change**: `import crypto from "crypto"` → `import crypto from "node:crypto"`
- **Verified**: PASS

### M-7 — Import organization cleanup
- **Date**: 2026-04-28
- **Files**: ~140 files across server, web, docs
- **Change**: Ran biome auto-fix for import organization across entire codebase.
- **Verified**: PASS (type-check 5/5 clean)

### I-1 — Error handler unit tests
- **Date**: 2026-04-28
- **Files**: `apps/server/src/__tests__/error-handler.test.ts` (new), `apps/server/src/utils/error-handler.ts`
- **Change**: 29 unit tests for `globalErrorHandler()` covering all 6 error categories (Zod, serialization, JWT, Prisma, Fastify 4xx/5xx, unknown). Also found and fixed a real bug: `isResponseSerializationError()` crashed on primitive throws (added `typeof error === "object"` guard).
- **Verified**: PASS (29/29 tests green)

### I-6 — Frontend logger component migration
- **Date**: 2026-04-28
- **Files**: 34 .tsx component files
- **Change**: Migrated remaining 57 console.* calls in .tsx component files to structured logger. Zero console.* calls remain in .tsx files.
- **Verified**: PASS (type-check clean, 0 console.* in .tsx)

### Pre-existing a11y lint errors fixed
- **Date**: 2026-04-28
- **Files**: 8 web component files
- **Change**: Fixed 13 pre-existing biome a11y errors surfaced when lefthook ran on touched files: replaced `<div onClick>` with `<button>` for keyboard accessibility (navbar, QR thumbnails, drop zone), added `htmlFor` to label, `biome-ignore` for audio caption (no captions for uploaded audio), fixed forEach return value.
- **Verified**: PASS (biome check clean on all 8 files)

### Lefthook --staged fix
- **Date**: 2026-04-28
- **Files**: `lefthook.yml`
- **Change**: Replaced `{staged_files}` expansion (breaks on Windows with >100 files) with biome's native `--staged` flag. Biome queries git directly, avoiding command-line length limits.
- **Verified**: PASS (commit with 39 staged files succeeds through lefthook)

---

## Phase 3 — Quality Audit Rework (QA Critical Items)

> Cross-review of Phase 3 deliverables identified 9 QA items (3 critical, 4 important, 2 minor).
> Criticals fixed immediately; important/minor tracked in TODO-POST-PHASE-3.md.

### QA-1 — error-handler.test.ts type errors fixed
- **Date**: 2026-04-28
- **Files**: `apps/server/src/__tests__/error-handler.test.ts`
- **Change**: `globalNotFoundHandler` takes 2 params but test used `Parameters<>[2]` instead of `[1]` (copy-paste from 3-arg `globalErrorHandler`). Extracted two typed invocation helpers (`invokeErrorHandler`, `invokeNotFoundHandler`) that encapsulate all type casts in one place using real Fastify types (`FastifyError | Error`, `FastifyRequest`, `FastifyReply`). Replaced all 24 inline cast sites. File reduced from 614→~530 lines.
- **Verified**: PASS (`pnpm --filter ouitransfer-api type-check` clean, 31/31 tests green)

### QA-2 — jwtSign augmentation removed (redundant decorator)
- **Date**: 2026-04-28
- **Files**: `apps/server/src/app.ts`, `apps/server/src/types/fastify.d.ts`, `apps/server/src/modules/auth/controller.ts`, `apps/server/src/modules/auth-providers/controller.ts`
- **Change**: Custom `app.decorateRequest("jwtSign", ...)` was redundant — `@fastify/jwt` already provides `reply.jwtSign()` natively with proper types (`Promise<string>`, `SignPayloadType`, overloads). The custom decorator returned `string` (sync) with weak `object` parameter types. Removed the decorator, switched 3 callers from `request.jwtSign()` to `reply.jwtSign()`, rewrote `fastify.d.ts` to only contain the `FastifyJWT.user` augmentation.
- **Verified**: PASS (type-check clean, 31/31 tests green)

### QA-4 — API-to-view mapper module replaces 16 double-casts
- **Date**: 2026-04-28
- **Files**: `apps/web/src/lib/api-mappers.ts` (new), `apps/web/src/app/files/hooks/use-file-browser.ts`, `apps/web/src/app/dashboard/hooks/use-dashboard.ts`, `apps/web/src/app/(shares)/s/[alias]/hooks/use-public-share.ts`, `apps/web/src/hooks/useUppyUpload.ts`
- **Change**: Created mapper module (150 lines) with 8 typed mapper functions (`mapApiFile`, `mapApiFiles`, `mapApiFolder`, `mapApiFolders`, `mapShareFile`, `mapShareFiles`, `mapShareFolder`, `mapShareFolders`) + `getUppyObjectName` helper. Replaced 16 `as unknown as` double-casts across 4 hook files. Also eliminated 5 redundant hook-local type interfaces (`FileBrowserFile`, `DashboardFile`, `ShareViewFile`, `FileBrowserFolder`, `ShareViewFolder`) in favor of canonical `files-table-types.ts` exports. Remaining `as unknown as` in web: 2 legitimate (browser API boundary, dynamic field access).
- **Verified**: PASS (web type-check clean)
- **Follow-up tracked**: 21 additional type duplicates across 11 files → Phase 4 item 4.15

### QA-5 — biome-ignore suppressions audited: 23→0 in server, 23→0 in web (noExplicitAny)
- **Date**: 2026-04-28
- **Files**: 12 files across `apps/web/src/` + new `apps/web/src/app/settings/components/auth-provider-form/types.ts`
- **Change**: Audited all 23 `biome-ignore lint/suspicious/noExplicitAny` suppressions. 21 removed (replaced with proper types: `FileItem[]`, `FolderItem[]`, `UseFormRegister<GroupFormData>`, `DraggableProvidedDragHandleProps`, `ProviderFormDataMap`, `StringFields` conditional type, explicit `LoginBody` construction). 2 remaining were for crypto polyfill in `server.ts` — subsequently deleted entirely (see crypto polyfill entry below). Created `ProviderFormData`/`ProviderFormDataMap` types for auth-provider forms.
- **Verified**: PASS (web + server type-check clean, 0 `noExplicitAny` suppressions remaining in entire codebase)

### QA-6 — auth-providers Prisma casts eliminated via Zod-derived types
- **Date**: 2026-04-28
- **Files**: `apps/server/src/modules/auth-providers/dto.ts`, `service.ts`, `controller.ts`, `types.ts`
- **Change**: Service methods now accept Zod-derived types (`CreateAuthProviderInput`, `UpdateAuthProviderInput`) instead of `Prisma.*` types directly. Explicit field mapping inside service ensures only validated fields reach Prisma. Removed `as unknown as Prisma.AuthProviderCreateInput` + 2 `as Prisma.AuthProviderUpdateInput` casts. Removed dead code (`OFFICIAL_PROVIDER_ALLOWED_FIELDS`, `sanitizeOfficialProviderData`). Replaced manual allowlist with `UpdateOfficialProviderSchema.parse()`. No other dangerous `as unknown as` casts found in server modules.
- **Verified**: PASS (server type-check clean, 31/31 tests green)

### QA-7 — Runtime console.* migrated to structured Pino logging
- **Date**: 2026-04-28
- **Files**: `apps/server/src/scripts/migrate-filesystem-to-s3.ts`, `apps/server/src/server.ts`, `apps/server/src/config/storage.config.ts`, `apps/server/src/utils/container-detection.ts`
- **Change**: Migrated 37 `console.*` calls to structured Pino logging. `FilesystemToS3Migrator` class now accepts `FastifyBaseLogger` via constructor (obtained from `getLogger()` in `runAutoMigration()`). All migrated calls use structured logging with context objects. 5 remaining `console.*` are all pre-logger bootstrap with explanatory comments (server.ts pre-buildApp warning + startup catch, storage.config.ts module-level ×2, container-detection.ts module-level).
- **Verified**: PASS (server type-check clean, 31/31 tests green)

### Dead crypto polyfill removed
- **Date**: 2026-04-28
- **Files**: `apps/server/src/server.ts`
- **Change**: Deleted `globalThis.crypto` and `global.crypto` polyfill block (lines 22-30) + the `import crypto from "node:crypto"` import. Node 19+ has `globalThis.crypto` natively; this project targets Node 24 — the polyfill was dead code (condition never true). This also eliminated the last 2 `biome-ignore lint/suspicious/noExplicitAny` suppressions in the server, bringing the entire codebase to 0 noExplicitAny suppressions.
- **Verified**: PASS (server type-check clean, 31/31 tests green)

---

## Phase 4 — Frontend Modernization

### 4.14 — Extract shared UI primitives from duplicated file/folder rows/cards
- **Date**: 2026-04-28
- **Files**: Created 5 new shared files (`editable-field.tsx`, `item-actions.tsx`, `use-editable-item.ts`, `use-selection-manager.ts`, `format-date-time.ts`). Modified 6 consumer files (`files-table.tsx`, `files-table-file-row.tsx`, `files-table-folder-row.tsx`, `files-grid.tsx`, `files-grid-file-card.tsx`, `files-grid-folder-card.tsx`).
- **Change**: Extracted `EditableField` component (inline-edit input + confirm/cancel buttons + hover-reveal edit pencil), `ItemDropdownMenu` + `ItemContextMenuActions` (configurable action lists for dropdown/context menus), `useEditableItem` hook (unified edit state with transform callbacks), `useSelectionManager` hook (selection state + bulk actions), and `formatDateTime` utility. Consumer files reduced from 2108L → 1311L (-797L). Also fixed 10 pre-existing a11y lint errors: added `role="button"` + `tabIndex={0}` + keyboard handlers to interactive card/row divs, moved hover handlers from `<div>` to `<TableCell>`, added `type="button"` to share table button.
- **Verified**: PASS (web + API type-check clean, 31/31 tests green)

### 4.15 — Consolidate 29 duplicate File/Folder type interfaces
- **Date**: 2026-04-28
- **Files**: 12 files modified across `apps/web/src/` (5 exact-duplicate files, 7 subset/divergent files)
- **Change**: 10 exact duplicate interfaces replaced with imports from canonical `files-table-types.ts`. 13 subset interfaces converted to `Pick<FileItem/FolderItem, ...>` aliases (FileToDelete, FileToRename, FileToShare, etc.). 4 unused dead types removed from share types/index.tsx. 1 genuinely divergent type (`MoveItemFolder`) kept separate with JSDoc explaining API null boundary. 1 widened type (`BulkFolder`) simplified to direct `FolderItem` alias after verifying callers always pass full objects. 4 API-layer types in `http/endpoints/*/types.ts` correctly left untouched (already bridged by `api-mappers.ts`).
- **Verified**: PASS (web + API type-check clean, 31/31 tests green)

### 4.1 — Error boundaries (error.tsx, global-error.tsx, not-found.tsx)
- **Date**: 2026-04-28
- **Files**: 9 new files created, 2 modified (`settings/page.tsx`, `en-US.json`)
- **Change**: Created `ErrorDisplay` component (3 variants: page/inline/minimal) with configurable actions (Link for href, Button for onClick). Created `reportError` utility for centralized error reporting with `ErrorContext` interface. Added `global-error.tsx` (self-contained, own html/body, inline SVG), `error.tsx` (catch-all with dev-only error.message), `not-found.tsx` (server component, i18n), share-specific `error.tsx` files (minimal variant), `loading.tsx` (self-contained CSS spinner — no useTranslations dependency). Refactored settings page 2 inline Card errors to use ErrorDisplay (112→84 lines). Added 14 i18n keys in `errors` namespace. 25 tests (17 ErrorDisplay, 8 reportError).
- **Verified**: PASS (web type-check clean, API type-check clean, 90/90 web tests, 31/31 API tests)

### 4.2 — Loading states (loading.tsx)
- **Date**: 2026-04-28
- **Files**: `apps/web/src/app/loading.tsx`
- **Change**: Root-level `loading.tsx` with self-contained CSS spinner (no hooks, no providers). Per-page `if (isLoading) return <LoadingScreen />` pattern preserved — `loading.tsx` handles route transitions only. Note: per-segment loading.tsx files deferred until TanStack Query migration (4.3) which will change data-fetching patterns.
- **Verified**: PASS (included in 4.1 verification)

### 4.1/4.2 Cleanup — Replace 3 ad-hoc error UIs with ErrorDisplay
- **Date**: 2026-04-28
- **Files**: 3 modified, 1 deleted
- **Change**: Replaced `ShareNotFound` component (Card + IconLock + title/desc) with `ErrorDisplay variant="inline"` in share page — deleted `share-not-found.tsx`. Replaced login "no auth methods" raw `<div><p>` with `ErrorDisplay variant="minimal"`. Replaced storage-usage error state (manual warning icon + title + message + retry Button) with `ErrorDisplay variant="minimal"` embedded in existing Card layout — removed unused `Button` and `IconRefresh` imports.
- **Verified**: PASS (web type-check clean, 90/90 tests)

### QA-3 — JWT error detection made future-proof
- **Date**: 2026-04-28
- **Files**: `apps/server/src/utils/error-handler.ts`, `apps/server/src/__tests__/error-handler.test.ts`
- **Change**: `isJwtError()` used an explicit 6-code list + fragile message-based fallback (`"Authorization token expired"`, `"Authorization token is invalid"` — configurable strings from `@fastify/jwt`). Replaced with prefix-based detection: `code.startsWith("FST_JWT_") || code.startsWith("FAST_JWT_")`. Catches all current AND future error codes automatically. Removed message-based fallback. Added 3 tests (prefix detection, future code, negative case), removed 2 obsolete message-based tests. Net: 30→31 tests.
- **Verified**: PASS (type-check clean, 31/31 tests green)

---

## Phase 4: Frontend Modernization — Batch 3

### 4.3 — TanStack Query migration
- **Date**: 2026-04-29
- **Created files**: `query-client.ts` (smart retry, staleTime: 30s, gcTime: 5min), `query-keys.ts` (hierarchical key factory, 10 domains), `query-provider.tsx` (client wrapper + devtools), `use-enabled-providers.ts` (shared hook)
- **Migrated 13 hooks**: useShares, useTrustedDevices, useProfile, useUserManagement, useReverseShares, useAuthProviders, useSecureConfigs/useAdminConfigs/useSecureConfigValue, useDashboard, useTwoFactor, useReverseShareUpload, useLogin, useForgotPassword, useFileBrowser, usePublicShare
- **Migrated 6 components**: login-form, multi-provider-buttons (→ shared useEnabledProviders), share-details-modal, media-embed-link, embed-code-display, register-with-invite page
- **Pattern**: reads → useQuery (auto-fetch, caching, smart retry), mutations → useMutation (cache invalidation). Optimistic updates via setQueryData for drag reorder, avatar upload, file browser.
- **Tests added**: 28 new tests across 5 test files
- **Verified**: PASS (web type-check clean, 116/116 tests, API 31/31 tests)

### 4.4 — Axios 401 response interceptor
- **Date**: 2026-04-29
- **File**: `apps/web/src/config/api.ts`
- **Change**: Axios response interceptor. 401 → hard-nav to `/login`. Skips auth endpoints + public pages. `isRedirecting` flag prevents cascading.
- **Verified**: PASS

### 4.5 — State management unification
- **Date**: 2026-04-29
- **Changes**: useAppInfo zustand → TQ hook (staleTime: 60s). AuthContext → backed by 2 TQ queries. ShareContext → eliminated (consumers use useSecureConfigValue directly). useHomeStore zustand → eliminated (derived state).
- **File deleted**: `apps/web/src/contexts/share-context.tsx`
- **Verified**: PASS (web 116/116, API 31/31)

### 4.6 — Lazy-load Google Fonts
- **Date**: 2026-04-29
- **File**: `apps/web/src/app/layout.tsx`
- **Change**: Added `preload: false` to all 10 non-default font declarations (Inter, Roboto, Open Sans, Poppins, Nunito, Lato, Montserrat, Source Sans 3, Raleway, Work Sans). Default font (Outfit) keeps `preload: true`. Fonts remain self-hosted via `next/font/google` but browsers only download the one actually used by `--custom-font-family`.
- **Verified**: PASS

### 4.7 — Dynamic imports for heavy components
- **Date**: 2026-04-29
- **Changes**:
  - **Critical fix**: `icon-picker.tsx` imported ALL 31 react-icons packs at module scope (~40k icons). Created `DynamicIcon` component (`dynamic-icon.tsx`, 115L) that lazily loads single icons by pack prefix via explicit `switch`-based `import()`. Prefix-to-pack mapping handles tricky prefixes (Fa6, Hi2, Io5, Lia, Tfi, Vsc). Module-level cache avoids re-imports.
  - `renderIconByName` removed from `icon-picker.tsx`. Consumers (`multi-provider-buttons.tsx`, `auth-providers-settings.tsx`) migrated to `<DynamicIcon>`.
  - `IconPicker` wrapped with `next/dynamic` (`ssr: false`) in `edit-provider-form.tsx` and `add-provider-form.tsx` — 31-pack import is now a lazy chunk only loaded when admin opens the icon picker dialog.
  - Created `lazy-qr-code.tsx` — `next/dynamic` wrapper for `react-qr-code`. 6 modal files migrated from `QRCodeSVG` to `LazyQRCode`.
  - Created `lazy-image-crop.tsx` — `next/dynamic` wrapper for `react-image-crop`. `image-edit-modal.tsx` migrated.
- **Files created**: `dynamic-icon.tsx`, `lazy-qr-code.tsx`, `lazy-image-crop.tsx`
- **Files modified**: 13 consumer files
- **Bundle impact**: Login page no longer pulls in ANY react-icons pack. QR code library only loads when modal opens.
- **Verified**: PASS (web type-check exit 0, 116/116 tests)

### 4.8 — Replace `<img>` with `next/image`
- **Date**: 2026-04-29
- **Changes**: Replaced raw `<img>` tags with `<Image>` from `next/image` in 7 files. All use `unoptimized` prop (presigned URLs, blob URLs, `/api/` proxied URLs, data URIs cannot be optimized by Next.js image optimizer).
- **Files**: `files-grid-file-card.tsx` (fill), `logo-input.tsx` (200×200), `image-preview.tsx` (fill for both thumbnail and fullscreen), `two-factor-form.tsx` (192×192), `share-header.tsx` (32×32), `default-layout.tsx` (32×32), `navbar.tsx` (32×32)
- **Skipped**: `embed-code-display.tsx` (string literal, not JSX)
- **Verified**: PASS

### 4.9 — Skip-to-content link
- **Date**: 2026-04-29
- **Files**: `apps/web/src/components/skip-to-content.tsx` (NEW), `apps/web/src/app/layout.tsx`, `apps/web/src/app/(shares)/s/[alias]/layout.tsx`, `apps/web/src/app/(shares)/r/[id]/layout.tsx`, `apps/web/messages/en-US.json`
- **Change**: Created `skip-to-content.tsx` (16L) as first focusable element. Added `<main id="main-content" tabIndex={-1}>` to root layout wrapping children. Fixed 2 existing `<main>` elements on share pages to include `id="main-content"`. i18n keys in `a11y` namespace.
- **Verified**: PASS

### 4.10 — Route announcer
- **Date**: 2026-04-29
- **Files**: `apps/web/src/components/route-announcer.tsx` (NEW), `apps/web/src/app/layout.tsx`
- **Change**: Created `route-announcer.tsx` (34L) — listens to `usePathname()`, announces page title via `aria-live="assertive"` region after 100ms delay. Wired into root layout.
- **Verified**: PASS

### 4.11 — Keyboard DnD alternative
- **Date**: 2026-04-29
- **Assessment**: Already implemented — bulk move via checkbox selection + "Move" button in bulk actions dropdown was built during 4.14 (use-selection-manager). Auth provider reordering uses @hello-pangea/dnd which has built-in keyboard support. No additional work needed.
- **Verified**: PASS

### 4.12 — RTL fix
- **Date**: 2026-04-29
- **Files**: `apps/web/src/lib/rtl-languages.ts` (NEW), `apps/web/src/app/layout.tsx`, `apps/web/src/components/language-switcher.tsx`, 73 files with directional Tailwind replacements
- **Change**: Created shared `rtl-languages.ts` constant (`["ar-SA", "fa-IR", "he-IL"]`). Fixed server-side detection in `layout.tsx` (was only `ar-SA`, now includes all 3). Replaced 191 directional Tailwind classes across 73 files with logical property equivalents: `ml-`→`ms-`, `mr-`→`me-`, `pl-`→`ps-`, `pr-`→`pe-`, `left-`→`start-`, `right-`→`end-`, `text-left`→`text-start`, `text-right`→`text-end`. Fixed inline style `marginRight` → `marginInlineEnd` in language-switcher.
- **Verified**: PASS

### 6.13 — JWT_SECRET environment variable (pulled forward from Phase 6)
- Made `JWT_SECRET` a mandatory env var in server's `env.ts` (min 32 chars)
- Removed DB-stored jwtSecret from `app.ts` (no more `prisma.appConfig.findUnique`), `seed.js`, and `infra/configs.json`
- Removed 4 jwtSecret guards from `app/service.ts` (no longer in DB = no need to filter/protect)
- Updated `.env.example` files for both server and web

### 4.13 — Next.js middleware route protection
- Created `apps/web/src/middleware.ts` (99 lines) using `jose` library (Edge Runtime compatible)
- Full JWT verification when `JWT_SECRET` env var is set (`jwtVerify`), graceful fallback to decode-only when not (`decodeJwt`)
- Route classification: home (auth → dashboard), public paths (always allow), unauthenticated-only (auth → dashboard), admin paths (non-admin → dashboard), protected (no auth → login)
- Invalid/expired tokens: cookie cleared + redirect to /login
- Matcher excludes: `_next/*`, `api/*`, `e/*`, static files
- Imports path lists from existing `public-paths.ts` and `unauthenticated-only-paths.ts` (single source of truth)
- `RedirectHandler` and `ProtectedRoute` kept as defense-in-depth safety nets

---

## Phase 4 — Post-Review Remediation (2026-05-08)

39 review findings from 3 reviewer agents fixed across 8 tasks.

### Task 1: Middleware Security Hardening
- C-C1: Removed `decodeJwt` fallback, pinned HS256, created `apps/web/src/env.ts` (Zod, min 32 chars)
- C-C3: Created `matchesPath()` at `apps/web/src/components/auth/paths/match-path.ts` (exact + slash-boundary)
- C-I5: Web app `JWT_SECRET` validated at startup via Zod schema
- C-I6: `jwtVerify` pinned to `algorithms: ["HS256"]`
- C-M2: `redirect-handler.tsx` updated to use `matchesPath`
- 30 tests in `apps/web/src/__tests__/middleware.test.ts`

### Task 2: Translation Fixes
- C-C2: `a11y` namespace moved to top-level in all 23 locale files; nested copy removed
- A-I1: 13 `errors` keys + 1 `a11y` key added to 22 non-en-US locales (English placeholders)
- Recursive locale parity test with orphan detection: `apps/web/src/__tests__/locale-keys.test.ts`

### Task 3: Auth Context Cleanup
- B-I1: AuthProvider rewritten with useMemo derivation, no more setters in context API
- B-I1: useLogin/callback flows use setQueryData+invalidateQueries; no manual state writes
- B-I1: logout() now clears both currentUser AND app.info queries
- B-I1: Pre-existing data shape mismatch in use-profile.ts fixed
- B-I5: Deleted dead `useAppInfo.getState` shim + `refreshAppInfoOutsideReact`; cleaned layout.tsx
- B-I6: Removed `zustand` from `apps/web/package.json`
- B-I9: Created `apps/web/src/hooks/use-app-info-query.ts` (single staleTime)
- 9 tests in `apps/web/src/contexts/__tests__/auth-context.test.tsx`

### Task 4: Navigation & API Fixes
- B-I2: Replaced `hasSyncedUrlRef` with useEffect on `[urlFolderSlug, dataLoaded, allFolders]`
- B-I2: Replaced `window.history.pushState` with `router.push` (root cause of back/forward bug)
- B-I3: Added `?reason=session_expired` to 401 redirect, 5s safety timeout, session-expired toast
- B-I3: `matchesPath` used in `api.ts` for public page detection
- 21 tests across 3 new test files

### Task 5: RTL & A11y Fixes
- C-I1: Deleted `route-announcer.tsx`; removed orphan `routeChanged` key from all 23 locales
- C-I3: Fixed physical borders in `sheet.tsx`, `scroll-area.tsx`, `input-otp.tsx`
- C-I4: Reverted animation classes to physical in dropdown-menu, context-menu, select (Radix data-side is physical)
- C-M5: Fixed "end-to-left" → "right-to-left" comment in `rtl-languages.ts`
- C-M6: Replaced 16 `focus:` with `focus-visible:` in `skip-to-content.tsx`

### Task 6: Error Display & Types
- A-M1: Renamed ErrorDisplay variants: `inline`→`card`, `minimal`→`inline` (all 7 consumers + tests updated)
- A-I4: Share not-found uses `variant="page"` instead of `variant="inline"`
- A-I2: Removed redundant `Number(item.size)` cast
- A-I3: Removed 3 dead `eslint-disable` comments

### Task 7: Dead Code, BOM & Lint Cleanup
- A-M2: Deleted dead `ShareContentTable = ShareFilesTable` alias
- A-M3: Replaced inline `formatDateTime` copy with import in share `files-table.tsx`
- A-M4: Removed `BulkFolder = FolderItem` alias (~16 occurrences replaced)
- A-M7: Wrapped `fileIds`/`folderIds` in useMemo in `use-selection-manager.ts`
- C-I7: Stripped UTF-8 BOM from 73 files
- Added `.editorconfig` at repo root

### Task 8: TQ Polish & Remaining Fixes
- C-M4: Fixed Polish locale typo `ps-PL` → `pl-PL` in `i18n/request.ts`
- B-I4: LoginForm passes `enabled: !firstAccess` to `useEnabledProviders`
- C-M1: QR code download uses ref-based querySelector instead of getElementById
- A-M5: `formatDateTime` accepts optional `locale` parameter; all callers pass `useLocale()`
- B-minor: Standardized Axios error checking to `axios.isAxiosError()` in 3 files
- B-minor: Removed unused `folderId` parameter from `queryKeys.files.list()`
- Lazy ReactQueryDevtools behind `next/dynamic` + NODE_ENV guard
- B-I7: `use-public-share.ts` browseState replaced with useMemo derivation
- A-M6: `useEditableItem.saveEdit` is async; reverts pending change on callback failure
- Password modal derived from `!share && isPasswordRequired(shareQuery.error)`

---

## Phase 5: Backend Hardening

**Date**: 2026-05-11/12
**Verification**: `pnpm validate` passes, 174 server tests, 190 web tests, 11 shared tests — all green.

### Task 1 — Server Config Hardening (5.7, 5.8, 5.9, 5.12, 5.18-5.21)
- 5.9: `Math.random()` → `crypto.randomUUID()` in 3 files
- 5.12: `PORT` env var with Zod coercion
- 5.7: `TRUST_PROXY` env var + `parseTrustProxy()` helper (extracted to `utils/parse-trust-proxy.ts` + 7 tests)
- 5.8: `ENABLE_API_DOCS` gating for Swagger (4 behavioral tests)
- 5.18: `@fastify/helmet` with restrictive CSP + HSTS (conditional CSP for Swagger docs)
- 5.19: `bodyLimit` 64KB on auth + admin config routes (extracted constants)
- 5.20: CORS fail-fast in production (throw Error)
- 5.21: `PRESIGNED_GET_URL_EXPIRATION` (900s) for downloads, split from upload expiry

### Task 2 — Filename/Content-Disposition Hardening (5.17, 5.3, 5.10)
- 5.17: `extractFilenameFromContentDisposition` rewritten as two-pass RFC 5987 parser (9 tests)
- 5.10: `sanitizeFilename` utility (path seps, null bytes, dots, Windows reserved, 255-byte truncation) + 10 tests
- 5.3: `LoginSchema` deleted, replaced with `LoginInput` interface

### Task 3 — Admin Detection, Proxy Cookie, OAuth Redirect (5.6, 5.14, 5.15)
- 5.6: `adminPreValidation` fixed: `usersCount === 0` (was `<= 1`)
- 5.14: `cookie: false` on 8 public proxy routes
- 5.15: `isAllowedRedirectUrl` with same-origin check + OAuth host allowlist + env extension (7 tests)

### Task 4 — 2FA Disable Hardening (5.13)
- `disable2FA` requires TOTP code or backup code (3 tests)
- Frontend: TOTP input in disable modal, 23 locale files updated

### Task 5 — CSRF Protection + Timing-Safe (5.4, 5.22)
- `@fastify/csrf-protection` with double-submit cookie, `CSRF_SECRET` env var
- Per-route `config: { csrfExempt: true }` on 17 routes (replaced fragile URL matching)
- `csrf.config.ts` for centralized exempt routes
- `timing-safe.ts` utility for backup code comparisons (6 tests)
- Frontend CSRF interceptor with dedup
- 12+ CSRF tests including rotation, real routes, per-route config

### Task 6 — File Content Validation (5.1, 5.2)
- `validate-file-content.ts`: MIME consistency + magic-byte verification (16 tests)
- `getObjectHead` ranged GET on S3 provider + StorageProvider interface
- `validateObjectName` extracted + applied in file controller and upload service (6 tests)
- `maxFileSize` returned in presigned URL response (route schema updated)
- 5 integration tests for validation pipeline

### Task 7 — AppError Hierarchy + Controller/Service Migrations (5.11, 5.16)
- `AppError` base + 6 subclasses (NotFoundError, ValidationError, ForbiddenError, UnauthorizedError, ConflictError, GoneError) + 10 tests
- `globalErrorHandler` updated: AppError branch first (7 tests)
- All 17 controllers migrated (including embed.controller.ts)
- All 17 services migrated to throw AppError directly
- 3 mapper functions removed
- `ErrorResponseSchema` shared across ~176 route error schemas (13 route files)
- 13 preValidation hooks converted to throw AppError (15 files)

### Task 8 — Token Rotation + Account Lockout (5.23, 5.25)
- `tokenVersion` on User, validated via `@fastify/jwt` `trusted` callback (30s cache)
- Incremented on password/isAdmin/isActive/2FA changes + user deactivation
- `LoginAttempt` model (per-email), lockout after 10 failures for 15 min (9 tests)
- Hourly cleanup interval

### Task 9 — Refresh Tokens + Audit Logging (5.26, 5.24)
- `RefreshToken` model, rotation with replay detection (conditional updateMany)
- JWT 15-min expiry, httpOnly refresh cookie (unified for password + OIDC login)
- `POST /auth/refresh` endpoint (rate-limited, CSRF-exempt), 13 integration tests
- Logout revokes all refresh tokens
- `AuditLog` model, 11 audit actions, 8 logging locations (5 tests)
- `GET /admin/audit-logs` admin endpoint (paginated, filterable, 5 integration tests)
- Frontend 401 interceptor with refresh-before-redirect (5 tests)

### Review Follow-ups (all resolved)
- Batch 1: parseTrustProxy extracted + tested, decodeURIComponent try/catch, bespoke sanitizers consolidated
- Batch 2: BOM stripped, CSRF exemptions fixed, route schema sync, trailing-slash, backup code normalization
- Batch 3: embed.controller migrated, validateObjectName extracted, client-unsafe messages fixed
- Batch 4: tokenVersion on privilege changes, refresh rotation race fix, httpOnly cookie unification, OIDC cookie maxAge, logout revocation, audit-logs auth hardened
- Backlog: 42+ items across 6 agent passes — all resolved (0 deferred)

### Final Review Fixes
- 5.5: JWT cookie signing (`signed: true`, `COOKIE_SECRET` env var with 3 Zod refines)
- I-1: Portuguese error messages → English in file/dto.ts, folder/dto.ts, 4 routes.ts files
- I-2: Documented email-only lockout design in isAccountLocked JSDoc
- M-1: Removed unnecessary async from generateBackupCodes
- M-2: Documented accepted timing leak in backup code findIndex
- M-3: Documented defense-in-depth double isAccountLocked check
- M-5: Extracted refresh token cookie constants to auth.config.ts

---

## Phase 6 — Infrastructure & Operations (2026-05-12)

Migrated from monolith supervisord container (MinIO+API+Web) to 3-container Docker Compose
architecture (RustFS storage + Fastify server + Next.js web). 16 items (6.1-6.16) completed.

### 6.1-6.9 — Docker + MinIO items (replaced by 3-container architecture)
- **Date**: 2026-05-12
- **Change**: All 9 items eliminated by architectural migration. Supervisord removed. Single Dockerfile
  with two build targets (`server-runner`, `web-runner`). RustFS uses official `rustfs/rustfs:latest` image.
  Docker Compose with healthcheck-based startup ordering (`storage` → `server` → `web`).
- **Files deleted**: `infra/install-minio.sh`, `infra/start-minio.sh`, `infra/minio-setup.sh`,
  `infra/load-minio-credentials.sh`, `infra/install-mc.sh`, `infra/supervisord.conf`
- **Files rewritten**: `Dockerfile` (287 → 121 lines), `docker-compose.yaml` (55 → 118 lines, 3 services),
  `infra/server-start.sh` (147 → 80 lines)

### 6.10 — Delete build-docker.sh
- **Date**: 2026-05-12
- **Change**: `infra/build-docker.sh` deleted. Docker builds via `docker compose build` or `just docker-build`.
- **Verified**: PASS

### 6.11 — Structured health endpoint
- **Date**: 2026-05-12
- **Files**: `apps/server/src/modules/health/controller.ts`, `apps/server/src/modules/health/routes.ts`
- **Change**: Enhanced with DB check (`prisma.$queryRaw`) + S3 check (`HeadBucketCommand`).
  Returns `{ status, timestamp, uptime, checks: { database, storage } }`. 200=healthy, 503=degraded.
- **Verified**: PASS (4 integration tests)

### 6.12 — Docker Compose healthchecks
- **Date**: 2026-05-12
- **Change**: All 3 services have healthchecks. `depends_on: { condition: service_healthy }` for
  startup ordering. Storage → Server → Web.
- **Verified**: PASS (`docker compose config` validates)

### 6.14 — Remove SMTP placeholder credentials
- **Date**: 2026-05-12
- **Files**: `apps/server/prisma/seed.js`
- **Change**: smtpHost→`""`, smtpUser→`""`, smtpPass→`""`, smtpFromName→`"Ouitransfer"`, smtpFromEmail→`""`
- **Verified**: PASS

### 6.15 — Evaluate pnpm deploy
- **Date**: 2026-05-12
- **Change**: Evaluated during Dockerfile rewrite. Current approach (workspace symlinks + COPY) works
  correctly with `--ignore-scripts` flag. pnpm deploy not needed — symlink resolution verified in
  Docker build tests for both targets.
- **Verified**: PASS (both Docker targets build successfully)

### 6.16 — Lefthook Windows fix
- **Date**: 2026-05-12
- **Change**: Already fixed — `lefthook.yml` uses Biome's `--staged` flag instead of `{staged_files}`
  placeholder. No changes needed.
- **Verified**: PASS

### Additional changes (storage modernization)
- `apps/server/src/config/storage.config.ts`: Removed `loadInternalStorageCredentials()` (file reading),
  extracted `buildEndpointUrl()` DRY helper, added `ensureBucket()` using HeadBucket/CreateBucket.
- `apps/server/src/server.ts`: `ensureBucket()` called at startup after DB migration.
- `.env.example`: Updated for RustFS and 3-container architecture.
- `Justfile`: Docker recipes updated for 3 services.
- 8 TS files: Garage/MinIO comments → S3-compatible.
- User-facing docs: `quick-start.mdx`, `s3-providers.mdx`, `manual-installation.mdx`, `architecture.mdx`,
  `uid-gid-configuration.mdx` all updated for RustFS and 3-container architecture.

### Dead code removed
- `apps/server/src/scripts/migrate-filesystem-to-s3.ts` (335 lines) — deleted, no production users
- `runAutoMigration()` import/call removed from `server.ts`
- `ENCRYPTION_KEY`/`DISABLE_FILESYSTEM_ENCRYPTION` env vars deleted from `env.ts`

### Phase 6 Post-Review Remediation
27 review findings (4 Critical + 4 Legacy + 9 Important + 8 Minor), all resolved.
See `audit/TODO-POST-PHASE-6.md`.

### Phase 5 Quality Audit (post-completion)
Systematic review found 13 issues (3 Critical, 7 Important, 3 Minor). All resolved.
Full report: `audit/TODO-PHASE-5-QUALITY-AUDIT.md`
- QA-C1: auth-providers error schemas → ErrorResponseSchema (was causing 500 instead of 401/403)
- QA-C2: auth-providers adminPreValidation `<= 1` → `=== 0` (unfixed security bug)
- QA-C3: /auth/refresh reply.send() → throw UnauthorizedError
- QA-I1: Extracted shared `createAdminPreValidation` middleware (3 copies → 1 shared)
- QA-I2: s3-storage routes: added 401/500 error schemas
- QA-I3: invite route: replaced inline preValidation with shared adminPreValidation
- QA-I4: invite route: added 401 error schema
- QA-I5: Removed 31 redundant jwtVerify() calls from 5 controllers
- QA-I6: storage routes: added preValidation hooks (was auth-only-in-controller)
- QA-I7: Added 11 integration tests for adminPreValidation middleware
- QA-M1: Fixed 9 preValidation hooks: log level error → warn
- QA-M2: share/controller.ts: optional JWT failure log error → debug
- QA-M3: Added error schemas to storage and s3-storage routes

---

## Phase 7: Dependency Modernization

### 7.4 — Consolidate icon libraries (@tabler/icons-react → lucide-react + react-icons/tb)
- **Date**: 2026-05-12
- **Files**: ~122 source files in `apps/web/src/`, `apps/web/package.json`
- **Change**: Migrated ~85 non-brand icons to `lucide-react`, 17 brand icons to `react-icons/tb`. Removed `@tabler/icons-react` from dependencies. Created union type in `file-icons.tsx`. Fixed Link/LinkIcon naming collision.
- **Verified**: PASS — 203 web tests, type-check clean, 0 tabler imports remain

### 7.5 — Remove node-fetch, use native fetch
- **Date**: 2026-05-12
- **Files**: `apps/server/package.json`
- **Change**: Removed `node-fetch` from dependencies (zero imports, Node 24 has native fetch)
- **Verified**: PASS — 192 server tests, type-check clean

### 7.6 — Remove redundant ts-node, keep only tsx
- **Date**: 2026-05-12
- **Files**: `apps/server/package.json`, `knip.json`
- **Change**: Removed `ts-node` from devDependencies, removed from Knip `ignoreDependencies`
- **Verified**: PASS

### 7.7 — Replace nookies with native document.cookie
- **Date**: 2026-05-12
- **Files**: `apps/web/src/components/general/language-switcher.tsx`, `apps/web/package.json`
- **Change**: Replaced `setCookie` from nookies with native `document.cookie` assignment (SameSite=Lax, conditional Secure, encodeURIComponent). Removed `nookies` package.
- **Verified**: PASS

### 7.8 — Rename framer-motion to motion
- **Date**: 2026-05-12
- **Files**: `apps/web/package.json`, 9 source files
- **Change**: Replaced `framer-motion` with `motion` package. Updated all imports from `"framer-motion"` to `"motion/react"`.
- **Verified**: PASS — all 3 app type-checks clean

### 7.9 — Remove @types/react-dropzone (react-dropzone ships own types)
- **Date**: 2026-05-12
- **Files**: `apps/web/package.json`
- **Change**: Removed `@types/react-dropzone` from dependencies (react-dropzone v14+ ships own types)
- **Verified**: PASS

### 7.10 — Prisma CLI and Client versions already aligned
- **Date**: 2026-05-12
- **Verified**: Both at `^6.11.0`, no change needed

### 7.11 — Remove unused openid-client
- **Date**: 2026-05-12
- **Files**: `apps/server/package.json`
- **Change**: Removed `openid-client` (zero imports, OAuth uses manual fetch)
- **Verified**: PASS

### 7.12 — Remove unused js-cookie + @types/js-cookie
- **Date**: 2026-05-12
- **Files**: `apps/web/package.json`
- **Change**: Removed `js-cookie` and `@types/js-cookie` (installed but never imported)
- **Verified**: PASS

### 7.13 — Add motion + jose to pnpm catalog
- **Date**: 2026-05-12
- **Files**: `pnpm-workspace.yaml`, `apps/web/package.json`, `apps/docs/package.json`, `apps/server/package.json`
- **Change**: Added `motion: "^12.23.0"` and `jose: "^5.10.0"` to catalog. Updated all consumers to `catalog:`.
- **Verified**: PASS

### 7.14 — Replace date-fns with Intl.DateTimeFormat (formatDateTime)
- **Date**: 2026-05-12
- **Files**: 4 source files, `apps/web/package.json`
- **Change**: Replaced `date-fns` `format()` with `formatDateTime()` (Intl-based) in shares-table, share-details-modal, received-files-file-row, share-details. Fixed hardcoded `ptBR` locale bug. Removed `date-fns`. Added 13 `formatDateTime` locale tests.
- **Verified**: PASS — 203 web tests

### Review follow-ups
- M-3 (encodeURIComponent cookie value): Fixed inline
- M-4 (knip unused deps): Investigated 7 deps. Removed `@fastify/static` (server), `qrcode` + `@types/qrcode` (web), `class-variance-authority` (docs). Kept `@radix-ui/react-collapsible` (shadcn/ui primitive), `tw-animate-css` (used in CSS), `tailwindcss` (build tool).
- M-5 (formatDateTime locale tests): 13 tests added
- M-1 (hardcoded "Move" label): Forwarded to Phase 8
- M-2 (icon semantic equivalents): Forwarded to Phase 8

---

## Phase 8: Polish & Production Readiness

### 8.1 — Add LICENSE file
- **Date**: 2026-05-13
- **Files**: `LICENSE` (new)
- **Change**: Created Apache-2.0 license file. Copyright "Ouitransfer Contributors", 2024-present.
- **Verified**: PASS

### 8.2 — Update CONTRIBUTING.md
- **Date**: 2026-05-13
- **Files**: `CONTRIBUTING.md`
- **Change**: Complete rewrite. Dev-focused guide with prerequisites, setup, just commands, code standards, testing, PR process, architecture notes. Generic GitHub tutorial removed.
- **Verified**: PASS

### 8.3 — Add architecture READMEs
- **Date**: 2026-05-13
- **Files**: `apps/server/src/README.md` (new), `apps/web/src/README.md` (new)
- **Change**: Server: module structure, config, providers, validation, auth, how-to guide. Web: App Router, TanStack Query, proxy, auth, i18n, UI stack, how-to guide.
- **Verified**: PASS

### 8.4 — Implement upload resume for multipart uploads
- **Date**: 2026-05-13
- **Files**: 16 files (full stack)
- **Change**: Full-stack S3 ListParts implementation. Server: StorageProvider interface + S3 provider + FileService + multipart controller + routes. Reverse-share: service + controller + POST route (CSRF exempt). Frontend: proxy routes + HTTP endpoint types/functions + Uppy listParts callback (replaces return [] stub). 7 integration tests.
- **Verified**: PASS — 199 server + 203 web tests

### 8.5 — Lighthouse CI
- **Date**: 2026-05-13
- **Files**: `.lighthouserc.cjs` (new), `package.json`
- **Change**: Created Lighthouse CI config (2 URLs, 3 runs, thresholds). Added `@lhci/cli` devDep and `lighthouse` script.
- **Verified**: PASS

### 8.6 — Bundle analyzer
- **Date**: 2026-05-13
- **Files**: `apps/web/next.config.ts`, `apps/web/package.json`
- **Change**: Added `@next/bundle-analyzer` with `withBundleAnalyzer` wrapper (conditional on `ANALYZE=true`). Added `analyze` script.
- **Verified**: PASS

### 8.7 — pnpm audit + dependency security
- **Date**: 2026-05-13
- **Files**: `apps/server/package.json`, `apps/web/package.json`, `pnpm-workspace.yaml`, `.github/workflows/ci.yml`
- **Change**: Fixed 34 vulnerabilities (3 crit → 0, 15 high → 3 unfixable transitive). Upgraded @fastify/jwt 9→10, nodemailer 6→8, axios →1.15.2, next →15.5.18. Added CI audit job (continue-on-error for transitive vulns).
- **Verified**: PASS — 192 server tests, all type-checks clean

### 8.8 — Security headers via Fastify — CLOSED
- **Date**: 2026-05-13
- **Change**: Already configured. Helmet registered with CSP, HSTS 1yr, frameAncestors none.
- **Verified**: N/A — already done

### 8.9 — Frontend CSP
- **Date**: 2026-05-13
- **Files**: `apps/web/src/middleware.ts`, `apps/web/src/env.ts`
- **Change**: Added `addSecurityHeaders()` helper with 5 headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, CSP with 9 directives). Dynamic `connect-src` via `CSP_CONNECT_SOURCES` env var for S3 presigned uploads. All 7 response paths wrapped.
- **Verified**: PASS — 208 web tests

### 8.10 — Frontend env validation
- **Date**: 2026-05-13
- **Files**: `apps/web/src/env.ts`, `apps/web/src/lib/proxy.ts`
- **Change**: Expanded env.ts from 10→31 lines. Added API_BASE_URL (URL-validated, trailing slash stripped), OAUTH_ALLOWED_REDIRECT_HOSTS, ALLOWED_IMAGE_HOSTS, CSP_CONNECT_SOURCES. proxy.ts uses validated env.
- **Verified**: PASS

### 8.11 — Server timeout hardening
- **Date**: 2026-05-13
- **Files**: `apps/server/src/config/timeout.config.ts`, `apps/server/src/app.ts`
- **Change**: connectionTimeout 0→30s, keepAlive 20h→30s, requestTimeout 0→4h, server.timeout 0→requestTimeout. Removed res/req.setTimeout(0) from serverFactory.
- **Verified**: PASS — 192 server tests

### 8.12 — a11y testing
- **Date**: 2026-05-13
- **Files**: `e2e/smoke.spec.ts`, `package.json`
- **Change**: Added @axe-core/playwright. 2 new a11y tests (homepage + login) with wcag2a/wcag2aa tags.
- **Verified**: PASS

### 8.13 — OAuth proxy test coverage
- **Date**: 2026-05-13
- **Files**: `apps/web/src/lib/__tests__/proxy-oauth-redirect.test.ts`
- **Change**: 3 new tests: all 6 OAuth hosts coverage, empty string URL, credentials-in-URL attack pattern.
- **Verified**: PASS — 208 web tests

### 8.14 — Route matcher performance — CLOSED
- **Date**: 2026-05-13
- **Change**: Evaluated. O(n) with n=124 routes is microseconds per request. Optimization not warranted.
- **Verified**: N/A

### 8.16 — Expand health + smoke tests
- **Date**: 2026-05-13
- **Files**: `apps/server/src/__tests__/health.test.ts`, `apps/web/src/__tests__/smoke.test.tsx`
- **Change**: Health: 5 new tests (uptime, timestamp, 404, both-unhealthy with getter-based mock). Smoke: replaced 3 Button tests with 6 formatFileSize unit tests.
- **Verified**: PASS — 203 server + 208 web tests

### 8.17 + 8.18 — Frontend logger JSDoc + rename
- **Date**: 2026-05-13
- **Files**: `apps/web/src/lib/logger.ts`
- **Change**: Added full module JSDoc (clarifies: client-side level-filtered console wrapper, NOT structured logger). Added LogContext interface. API surface unchanged.
- **Verified**: PASS

### 8.19 — Translate placeholder strings
- **Date**: 2026-05-13
- **Files**: 12 locale files (fr-FR, de-DE, es-ES, it-IT, pt-BR, nl-NL, pl-PL, ru-RU, tr-TR, sv-SE, el-GR, uk-UA)
- **Change**: 15 keys translated per locale (errors.*, a11y.skipToContent, auth.sessionExpired). 10 exotic locales left with English per user decision.
- **Verified**: PASS

### 8.20 — E2E CI workflow
- **Date**: 2026-05-13
- **Files**: `.github/workflows/e2e.yml`, `playwright.config.ts`
- **Change**: Removed `if: false`. Added Docker Compose start, health wait, DB seed, artifact upload, cleanup. Playwright webServer conditionally omitted in CI.
- **Verified**: PASS

### 8.21 — Test coverage reporting — SKIPPED
- **Date**: 2026-05-13
- **Change**: Skipped per user decision. Coverage reporting deferred to maintenance phase.

### 8.22 — ConfigService refactor
- **Date**: 2026-05-13
- **Files**: `apps/server/src/modules/config/service.ts`, 12 server files, `apps/server/src/utils/app-error.ts`
- **Change**: Replaced ConfigService class with 5 standalone exported functions. Added try/catch around JSON.parse in getGroupConfigs → throws InternalError. Added InternalError class. Updated 12 server files and 3 test mocks.
- **Verified**: PASS — 192 server + 203 web tests

### Portuguese comments cleanup (new item)
- **Date**: 2026-05-13
- **Files**: 11 files across server and web
- **Change**: 33 Portuguese comments/strings translated to English across useUppyUpload.ts, V3BetaModal.tsx, providers.config.ts (12 JSDoc blocks), share/dto.ts, reverse-share/dto.ts, use-settings.ts (2 dead strings removed), default-layout.tsx, edit-password-modal.tsx, reverse-share-card.tsx, delete-reverse-share-modal.tsx, reverse-share-details-modal.tsx.
- **Verified**: PASS

### Phase 7 M-1 — Hardcoded "Move" label
- **Date**: 2026-05-13
- **Files**: `apps/web/src/components/tables/files-table-folder-row.tsx`
- **Change**: `label: "Move"` → `label: t("common.move")` (key already exists in all 23 locales)
- **Verified**: PASS

### Phase 7 M-2 — GraphQL/Proto icon semantic fix
- **Date**: 2026-05-13
- **Files**: `apps/web/src/utils/file-icons.tsx`
- **Change**: graphql/gql → Braces icon (pink-600), proto/protobuf → FileCode icon (blue-700). Removed Webhook import.
- **Verified**: PASS

### Review follow-ups
- C-1 (CSP connect-src blocks S3 uploads): Added CSP_CONNECT_SOURCES env var, dynamic connect-src in middleware
- I-1 (missed Portuguese strings): Fixed 4 strings in file/service.ts and folder/service.ts
- I-2 (multipart objectName validation): Added validateObjectName() in all 4 multipart controller methods
- I-3 (E2E workflow secrets pattern): Replaced ${{ secrets || fallback }} with plain test values
- M-1 (audit CI transitive vulns): Added continue-on-error: true
- M-2 (Lighthouse uses dev server): Acceptable for regression tracking, no change
- M-3 (next.config.ts process.env): Build-time config, by design, no change
- M-4 (stale smoke test comment): Simplified

---

## Phase 9: Documentation Site Overhaul

### 9.1 — Rewrite architecture.mdx for S3-first architecture
- **Date**: 2026-05-13
- **Files**: `apps/docs/content/docs/v3-beta/architecture.mdx`
- **Change**: Rewrote storage section (filesystem → S3/RustFS), added Docker architecture table (3 containers), added security secrets section, removed encryption cruft (AES-NI, DISABLE_FILESYSTEM_ENCRYPTION)
- **Verified**: PASS

### 9.2 — Fix password-reset-without-smtp.mdx for 3-container architecture
- **Date**: 2026-05-13
- **Files**: `apps/docs/content/docs/v3-beta/password-reset-without-smtp.mdx`
- **Change**: Container name fix (ouitransfer-app → ouitransfer-server), docker logs fix, pnpm commands, added server container note
- **Verified**: PASS

### 9.3 — Update api.mdx — remove monolith Docker examples
- **Date**: 2026-05-13
- **Files**: `apps/docs/content/docs/v3-beta/api.mdx`
- **Change**: Replaced monolith Docker examples with 3-container architecture, fixed image/volume references, removed filesystem capability, added CSRF protection note
- **Verified**: PASS

### 9.4 — Fix container names and port in reverse-proxy-configuration.mdx
- **Date**: 2026-05-13
- **Files**: `apps/docs/content/docs/v3-beta/reverse-proxy-configuration.mdx`
- **Change**: Fixed container names, health endpoint (port 5487→3333, /api/health→/health), added STORAGE_URL and CSP_CONNECT_SOURCES guidance
- **Verified**: PASS

### 9.5 — Update github-architecture.mdx for current stack
- **Date**: 2026-05-13
- **Files**: `apps/docs/content/docs/v3-beta/github-architecture.mdx`
- **Change**: React 18→19, TailwindCSS→Tailwind CSS 4, added Node 24/pnpm 10.6.0, added packages/ to project tree, JSON schema→Zod, filesystem→S3, added monorepo tooling section, fixed localstorage typo
- **Verified**: PASS

### 9.6 — Update contribute.mdx for new tooling
- **Date**: 2026-05-13
- **Files**: `apps/docs/content/docs/v3-beta/contribute.mdx`
- **Change**: 442→93 lines. Removed generic Git tutorial, added prerequisites table, quick setup, dev tools (Biome, just, Vitest), commit format, link to CONTRIBUTING.md
- **Verified**: PASS

### 9.7 — Add required secrets to manual-installation.mdx
- **Date**: 2026-05-13
- **Files**: `apps/docs/content/docs/v3-beta/manual-installation.mdx`
- **Change**: 300→188 lines. Added mandatory secrets section, STORAGE_URL, fixed S3 config, fixed commands (pnpm exec, --filter), port 5487 for prod web, Node 24 prerequisite
- **Verified**: PASS

### Review follow-ups
- C-1 (api.mdx missing S3 env vars): Added 7 S3 env vars to docker run example
- I-1 (Swagger→Scalar naming): Fixed in manual-installation.mdx, added ENABLE_API_DOCS=true production note
- I-2 (relative DB path): Fixed to absolute Docker path in password-reset.mdx
- I-3 (broken /docs/v3-beta/manage-users link): Removed from manual-installation.mdx
- M-1 (title inconsistency): Accepted — minor style difference
- M-2 (error message text): Accepted — illustrative, not exact
- M-3 (GET /api/files → GET /files): Fixed in api.mdx
- M-4 (UID/GID container context): Accepted — clear from surrounding context
