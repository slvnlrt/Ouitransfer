# Ouitransfer - Agent Instructions

## Project Overview
Ouitransfer is a self-hosted file transfer solution (WeTransfer alternative).
- **Monorepo**: `apps/server`, `apps/web`, `apps/docs` (pnpm workspace + Turborepo)
- **Server**: Fastify 5 + Prisma (SQLite) + S3-compatible storage (RustFS or external)
- **Web**: Next.js 15 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui
- **Docs**: Fumadocs (Next.js)
- **Package manager**: pnpm 10.6.0
- **Node**: 24 (Alpine in Docker)
- **Version**: 3.3.2-beta

## Architecture
```
D:\Code\Ouitransfer\
  apps/server/        Fastify API (ESM), port 3333, ~74 TS files
  apps/web/           Next.js frontend, port 3000 (dev) / 5487 (prod), ~300 TSX files
  apps/docs/          Fumadocs site, port 3001, ~31 files
  packages/shared/    @ouitransfer/shared — shared utilities (mime-types, etc.)
  packages/config/    @ouitransfer/config — shared tsconfig presets (base, server, nextjs)
  infra/              Docker, deployment scripts
  audit/              Audit reports and remediation tracking
```

## Development Tools
- **Task runner**: `just` is installed — use `just --list` or `just` to see all available recipes (see `Justfile` at root)
  - Common: `just dev`, `just test`, `just lint`, `just validate`, `just setup`
  - Database: `just db-generate`, `just db-migrate-dev`, `just db-studio`, `just db-seed`, `just db-reset`
  - Docker: `just docker-start`, `just docker-stop`, `just docker-build [tag]`
  - Cleanup: `just clean` (artifacts), `just clean-all` (+ node_modules)
- **Scripts (root package.json)**: `pnpm dev`, `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm validate`, `pnpm e2e`, `pnpm knip`

## Key Conventions
- **Module system**: ESM throughout (server has `"type": "module"`, all relative imports use `.js` extensions)
- **File naming**: kebab-case for files, PascalCase for React components
- **Server modules**: `src/modules/{feature}/` with `controller.ts`, `service.ts`, `routes.ts`, `dto.ts`
- **Shared code**: `packages/shared` for cross-app utilities — use subpath exports (`./mime-types`) not barrel exports
- **Proxy layer**: Single catch-all handler at `apps/web/src/app/api/[...proxy]/route.ts` with route table in `proxy-routes.ts`
- **Validation**: Zod schemas via `fastify-type-provider-zod`
- **Auth**: JWT in httpOnly cookie, bcrypt, 2FA via otpauth (TOTP, RFC 6238)
- **i18n**: next-intl, 23 languages, messages in `apps/web/messages/`
- **UI**: shadcn/ui (new-york style), Radix primitives, lucide-react icons
- **Dependency versions**: pnpm catalogs in `pnpm-workspace.yaml` for shared deps (2+ apps)

## Current State (Post-Audit)
A comprehensive 8-dimension audit was completed. Score: 4.3/10. See `audit/` directory for full reports.

### Phase 0 — Security Emergency: COMPLETE
All 16 critical security items have been remediated, plus 14 reviewer follow-up items.
Frontend migrated to new POST endpoints. See `audit/DONE.md` for full details.

### Phase 1 — Tooling & DX Foundation: COMPLETE
pnpm workspace, Turborepo, Biome (replaces ESLint+Prettier), Vitest, Playwright, Lefthook,
commitlint, GitHub Actions CI/CD, Knip, Renovate, Changesets. Dockerfile reworked for workspace.
Phase 7 security deps also done: speakeasy→otpauth, crypto-js and react-qr-reader removed.

### Phase 2 — Architecture Restructuring: COMPLETE
`packages/shared` (mime-types), `packages/config` (tsconfig presets), unified TS 5.8.3,
pnpm catalogs (20 shared deps), 110-route proxy → 3-file catch-all handler, docs build strictness
enabled, Dockerfile updated for packages/. Server migrated to full ESM (`"type": "module"`).
Review follow-ups: all critical/warning items fixed. Remaining guidance forwarded to Phases 3/5/6/8.

