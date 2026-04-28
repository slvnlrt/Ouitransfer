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

### 3.4 — Implement centralized Fastify error handler
- **Date**: 2026-04-28
- **Files**: `apps/server/src/utils/error-handler.ts` (new), `apps/server/src/app.ts`
- **Change**: Created `globalErrorHandler()` covering Zod validation (400), JWT auth (401), Prisma errors (P2002→409, P2025→404, P2003/P2014→409), Fastify 4xx/5xx, unknown→500. Consistent response shape `{ error, code, statusCode, details? }`. Registered with `app.setErrorHandler()` + `app.setNotFoundHandler()`.
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
- **Files**: `apps/web/src/lib/logger.ts` (new), 17 hook/utility files
- **Change**: Created level-filtered logger (`NEXT_PUBLIC_LOG_LEVEL`). Replaced 54 console.* calls in hooks/utilities. Left 57 in .tsx components for future cleanup.
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