### Phase 3 — Code Quality & Type Safety: COMPLETE
17 items completed. `noExplicitAny` + `noImplicitAnyLet` enforced as errors in Biome (~355 any types
eliminated). `@fastify/jwt` type augmentation for `FastifyJWT.user`; redundant custom `jwtSign`
decorator removed (callers switched to native `reply.jwtSign()`). Centralized error handler
(`globalErrorHandler` — catches Zod, JWT via prefix-based detection, Prisma, generic errors;
controllers still have own try/catch — migration deferred to Phase 5 item 5.16). Pino logger
replaces console.* on server (hooks + controllers + runtime migration script migrated; 5 pre-logger
bootstrap calls remain with comments). Frontend level-filtered logger for all hooks + components
(54 + 57 calls). 9 large files split (4 server modules, 5 web components). PrismaClient singleton
unified. Initial Prisma migration committed. Real tests: health endpoint inject test, Button
component tests, 62 proxy route tests, 31 error handler tests. Knip config fixed for docs MDX.
`__DELETE__` sentinel typed. eslint-disable comments removed. 13 pre-existing a11y lint errors fixed.
Review follow-ups: I-1/I-3/I-4/I-5/I-6/I-7/I-8 fixed; I-2 deferred to Phase 5.
Quality audit rework: QA-1 (test type errors), QA-2 (jwtSign), QA-3 (JWT detection) fixed.
QA-4 (mapper module, 16 double-casts eliminated), QA-5 (all 23 biome-ignore suppressions resolved —
0 remaining in codebase), QA-6 (auth-providers Zod-derived types), QA-7 (37 console.* migrated to
Pino) fixed. Dead crypto polyfill removed (Node 24 has native globalThis.crypto).
QA-8 (component deduplication) and QA-9 (frontend logger naming) tracked for Phases 4/8.

### Quality Standard
**Perfect implementation, zero technical debt.** This applies to every phase and every review finding:
- Fix pre-existing issues encountered along the way — not just the items explicitly in scope
- All review findings must be addressed: Critical, Important, AND Minor — none are optional
- No compromises justified by "it's minor" or "it works for now"
- Future-proof: prefer the clean solution even if it requires more refactoring

### Phase Closure Rule
**Before starting Phase N+1**, verify that `audit/TODO-POST-PHASE-N.md` has zero orphaned items:
- Every item must be either `[x]` (done) or explicitly moved to `audit/CONSOLIDATED-TODO-LIST.md` with a target phase
- Items cannot remain as "deferred" in a TODO-POST file without a destination — they will never be seen again
- Update `CLAUDE.md` phase status, `audit/DONE.md`, and `audit/CONSOLIDATED-TODO-LIST.md` checkboxes before closing a phase

### Implementation & Remediation Workflow
Use **subagent-driven development** (see `subagent-driven-development` skill) for both:
- **Phase implementation**: execute batches of items from `audit/CONSOLIDATED-TODO-LIST.md`
- **Post-review remediation**: execute the findings from `audit/TODO-POST-PHASE-N.md`

Process per phase:
1. Execute items using subagents (implementer → spec review → quality review per task)
2. Reviewer agents verify completed work — split by scope if the phase is large
3. Follow-ups go into `audit/TODO-POST-PHASE-N.md`
4. Completed items are tracked in `audit/DONE.md`

**Batching strategy**: Group multiple tasks into a single agent dispatch when tasks are:
- Mechanical/repetitive (e.g., rename a type across N files, fix N locale files)
- Touching the same system or files (e.g., all auth-related fixes, all RTL fixes)
- Low-risk with clear specs (no architectural judgment required)
Reserve separate agents for tasks requiring distinct architectural decisions or large file sets.

### Audit Directory Structure
```
audit/
  01-architecture.md          Dimension reports (read-only reference)
  02-backend.md
  03-frontend.md
  04-infrastructure.md
  05-security.md
  06-quality.md
  07-dependencies.md
  08-synthesis.md
  CONSOLIDATED-TODO-LIST.md   Master roadmap (~138 items, 9 phases)
  DONE.md                     Completed items log
  TODO-POST-PHASE-0.md        Reviewer follow-ups from Phase 0
  TODO-POST-PHASE-1.md        Reviewer follow-ups from Phase 1 (all resolved)
  TODO-POST-PHASE-2.md        Reviewer follow-ups from Phase 2 (all resolved)
  TODO-POST-PHASE-3.md        Reviewer follow-ups from Phase 3 (in-scope items resolved; deferred items forwarded to later phases)
  TODO-POST-PHASE-4.md        Reviewer follow-ups from Phase 4 (all resolved)
  TODO-POST-PHASE-5.md        Reviewer follow-ups from Phase 5 (all resolved)
  TODO-POST-PHASE-6.md        Reviewer follow-ups from Phase 6 (all resolved)
  BATCH-REVIEWS.md            Phase 4 batch-level review history
  PHASE-4-PLAN.md             Phase 4 implementation plan (historical snapshot)
  REVIEW-PHASE-5-BATCH-1.md   Phase 5 Batch 1 review (Tasks 1-2)
  REVIEW-PHASE-5-BATCH-2.md   Phase 5 Batch 2 review (Tasks 3-5)
  REVIEW-PHASE-5-BATCH-3.md   Phase 5 Batch 3 review (Tasks 6-7)
  REVIEW-PHASE-5-BATCH-4.md   Phase 5 Batch 4 review (Tasks 8-9)
    REVIEW-PHASE-7.md           Phase 7 final review
    TODO-POST-PHASE-7.md        Reviewer follow-ups from Phase 7 (in-scope resolved; 2 pre-existing items forwarded to Phase 8)
    PHASE-7-PLAN.md             Phase 7 implementation plan (historical snapshot)
    TODO-POST-PHASE-8.md        Reviewer follow-ups from Phase 8 (all resolved)
    REVIEW-PHASE-8.md           Phase 8 final review
    PHASE-8-PLAN.md             Phase 8 implementation plan (historical snapshot)
    REVIEW-PHASE-9.md           Phase 9 final review
    TODO-POST-PHASE-9.md        Reviewer follow-ups from Phase 9 (all resolved)
    PHASE-9-PLAN.md             Phase 9 implementation plan (historical snapshot)
```

### Phase 4 — Frontend Modernization: COMPLETE
Batch 1 complete: 4.14 (shared UI primitives extracted — EditableField, ItemActions, useEditableItem,
useSelectionManager, formatDateTime; 6 consumer files reduced by 797 lines), 4.15 (29 duplicate
File/Folder type interfaces consolidated — 10 exact duplicates replaced with imports, 13 subsets
converted to Pick<>, 4 dead types removed, 1 kept separate for API null boundary).
Batch 2 complete: 4.1 (error boundaries — ErrorDisplay component with 3 variants, reportError utility,
global-error.tsx, error.tsx, not-found.tsx, share-specific error.tsx files, settings refactored;
25 tests), 4.2 (loading.tsx — self-contained CSS spinner, no provider dependency).
Batch 2 cleanup: 3 ad-hoc error UIs replaced with ErrorDisplay (ShareNotFound deleted, login
"no auth methods", storage-usage error state).
Batch 3 complete: 4.3 (TanStack Query v5 — query-client with smart retry, hierarchical query-keys,
QueryProvider. 13 hooks + 6 components migrated to useQuery/useMutation. 28 new tests. Zustand
useAppInfo + useHomeStore eliminated, ShareContext eliminated, AuthContext backed by TQ queries),
4.4 (Axios 401 interceptor — hard-nav to /login, skips auth+public pages, anti-cascade flag),
4.5 (state unification — 2 zustand stores and 1 context eliminated, all data from TQ cache).
Batch 4 complete: 4.6 (lazy fonts — `preload: false` on 10 non-default fonts, only Outfit preloaded),
4.7 (code splitting — DynamicIcon replaces catastrophic 31-pack react-icons import on login page,
IconPicker wrapped with next/dynamic, LazyQRCode + LazyReactCrop wrappers for modal-only libraries),
4.8 (next/image — 7 `<img>` → `<Image>` with `unoptimized` for presigned/proxy URLs).
Batch 5 complete: 4.9 (skip-to-content link), 4.10 (route announcer for focus management),
4.11 (keyboard DnD — already implemented via bulk actions), 4.12 (RTL fix — shared constant,
server detection for fa-IR/he-IL, 191 Tailwind directional→logical replacements across 73 files).
Batch 6 complete: 4.13 (middleware route protection — JWT verification via jose, cookie-based auth at Edge, admin gating). Also pulled forward 6.13 (JWT_SECRET mandatory env var, removed DB-stored secret).
Phase 4 COMPLETE — all 15 items done.

### Phase 4 — Post-Review Remediation: COMPLETE
39 review findings from 3 reviewer agents. 3 critical + 20 important + 16 minor.
Tasks 1-3 complete (11 items fixed): middleware JWT bypass + path confusion + env validation,
translation namespace fix + locale parity test, auth context query-only + zustand removal +
staleTime centralization. Tasks 4-8 complete (remaining items): navigation + 401 interceptor,
RTL + a11y fixes, ErrorDisplay variant rename, dead code + BOM cleanup, TQ polish + locale-aware
dates + Axios standardization + browseState refactor + editable-item error handling.

### Phase 5 — Backend Hardening: COMPLETE
26 items (5.1-5.17, 5.18-5.26) implemented across 9 tasks in 4 review batches. All 42+ review
backlog items resolved (0 deferred). 174 server tests, 190 web tests, 11 shared tests — all pass.
Key changes:
- **Config hardening**: trustProxy, Swagger gating, crypto.randomUUID, configurable port, helmet,
  per-route body limits, CORS fail-fast, presigned URL expiry split
- **Filename hardening**: RFC 5987 `filename*` priority, `sanitizeFilename` utility, LoginSchema deleted
- **Auth hardening**: admin detection fix (`=== 0`), proxy `cookie: false` on 8 routes, OAuth redirect
  validation, 2FA disable requires TOTP code, CSRF double-submit cookie protection, timing-safe
  comparisons for backup codes
- **File validation**: MIME/magic-byte validation, blocked MIME types, dangerous extensions, maxFileSize
  in presigned URL responses, `validateObjectName` for path traversal protection
- **Error architecture**: AppError hierarchy (6 subclasses), all 17 controllers + 17 services migrated
  to throw AppError directly, globalErrorHandler handles AppError first, `ErrorResponseSchema` shared
  across ~176 route error schemas, preValidation hooks converted to throw AppError, CSRF per-route
  `config: { csrfExempt: true }` flag replaces fragile URL matching
- **Token security**: tokenVersion rotation on privilege changes (password, isAdmin, isActive, 2FA),
  JWT `trusted` callback with 30s cache, per-account brute-force lockout (LoginAttempt model),
  refresh token rotation with replay detection, 15-min access tokens + httpOnly refresh cookie
- **Audit logging**: AuditLog model, 11 audit actions at 8 security-sensitive locations, admin
  endpoint with pagination/filtering
- Review follow-ups: all Critical + Important fixed inline per batch. See `audit/REVIEW-PHASE-5-BATCH-{1-4}.md`.

### Phase 6 — Infrastructure & Operations: COMPLETE
Migrated from monolith supervisord container (MinIO+API+Web) to 3-container Docker Compose
architecture (RustFS storage + Fastify server + Next.js web). 16 items (6.1-6.16) completed.
Key changes:
- **Architecture**: Supervisord eliminated. Single Dockerfile with two build targets (`server-runner`,
  `web-runner`). RustFS uses official `rustfs/rustfs:latest` image. Docker Compose with healthcheck-
  based startup ordering (`storage` → `server` → `web`).
- **Dockerfile**: Rewritten from 287 → 121 lines. No MinIO/mc binaries, no inline heredoc startup
  script, no VOLUME declaration. Consistent UID/GID 1001, lowercase user `ouitransfer`.
- **Storage config**: `loadInternalStorageCredentials()` (file reading) removed — all credentials via
  env vars. `ensureBucket()` auto-creates bucket at startup via HeadBucket/CreateBucket. `buildEndpointUrl()`
  DRY helper. Legacy `ENCRYPTION_KEY`/`DISABLE_FILESYSTEM_ENCRYPTION` env vars deleted.
- **Health endpoint**: Enhanced with DB check (`prisma.$queryRaw`) + S3 check (`HeadBucketCommand`).
  Returns `{ status, timestamp, uptime, checks: { database, storage } }`. 200=healthy, 503=degraded.
- **Dead code removed**: 7 infra scripts deleted (`install-minio.sh`, `start-minio.sh`, `minio-setup.sh`,
  `load-minio-credentials.sh`, `install-mc.sh`, `supervisord.conf`, `build-docker.sh`).
  `migrate-filesystem-to-s3.ts` (335 lines) deleted — no production users, no migration needed.
- **Security**: Empty secrets in docker-compose.yaml force fail-fast. `security_opt: no-new-privileges`
  on storage container. RustFS credentials left empty with REQUIRED comments.
- **Documentation**: `quick-start.mdx` fully rewritten for 3-container architecture. `uid-gid-configuration.mdx`
  updated with RustFS UID 10001 bind mount guidance. `SCRIPTS.md` expanded with operations section.
  All code comments updated (Garage/MinIO → S3-compatible).
- **Other**: SMTP seed placeholders removed. Justfile docker recipes updated for 3 services. `.env.example`
  updated for RustFS. Lefthook already correct (Biome `--staged`).
- Review follow-ups: 27 items (4 Critical + 4 Legacy + 9 Important + 8 Minor), all resolved.
  See `audit/TODO-POST-PHASE-6.md`.

### Phase 7 — Dependency Modernization: COMPLETE
10 packages removed, 2 added to pnpm catalog, ~122 icon import sites migrated. 5 commits.
Key changes:
- **Server cleanup**: Removed `node-fetch` (unused, Node 24 native fetch), `openid-client` (unused,
  OAuth via manual fetch), `ts-node` (redundant with tsx). Updated knip.json.
- **Motion rename**: `framer-motion` → `motion` package. 9 source files updated to `"motion/react"`.
  Added `motion: "^12.23.0"` and `jose: "^5.10.0"` to pnpm catalog.
- **Web dep cleanup**: Removed `nookies` (replaced with native `document.cookie` + encodeURIComponent),
  `js-cookie` + `@types/js-cookie` (installed but never imported), `date-fns` (replaced with
  `formatDateTime()` using `Intl.DateTimeFormat`), `@types/react-dropzone` (react-dropzone v14 ships
  own types). Fixed hardcoded `ptBR` locale bug. Added 13 `formatDateTime` locale tests.
- **Icon consolidation**: Removed `@tabler/icons-react`. ~85 non-brand icons → `lucide-react`,
  17 brand icons → `react-icons/tb`. Union type in `file-icons.tsx`. Link/LinkIcon collision fixed.
- Review: 0 Critical, 2 Important (documentation-only), 7 Minor (3 fixed inline, 4 no-action/kept,
   M-4 knip cleanup done). 2 pre-existing items forwarded to Phase 8 (M-1 i18n, M-2 icon polish).
   See `audit/REVIEW-PHASE-7.md` and `audit/TODO-POST-PHASE-7.md`.

### Phase 8 — Polish & Production Readiness: COMPLETE
22 items (8.1-8.22) plus Portuguese comments cleanup and 2 Phase 7 forwarded items. 9 tasks,
9 commits. 203 server tests + 208 web tests + 11 shared tests pass. All type-checks clean.
Key changes:
- **Documentation**: Apache-2.0 LICENSE file, CONTRIBUTING.md complete rewrite (dev-focused),
  server + web architecture READMEs
- **Upload resume**: Full-stack S3 ListParts implementation (server StorageProvider + controller +
  routes, reverse-share support, frontend Uppy callback, 7 integration tests)
- **Server security**: Timeout hardening (connection 30s, keepAlive 30s, request 4h), @fastify/jwt
  9→10 (fixed 3 crit CVEs), nodemailer 6→8, axios →1.15.2, next →15.5.18. CI audit job.
- **Frontend security**: CSP + 4 security headers in middleware, env validation expanded (API_BASE_URL,
  OAUTH_ALLOWED_REDIRECT_HOSTS, ALLOWED_IMAGE_HOSTS, CSP_CONNECT_SOURCES), proxy uses validated env
- **ConfigService refactor**: Class → 5 standalone functions, JSON.parse error handling, InternalError
  class, 12 server files updated
- **Logger**: Full module JSDoc, LogContext interface, clarified as client-side level-filtered wrapper
- **Translations**: 15 keys translated in 12 common-language locales. Hardcoded "Move" label → i18n.
  GraphQL/Proto icons fixed (Webhook → Braces/FileCode).
- **Test improvements**: Health test (5 new), formatFileSize tests (6 new), OAuth redirect tests (3 new)
- **CI & tooling**: Lighthouse CI integrated in `ci.yml` (after build, non-blocking), bundle analyzer,
  @axe-core/playwright a11y tests, E2E workflow enabled with Docker Compose
- **Portuguese cleanup**: 33 Portuguese comments/strings translated across 11 files
- Review follow-ups: all resolved. See `audit/REVIEW-PHASE-8.md` and `audit/TODO-POST-PHASE-8.md`.
- **Post-phase fixes**: ru-RU auth error messages (Portuguese → Russian), server test contention
  (`fileParallelism: false` in vitest.config.ts), `npx` → `pnpm exec` in e2e.yml, Lighthouse job
  added to ci.yml.

### Phase 9 — Documentation Site Overhaul: COMPLETE
7 items (9.1-9.7) updated across 7 documentation pages. 4 commits.
Key changes:
- **Architecture pages**: `architecture.mdx` rewritten for S3-first model (RustFS default, 3-container
  Docker table, security secrets section, encryption cruft removed). `github-architecture.mdx` updated
  (React 19, Tailwind CSS 4, Node 24, packages/ tree, Zod, monorepo tooling section)
- **Operational docs**: `password-reset-without-smtp.mdx` container names fixed, `api.mdx` monolith
  examples replaced with 3-container architecture + CSRF note, `reverse-proxy-configuration.mdx`
  health endpoint fixed + STORAGE_URL/CSP guidance added
- **Contributor docs**: `contribute.mdx` rewritten (442→93 lines, dev-focused), `manual-installation.mdx`
  rewritten (300→188 lines, mandatory secrets, correct commands)
- Review follow-ups: all resolved. See `audit/REVIEW-PHASE-9.md` and `audit/TODO-POST-PHASE-9.md`.

## Important: No Production, No Legacy
The app is **not in production** and has no existing users. This means:
- **No backward compatibility required** — APIs, env vars, DB schemas can be changed freely
- **No incremental migrations** — Prisma schema can be reset/recreated from scratch
- **No legacy shims** — dead code, deprecated patterns, and proxy layers can be deleted outright
- **No gradual rollouts** — breaking changes are fine, no feature flags needed
- **Clean slate** — prefer the correct solution over the compatible one

This affects implementation strategy: always choose the clean approach over the safe-migration approach.

## Rules for Agents
1. **Consistency over compatibility** — prefer clean implementations, no need to preserve legacy behavior
2. **One concern per commit** — atomic changes, clear commit messages
3. **Check for side effects** — search for all callers/importers before changing a function signature
4. **Preserve i18n** — don't break translation keys
5. **Test your changes** — at minimum verify TypeScript compiles (`pnpm run type-check` in the relevant app)
6. **Report clearly** — state what was changed, which files, and any risks or follow-up needed
7. **Reference files, don't copy them** — when dispatching subagents or writing prompts, reference files by path and line range (e.g. `apps/server/src/app.ts:109-120`) instead of copy-pasting their content. Agents can read files themselves. Copying file content into prompts wastes tokens and creates stale duplicates.
8. **Don't defer items to the wrong phase out of laziness** — if a review or audit surfaces new items, place them in the phase where they thematically belong, not in a later phase just because they require more effort. "Architectural" or "requires a migration" is not a valid reason to move an auth hardening item out of the auth hardening phase. If the item belongs in the current phase's scope, it stays — even if it makes the phase bigger. Phases are organized by theme, not by effort ceiling.
9. **Run the FULL test suite for affected packages, not just your new tests** — a recurring failure mode is: agent writes 3 unit tests, they pass, agent claims "done" — but the full `pnpm --filter <package> test` reveals regressions in existing tests. Always run the full suite for every package you touched. This catches BOM corruption, broken imports, schema mismatches, and other side effects that targeted tests miss.
10. **Fastify + Zod route schemas strip unknown properties** — `fastify-type-provider-zod` replaces `request.body` with `schema.parse(data)`, and Zod's default `.strip()` mode removes undeclared fields. If you add a field to a controller's validation schema but forget to add it to the route-level body schema in `routes.ts`, the field will be silently removed before the controller runs. **Always keep route-level and controller-level schemas in sync.** Service-layer unit tests don't catch this — you need integration tests with `app.inject()`.
11. **Service-layer tests are necessary but not sufficient** — testing a service method directly bypasses route registration, middleware, schema validation, and plugin hooks. For security-critical flows (auth, CSRF, 2FA), always add at least one integration test using `app.inject()` that exercises the full request lifecycle. The pattern of "test the service, skip the route" has repeatedly hidden real bugs.
