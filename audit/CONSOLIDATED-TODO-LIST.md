OUITRANSFER — Exhaustive State-of-the-Art TODO

> Project: Ouitransfer v3.3.2-beta — Self-hosted file transfer (WeTransfer alternative)  

> Baseline score: 4.3/10 (per audit synthesis)  

> Target: Production-grade, state-of-the-art quality  

> Source: Cross-referenced from 8 audit reports (architecture, backend, frontend, infrastructure, security, quality, dependencies, synthesis)

---

Phase 0: Security Emergency 🚨

> Goal: Eliminate all exploitable vulnerabilities. No deployment before this phase is complete.  

> Estimated effort: \~20h

Prototype Pollution \& DoS (immediate, 30min total)

- [x] 0.1 — Re-enable prototype pollution protection  

  File: apps/server/src/app.ts:36-37  

  Action: Change onProtoPoisoning: "ignore" → "error" and onConstructorPoisoning: "ignore" → "error" (Fastify's secure defaults)  

  Justification: Audit C2/S2 — disabling these opens RCE/auth bypass vectors via crafted JSON payloads

- [x] 0.2 — Set a reasonable body limit  

  Files: apps/server/src/app.ts:30, apps/server/src/server.ts:58, apps/server/src/modules/reverse-share/routes.ts:389  

  Action: Set bodyLimit to 50 \* 1024 \* 1024 (50MB). File uploads use presigned S3 URLs, so the Fastify body limit only affects API JSON/metadata payloads. Also fix next.config.ts:21 bodySizeLimit: "1pb" → "50mb"  

  Justification: Audit C4/S5 — 1PB body limit = trivial DoS

Unauthenticated Routes (critical, 4h total)

- [x] 0.3 — Add JWT preValidation to all /s3/\* routes  

  File: apps/server/src/modules/s3-storage/routes.ts  

  Action: Add preValidation: [app.authenticate] to /s3/upload-url, /s3/download-url, /s3/object/:objectName, /s3/exists. Ensure the controller validates the user owns/has access to the referenced objects  

  Justification: Audit S3 — unauthenticated upload/download/delete/enumerate of arbitrary S3 objects

- [x] 0.4 — Add authentication to /embed/:id  

  Files: apps/server/src/modules/file/routes.ts:134-155, apps/server/src/modules/file/controller.ts:583-625  

  Action: Require either (a) the user is authenticated and owns the file, or (b) the file belongs to an active share with valid access (alias + optional password). Generate cryptographic embed tokens tied to shares instead of using raw file IDs  

  Justification: Audit C3/S4 — any file media downloadable by guessing CUID

CORS \& Transport (critical, 2h)

- [x] 0.5 — Restrict CORS to known frontend origins  

  File: apps/server/src/app.ts:71-74  

  Action: Replace origin: true with an allowlist from env var CORS\_ORIGINS (comma-separated). Default to http://localhost:3000,http://localhost:5487. Validate format at startup  

  Justification: Audit C1/S1 — any website can make authenticated cross-origin requests with cookies

- [x] 0.6 — Default SECURE\_SITE to "true"  

  File: apps/server/src/modules/auth/controller.ts:43-48  

  Action: Change default to "true". Add an explicit INSECURE\_COOKIES=true env var for development only, with a startup warning when active  

  Justification: Audit H3 — cookies sent over plain HTTP by default, vulnerable to MITM

Command Injection (critical, 1h)

- [x] 0.7 — Replace exec() with execFile() or native fs.statfs()  

  File: apps/server/src/modules/storage/service.ts:1,49-51  

  Action: Replace import { exec } from "child\_process" with Node.js native fs.statfs() (available since Node 18.15) for disk space queries. This eliminates shell interpretation entirely  

  Justification: Audit C5/S6 — exec() interprets shell metacharacters, potential command injection

Rate Limiting (critical, 4h)

- [x] 0.8 — Install and configure @fastify/rate-limit  

  Files: apps/server/src/app.ts, per-module routes.ts  

  Action: Install @fastify/rate-limit. Configure global limit (100 req/min/IP), strict on auth endpoints (5/min/IP for login, password-reset, 2FA), moderate on upload endpoints (30/min/IP). Use keyGenerator based on IP (considering trustProxy)  

  Justification: Audit H1/S8 — zero rate limiting enables brute-force, email bombing, resource exhaustion

2FA Bypass Fix (critical, 4h)

- [x] 0.9 — Fix 2FA flow with server-side challenge token  

  Files: apps/server/src/modules/auth/dto.ts:41-42, apps/server/src/modules/auth/controller.ts:56-84  

  Action: After successful password verification, generate a short-lived signed JWT "challenge token" (e.g., 5min TTL) containing the userId. The 2FA completion endpoint must receive this challenge token instead of a raw userId. Validate and verify the challenge token server-side before accepting the TOTP code  

  Justification: Audit H5/S7 — attacker can skip password step and brute-force 6-digit TOTP

Presigned URL Object Name (high, 2h)

- [x] 0.10 — Generate objectName server-side for write operations  

  Files: apps/server/src/modules/file/controller.ts:202-270, apps/server/src/modules/reverse-share/controller.ts:190-214  

  Action: For all presigned PUT URL generation, generate the S3 object key server-side (e.g., {userId}/{uuid}/{sanitizedFilename}). Never accept client-provided objectName for write operations. Read operations can use object names from the database  

  Justification: Audit H6 — user-controlled objectName allows overwriting other users' files

Share Passwords (high, 2h)

- [x] 0.11 — Move share passwords from query parameters to request body  

  Files: apps/server/src/modules/share/routes.ts:82, apps/server/src/modules/file/routes.ts:117-118, apps/server/src/modules/reverse-share/routes.ts:188  

  Action: Change password-protected share/file access from GET ?password=xxx to POST with password in body. Update frontend API layer accordingly  

  Justification: Audit H2 — passwords in URLs are logged in access logs, browser history, proxy logs, Referer headers

TLS \& Image Proxy (medium, 1h)

- [x] 0.12 — Scope TLS bypass to S3 client only  

  File: apps/server/src/config/storage.config.ts:65-71  

  Action: Remove the global NODE\_TLS\_REJECT\_UNAUTHORIZED=0. Instead, pass rejectUnauthorized: false only to the S3 client's HTTP agent when S3\_REJECT\_UNAUTHORIZED=false  

  Justification: Audit M7 — global TLS bypass affects all outbound connections

- [x] 0.13 — Restrict Next.js image remote patterns  

  File: apps/web/next.config.ts:7-16  

  Action: Replace hostname: "\*\*" with specific allowed hostnames (the app's own domain, configured S3 endpoint). Add env var ALLOWED\_IMAGE\_HOSTS for additional hosts  

  Justification: Audit M6 — wildcard allows SSRF via /\_next/image

Auth Route Consistency (medium, 2h)

- [x] 0.14 — Move all auth checks to preValidation hooks  

  Files: apps/server/src/modules/share/routes.ts:119-139, apps/server/src/modules/file/controller.ts:60, apps/server/src/modules/folder/controller.ts:21  

  Action: Ensure all authenticated routes use preValidation: [app.authenticate] at the route level, not inside controller handlers. This prevents accidentally bypassing auth  

  Justification: Audit 02 — inconsistent auth (some routes check JWT in controller, not preValidation)

Validation Gaps (medium, 2h)

- [x] 0.15 — Replace z.any() with proper Zod schema on auth provider update  

  File: apps/server/src/modules/auth-providers/routes.ts:188  

  Action: Define a proper Zod schema for the auth provider update body with all expected fields validated  

  Justification: Audit 02 — z.any() bypasses all validation on a sensitive endpoint

- [x] 0.16 — Enable removeAdditional to strip unknown fields  

  File: apps/server/src/app.ts:22-24  

  Action: Set removeAdditional: true in Fastify's Ajv options (or use Zod's .strict() on critical schemas)  

  Justification: Audit 02 — combined with disabled proto pollution protection, extra fields widen attack surface

---

Phase 1: Tooling \& DX Foundation 🔧

> Goal: Modern devbox-quality development environment with CI/CD, testing, and automated quality gates.  

> Estimated effort: \~40h

Monorepo Foundation (4h)

- [x] 1.1 — Create pnpm-workspace.yaml  

  File: pnpm-workspace.yaml (new, root)  

  Action: Create with packages: ["apps/\*", "packages/\*"]. Delete per-app pnpm-lock.yaml files. Run pnpm install from root to generate a single unified lockfile  

  Justification: Audit 01 critical — fake monorepo, 3 independent lockfiles, no deduplication

- [x] 1.2 — Add .npmrc with strict settings  

  File: .npmrc (new, root)  

  Action: Create with strict-peer-dependencies=true, auto-install-peers=true, shamefully-hoist=false, prefer-workspace-packages=true  

  Justification: Audit 07 — no .npmrc exists, needed for workspace discipline

- [x] 1.3 — Add .nvmrc / .node-version  

  File: .node-version (new, root)  

  Action: Pin to 24 (matching Dockerfile node:24-alpine). Consider mise or fnm as the version manager (faster than nvm)  

  Justification: Audit 07 — no Node version pinning

Build Orchestration (4h)

- [x] 1.4 — Install and configure Turborepo  

  Files: root package.json, turbo.json (new)  

  Action: pnpm add -Dw turbo. Create turbo.json with pipelines: build (depends on ^build), lint, type-check, test, validate (depends on lint + type-check). Configure remote caching if using Vercel, or local caching otherwise  

  Justification: Audit 01/08 — zero build orchestration, sequential validation

- [x] 1.5 — Add workspace-level scripts to root package.json  

  File: root package.json  

  Action: Add scripts: "build": "turbo build", "lint": "turbo lint", "type-check": "turbo type-check", "test": "turbo test", "validate": "turbo validate", "dev": "turbo dev", "format": "biome format --write .", "check": "biome check --write ."  

  Justification: Audit 01 — root package.json has zero workspace scripts

Replace Makefile with Justfile (2h)

- [x] 1.6 — Create a justfile replacing the Makefile  

  File: justfile (new, root), delete Makefile  

  Action: Migrate all Makefile targets to just recipes with improvements:

  - just dev — start all apps in parallel via turbo

  - just build — turbo build all apps

  - just lint / just check — biome check

  - just test — turbo test

  - just validate — full validation (lint + type-check + test)

  - just docker-build [version] — non-interactive Docker build (local by default, --push flag)

  - just docker-start / just docker-stop / just docker-logs

  - just update-version version — update all package.json versions

  - just db-seed / just db-migrate / just db-studio — Prisma operations

  - just clean — clean all build artifacts and node\_modules

  - just setup — full first-time setup (pnpm install, prisma generate, etc.)

  - Use just --list for self-documenting help  

  Tool: just (https://github.com/casey/just)  

  Justification: User's devbox philosophy — just is superior to make for non-build task runners (no tabs requirement, better variable handling, cross-platform)

Linting \& Formatting Modernization (4h)

- [x] 1.7 — Replace ESLint + Prettier with Biome  

  Files: Delete all eslint.config.mjs (×3), all .prettierrc.json (×3), remove ESLint/Prettier deps from all package.json. Create biome.json at root  

  Action: Install @biomejs/biome as root devDependency. Configure biome.json with:

  - formatter: indentStyle: "space", indentWidth: 2, lineWidth: 120, quoteStyle: "double", trailingCommas: "es5"

  - linter.rules.suspicious.noExplicitAny: "warn" (escalate to "error" in Phase 3)

  - linter.rules.correctness.noUnusedVariables: "error"

  - linter.rules.correctness.useExhaustiveDependencies: "warn"

  - organizeImports.enabled: true

  - overrides for apps/docs and apps/web/src/components/ui/ (shadcn) with relaxed rules

  - files.ignore: ["\*\*/dist", "\*\*/.next", "\*\*/node\_modules", "\*\*/prisma/migrations"]

  Why Biome over ESLint+Prettier: Single tool for lint+format, 10-100x faster (Rust), zero plugin ecosystem headaches, built-in import sorting (replaces @ianvs/prettier-plugin-sort-imports), native TypeScript support. For this stack (Next.js + Fastify + Tailwind), Biome covers 95%+ of needed rules. The 5% gap (Next.js-specific rules like no-img-element) can be supplemented with eslint-plugin-next in a minimal ESLint config if absolutely needed, but most are better enforced by Biome's own rules.

  Alternative evaluated: oxlint + dprint — faster linting but immature formatting, Biome is more integrated  

  Justification: Audit 06 — 3× duplicated ESLint/Prettier configs, critical rules disabled. Biome consolidates to one config file

- [x] 1.8 — Add supplementary oxlint for rules Biome doesn't cover (optional)  

  File: .oxlintrc.json (new, root)  

  Action: Only if specific Next.js rules are needed that Biome doesn't cover. Install oxlint and configure only the gap rules. Run after Biome in CI  

  Justification: Belt-and-suspenders linting for Next.js-specific patterns

Testing Infrastructure (8h)

- [x] 1.9 — Install Vitest as the test runner  

  Files: root package.json, vitest.workspace.ts (new), per-app vitest.config.ts  

  Action: pnpm add -Dw vitest @vitest/coverage-v8. Create workspace config pointing to all apps. Configure per-app:

  - apps/server: environment: "node", aliases matching tsconfig paths

  - apps/web: environment: "jsdom", setup file for React Testing Library

  - apps/docs: skip (content site)  

  Add "test": "vitest run", "test:watch": "vitest", "test:coverage": "vitest run --coverage" to workspace scripts  

  Tool: Vitest (native ESM, Vite-powered, fast HMR in watch mode)  

  Justification: Audit 02/03/06 critical — ZERO tests across 508 files

- [x] 1.10 — Install React Testing Library for frontend tests  

  File: apps/web/package.json  

  Action: pnpm add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom  

  Justification: Required for component/hook testing with Vitest

- [x] 1.11 — Install Playwright for E2E tests  

  File: root package.json, playwright.config.ts (new)  

  Action: pnpm add -Dw @playwright/test. Configure with baseURL pointing to local dev, projects for chromium/firefox/webkit, webServer config to auto-start the app. Create e2e/ directory at root  

  Tool: Playwright (faster, more reliable than Cypress, native multi-browser)  

  Justification: Audit 03/06 — zero E2E tests for critical user flows

- [x] 1.12 — Write initial smoke tests for critical backend services  

  Files: apps/server/src/modules/auth/\_\_tests\_\_/, apps/server/src/modules/file/\_\_tests\_\_/, apps/server/src/modules/share/\_\_tests\_\_/  

  Action: Write tests for auth service (login, JWT, 2FA flow), file service (presigned URL generation, upload registration), share service (create, access with password). Use Fastify's inject() for integration tests without HTTP  

  Justification: Audit 08 risk matrix — regression during security fixes with zero tests

Git Hooks \& Commit Quality (2h)

- [x] 1.13 — Replace Husky with Lefthook  

  Files: Delete .husky/, root package.json (remove husky dep), lefthook.yml (new)  

  Action: pnpm add -Dw lefthook. Create lefthook.yml:

  - pre-commit: run biome check --staged --no-errors-on-unmatched on staged files (replaces lint-staged pattern — Lefthook has built-in staged file filtering)

  - commit-msg: run commitlint --edit for conventional commits

  - pre-push: run turbo validate (lint + type-check + test)

  

  Why Lefthook over Husky+lint-staged: Single Go binary, built-in staged file filtering (no lint-staged needed), parallel hook execution, faster startup  

  Justification: Audit 04 — fragile cd chains in pre-push, no pre-commit hook, no commit message validation

- [x] 1.14 — Install commitlint with conventional commits  

  Files: root package.json, commitlint.config.ts (new)  

  Action: pnpm add -Dw @commitlint/cli @commitlint/config-conventional. Configure with extends: ['@commitlint/config-conventional'] and custom scopes: server, web, docs, infra, deps  

  Justification: No commit message discipline exists. Conventional commits enable automated changelogs

CI/CD Pipeline (8h)

- [x] 1.15 — Create GitHub Actions CI workflow  

  File: .github/workflows/ci.yml (new)  

  Action: Create workflow triggered on push and pull\_request to main/develop:

  1. Setup: pnpm with --frozen-lockfile, Node.js from .node-version, Turborepo cache (actions/cache on .turbo/)

  2. Lint: turbo lint (Biome)

  3. Type-check: turbo type-check

  4. Test: turbo test with coverage upload to Codecov

  5. Build: turbo build (verify all apps compile)

  

  Use pnpm/action-setup and actions/setup-node with built-in pnpm cache. Parallelize independent jobs via matrix strategy  

  Justification: Audit 04 critical — ZERO CI/CD, zero automated quality gates

- [x] 1.16 — Create GitHub Actions Docker build workflow  

  File: .github/workflows/docker.yml (new)  

  Action: Triggered on version tags (v\*). Build multi-platform image (linux/amd64, linux/arm64) via docker/build-push-action. Push to GHCR (ghcr.io/burger-cie/ouitransfer). Use Docker layer caching via type=gha cache backend  

  Justification: Audit 04 — builds are manual via interactive script with forced --push

- [x] 1.17 — Create GitHub Actions E2E workflow  

  File: .github/workflows/e2e.yml (new)  

  Action: Run Playwright tests on PRs. Use Docker Compose to spin up the full stack (API + Web + MinIO). Upload test artifacts (screenshots, traces) on failure  

  Justification: E2E validation before merge

Dead Code Detection (1h)

- [x] 1.18 — Install and configure Knip  

  File: knip.json (new, root)  

  Action: pnpm add -Dw knip. Configure with workspace entries for each app. Run knip to detect unused exports, unused dependencies, unused files. Add to CI  

  Tool: Knip (purpose-built for monorepos, understands Next.js/Fastify patterns)  

  Justification: Audit 06 — suspected dead code (types/layout.ts, i18n-mock.ts), 3 icon libraries likely have unused icons

Dependency Management (1h)

- [x] 1.19 — Configure Renovate for automated dependency updates  

  File: renovate.json (new, root)  

  Action: Add Renovate config with: extends: ["config:recommended"], automerge for patch updates, group pnpm monorepo packages, pin @types/\* versions, schedule "before 7am on Monday". Set rangeStrategy: "pin" for production deps  

  Alternative: Dependabot — simpler but less powerful grouping. Renovate is state-of-the-art  

  Justification: Audit 07 — version drift between apps, no automated updates

Local Environment (1h)

- [x] 1.20 — Create .envrc for direnv integration  

  File: .envrc (new, root), .env.example updated  

  Action: Create .envrc that sources .env and sets PATH\_add node\_modules/.bin. Fix the malformed URL in apps/web/.env.example: http:localhost:3333 → http://localhost:3333. Create a root .env.example documenting all env vars across all apps  

  Justification: User's devbox philosophy — direnv for seamless env management. Audit 01 — malformed URL in .env.example

- [x] 1.21 — Add Changesets for version management  

  Files: .changeset/config.json (new), root package.json  

  Action: pnpm add -Dw @changesets/cli. Initialize with pnpm changeset init. Configure fixed mode (all apps versioned together). Replace infra/update-versions.sh sed script  

  Tool: Changesets (standard for monorepo versioning, integrates with CI for automated releases)  

  Justification: Audit 01 — version management via fragile sed script

---

Phase 2: Architecture Restructuring 🏗️

> Goal: True monorepo with shared packages, deduplicated code, consolidated configs.  

> Estimated effort: \~24h

Shared Packages (8h)

- [x] 2.1 — Create packages/shared for cross-app utilities  

  Files: packages/shared/ (new directory), packages/shared/package.json, packages/shared/tsconfig.json  

  Action: Create package with:

  - src/mime-types.ts — merged from apps/server/src/utils/mime-types.ts (378L) and apps/web/src/utils/mime-types.ts (435L)

  - src/types/ — shared types (User, File, Folder, Share interfaces)

  - src/constants.ts — shared constants

  - src/validation/ — shared Zod schemas for DTOs that both apps need

  

  Add workspace:\* references in consuming apps' package.json. Build with tsup for dual CJS/ESM output  

  Justification: Audit 01 critical — zero workspace: references, mime-types.ts duplicated (378+435 LOC), zero shared types

- [x] 2.2 — Create packages/config for shared tooling configs  

  Files: packages/config/ (new directory)  

  Action: Create shared configs:

  - tsconfig/base.json — shared compiler options, extended by each app's tsconfig.json

  - biome.json — shared Biome config (if per-app overrides are needed, use overrides)

  Each app's tsconfig.json becomes { "extends": "../../packages/config/tsconfig/base.json", ... }  

  Justification: Audit 01 — 3× duplicated tsconfig, ESLint, Prettier configs

Config Consolidation (4h)

- [x] 2.3 — Unify TypeScript versions and tsconfig settings  

  Files: All tsconfig.json files, all package.json files  

  Action: Align TypeScript to ^5.8.3 everywhere. Set forceConsistentCasingInFileNames: true in base tsconfig (only docs had it). Evaluate moving server to module: "nodenext" / moduleResolution: "nodenext" for consistency  

  Justification: Audit 01/07 — TypeScript drift: ^5.7.3 vs 5.8.3

- [x] 2.4 — Remove ignoreDuringBuilds and ignoreBuildErrors from docs  

  File: apps/docs/next.config.mjs  

  Action: Remove typescript.ignoreBuildErrors: true and eslint.ignoreDuringBuilds: true. Fix the underlying TS/lint errors in the docs app  

  Justification: Audit 01 — docs silently ignores all build errors

Proxy Layer Rationalization (8h)

- [x] 2.5 — Evaluate and reduce the 101-route proxy layer  

  Files: apps/web/src/app/api/(proxy)/ (101 files)  

  Action: Two approaches (evaluate both, implement the better one):

  

  Option A (recommended): Create a single catch-all proxy middleware at apps/web/src/app/api/[...proxy]/route.ts using a route mapping config. Each route maps URL pattern → backend path with method/auth requirements. Reduces 101 files to \~1 handler + 1 config  

  

  Option B: In Docker, add a Caddy/nginx reverse proxy that forwards /api/\* directly to Fastify, eliminating the Next.js proxy entirely. This requires cookie handling adjustment  

  

  Either way, create shared proxy utilities (apps/web/src/lib/proxy.ts) for cookie forwarding, error handling, and response streaming  

  Justification: Audit 01/03/06 — 101 boilerplate proxy files, massive maintenance burden

Docker Architecture (2h)

- [x] 2.8 — Evaluate replacing supervisord with docker compose multi-container  

  Files: infra/supervisord.conf, Dockerfile, docker-compose.yaml  

  Action: The current Docker image runs 4 processes (minio, minio-setup, server, web) via supervisord in a single container. Evaluate splitting into separate containers orchestrated by docker compose (one per service). If splitting, delete infra/supervisord.conf and simplify the Dockerfile to single-process. No backward compatibility needed — no production users  

  Justification: Audit 04/01 — multi-process container is an anti-pattern, complicates scaling and debugging

Dependency Deduplication (4h)

- [x] 2.6 — Hoist shared dependencies to workspace root  

  Files: Root package.json, per-app package.json files  

  Action: After pnpm-workspace.yaml (Phase 1.1), move shared devDependencies to root: typescript, @biomejs/biome, vitest. Verify shared production deps are properly hoisted by pnpm (zod, react, next, lucide-react, clsx, etc.)  

  Justification: Audit 07 — duplicated deps across apps, version drift

- [x] 2.7 — Align drifting dependency versions  

  Files: Per-app package.json  

  Action: Align: @radix-ui/react-dialog → ^1.1.15, tailwind-merge → ^3.3.1, prisma CLI → ^6.11.0 (match client). Use pnpm catalog (pnpm 9+) or Renovate grouping to prevent future drift  

  Justification: Audit 07 — multiple version drifts identified

---

Phase 3: Code Quality \& Type Safety 🎯

> Goal: Eliminate any types, proper error handling, structured logging, type-safe request objects.  

> Estimated effort: \~40h

Type Safety (16h)

- [x] 3.1 — Type the Fastify request decoration properly  

  Files: apps/server/src/types/fastify.d.ts, all controller files using (request as any).user  

  Action: Declare the Fastify request decoration in types/fastify.d.ts:

    declare module 'fastify' {

    interface FastifyRequest {

      user: { userId: string; isAdmin: boolean; }

    }

  }

    Then replace all 15+ occurrences of (request as any).user?.userId with request.user.userId  

  Justification: Audit 06 — 15+ (request as any).user casts, defeats type safety

- [x] 3.2 — Escalate noExplicitAny to error in Biome  

  File: biome.json  

  Action: Change noExplicitAny from "warn" to "error". Fix remaining any types across the codebase. Priority files:

  - shares-table.tsx (17+ any) — create proper Share interface

  - useUppyUpload.ts (15+) — type Uppy callbacks properly

  - share-actions-modals.tsx (12+) — use shared Share type

  - two-factor/controller.ts (14+) — use typed request (3.1)

  

  For catch blocks, use catch (error: unknown) and narrow with type guards  

  Justification: Audit 06 — 470+ any occurrences, no-explicit-any disabled

- [x] 3.3 — Fix the "\_\_DELETE\_\_" as any sentinel pattern  

  File: apps/web/src/hooks/use-enhanced-file-manager.ts  

  Action: Replace the "\_\_DELETE\_\_" as any pattern with a proper discriminated union or Symbol sentinel. Use undefined or a dedicated delete action type  

  Justification: Audit 06 — fragile sentinel value pattern

Error Handling (8h)

- [x] 3.4 — Implement centralized Fastify error handler  

  File: apps/server/src/app.ts  

  Action: Add app.setErrorHandler() with:

  - Prisma error sanitization (don't expose schema details to clients)

  - Zod validation error formatting (structured field errors)

  - Consistent error response shape: { error: string, code: string, statusCode: number, details?: object }

  - Proper status code mapping (401 for auth, 403 for authorization, 404 for not found, 422 for validation)

  - Log full error server-side, send sanitized version to client  

  Justification: Audit 02/06 — no global error handler, Prisma errors leak to clients, inconsistent status codes

- [x] 3.5 — Fix silent catch blocks  

  Files: apps/server/src/modules/file/controller.ts:253, :359  

  Action: Replace empty catch blocks with proper error logging. At minimum, log the error. If the error is expected/recoverable, document why it's safe to swallow  

  Justification: Audit 06 — 2 empty catch blocks silently swallow errors

- [x] 3.6 — Fix inconsistent eslint-disable react-hooks/exhaustive-deps  

  Files: 8 files with the suppression  

  Action: Fix the actual dependency arrays instead of suppressing the rule. Common fixes: extract callbacks to useCallback, memoize derived values, properly list dependencies  

  Justification: Audit 06 — 8 suppressions indicate stale closures or missing reactive updates

Logging (4h)

- [x] 3.7 — Replace console.\* with Fastify's built-in Pino logger on the server  

  Files: apps/server/src/server.ts, all server modules  

  Action: Use request.log / app.log (Pino) instead of console.log/error/warn. Set log level via env var LOG\_LEVEL (default: "info"). Configure pino-pretty for dev, JSON output for production. Remove the \~50 console.\* calls in server code (keep the CLI scripts which legitimately use console)  

  Justification: Audit 06 — 334 console.\* occurrences, server bypasses configured Pino logger

- [x] 3.8 — Add structured logging to frontend  

  Files: apps/web/src/lib/logger.ts (new)  

  Action: Create a lightweight logger wrapper that: uses console.\* in dev, is no-op or sends to a reporting service in prod. Replace raw console.error calls in hooks and services  

  Justification: Audit 06 — 30+ raw console.error in hooks with insufficient context

Code Decomposition (8h)

- [x] 3.9 — Break up files exceeding 500 lines  

  Priority files:

  - files-table.tsx (972L) → split into files-table-columns.tsx, files-table-actions.tsx, files-table-toolbar.tsx, files-table.tsx (orchestrator)

  - reverse-share/service.ts (919L) → extract sub-services: reverse-share-upload.service.ts, reverse-share-multipart.service.ts

  - received-files-modal.tsx (918L) → extract list component, file item component, actions

  - files-grid.tsx (917L) → extract grid item component, grid toolbar

  - file/controller.ts (770L) → extract upload controller, embed controller

  

  Justification: Audit 06 — 15 files exceed 500 lines, concentrated in reverse-share domain

Miscellaneous Quality (2h)

- [x] 3.10 — Fix typo in filename  

  File: apps/web/src/utils/unahthenticated-only-paths.ts → unauthenticated-only-paths.ts  

  Action: Rename file and update all imports  

  Justification: Audit 06 — typo unahthenticated

- [x] 3.11 — Unify PrismaClient to singleton  

  Files: apps/server/src/modules/user/service.ts:16, apps/server/src/modules/storage/service.ts:11  

  Action: Replace new PrismaClient() in UserService and StorageService with the singleton import from src/shared/prisma.ts  

  Justification: Audit 02 — multiple PrismaClient instances waste connections and conflict with SQLite's single-writer lock

- [x] 3.12 — Use Prisma migrations instead of schema push  

  Files: apps/server/prisma/  

  Action: Initialize migration history with prisma migrate dev --name init. Use prisma migrate deploy in production (Docker entrypoint). This enables rollback and migration tracking  

  Justification: Audit 02 — no migration history, only schema push, no rollback capability

- [x] 3.13 — Replace trivial smoke tests with real integration tests  

  Files: apps/server/src/__tests__/health.test.ts, apps/web/src/__tests__/smoke.test.tsx  

  Action: Server: use Fastify inject() to boot the app and test /health endpoint. Web: render a component with next-intl provider and assert i18n works. Replace current tests that only verify imports  

  Justification: Post-Phase 1 review S5 — current smoke tests only verify that modules are importable, not that the app works

- [x] 3.14 — Review and fix Knip configuration for docs MDX  

  File: knip.json  

  Action: Evaluate if Knip can reliably parse MDX imports in apps/docs. If not, add docs-specific ignoreDependencies for packages only consumed via MDX content files. Run knip and verify false positive rate is acceptable  

  Justification: Post-Phase 1 review S6 — MDX entry points removed from knip.json due to unreliable parsing

- [x] 3.15 — Add unit test for proxy route resolution ordering (Phase 2 review S2)

  File: apps/web/src/lib/\_\_tests\_\_/proxy-routes.test.ts (new)

  Action: Write a test that verifies each known frontend API call resolves to the correct route config. The route table relies on static-before-dynamic ordering which is easy to break when adding routes.

  Justification: Phase 2 review S2 — route ordering is a maintenance trap

- [x] 3.16 — Clean up extractFilenameFromContentDisposition regex (Phase 2 review S5)

  File: packages/shared/src/mime-types.ts

  Action: The greedy capture `[^";\r\n]*` makes the trailing `["]?` dead. Also only handles UTF-8 per RFC 5987. Tighten the regex and document encoding limitations.

  Justification: Phase 2 review S5

- [x] 3.17 — Keep subpath export pattern for packages/shared (Phase 2 review W9)

  File: packages/shared/package.json

  Action: When adding more utilities to packages/shared, use subpath exports (`"./foo"`, `"./bar"`) rather than a catch-all `"."` barrel export. Subpath imports keep tree-shaking optimal.

  Justification: Phase 2 review W9 — architectural guidance

---

Phase 4: Frontend Modernization ⚡

> Goal: Server-state management, error boundaries, performance, accessibility.  

> Estimated effort: \~40h

Error Recovery (4h)

- [x] 4.1 — Add error.tsx boundaries on every route segment  

  Files: apps/web/src/app/error.tsx (root), plus per-segment: dashboard/error.tsx, files/error.tsx, (shares)/error.tsx, settings/error.tsx, profile/error.tsx, etc.  

  Action: Create error boundaries with:

  - User-friendly error message (not stack trace)

  - "Try again" button calling reset()

  - "Go home" link

  - Error reporting to logger (Phase 3.8)

  

  Root error.tsx catches everything. Segment-level ones provide contextual recovery  

  Justification: Audit 03 critical — ZERO error boundaries, any unhandled error crashes the entire app to white screen

- [x] 4.2 — Add loading.tsx streaming boundaries  

  Files: apps/web/src/app/loading.tsx (root), plus per-segment: dashboard/loading.tsx, files/loading.tsx, (shares)/loading.tsx  

  Action: Create loading states with skeleton UI matching the page layout. Use shadcn/ui Skeleton component. Consider Suspense boundaries within pages for granular loading  

  Justification: Audit 03 critical — ZERO loading states, pages show nothing during navigation/data fetching

Server-State Management (16h)

- [x] 4.3 — Integrate TanStack Query (React Query v5)  

  Files: apps/web/package.json, apps/web/src/providers/query-provider.tsx (new), all data-fetching hooks  

  Action:

  1. Install @tanstack/react-query and @tanstack/react-query-devtools

  2. Create QueryClientProvider wrapper in app layout

  3. Refactor data fetching into custom hooks using useQuery / useMutation:

     - useShares(), useShare(id), useCreateShare()

     - useFiles(), useFile(id), useUploadFile()

     - useUser(), useUsers(), useUpdateProfile()

     - useAppInfo(), useAppConfig()

  4. Configure staleTime, gcTime, cache invalidation on mutations

  5. Add queryClient.prefetchQuery() in server components where possible  

  Justification: Audit 03 critical — no server-state library, every component calls axios directly, no cache/dedup/SWR

- [x] 4.4 — Add Axios response interceptor for 401 handling  

  File: apps/web/src/http/client.ts or equivalent  

  Action: Add response interceptor that catches 401 errors globally, clears auth state, and redirects to login. Integrate with TanStack Query's onError for automatic retry on token refresh  

  Justification: Audit 03 — no centralized 401 handling, auth expiration only detected at initial check

- [x] 4.5 — Unify state management paradigm  

  Files: apps/web/src/contexts/app-info-context.tsx, apps/web/src/contexts/auth-context.tsx  

  Action: With TanStack Query handling server-state:

  - Move app-info data fetching to a useAppInfo() query hook (replace Zustand store)

  - Keep auth context for client-only state (isAuthenticated, current user) but feed it from a TanStack Query useCurrentUser() hook

  - Move Zustand store out of contexts/ directory if kept, or replace entirely  

  Justification: Audit 03 — mixed paradigms (Zustand + Context), Zustand store in contexts/ directory

Performance (8h)

- [x] 4.6 — Lazy-load Google Fonts based on user selection  

  File: apps/web/src/app/layout.tsx  

  Action: Load only the default font (Outfit) in the root layout. Load the user-selected font dynamically via next/font/google with display: 'swap' in a client component that reads the user's customization setting. Remove the 10 preloaded font declarations  

  Justification: Audit 01/03 — 11 Google Fonts loaded on every page regardless of selection, significant LCP impact

- [x] 4.7 — Add React.lazy / next/dynamic for heavy components  

  Files: Large modals, table components, upload components  

  Action: Dynamically import:

  - Upload modal (Uppy is heavy)

  - Share details modal (682L)

  - Edit reverse share modal (724L)

  - QR code components

  - File manager grid/table views (load on viewport visibility)

  

  Use next/dynamic with loading fallback components  

  Justification: Audit 03 — zero lazy loading, only 1 dynamic import in entire app

- [x] 4.8 — Replace <img> with next/image  

  Files: All components using raw <img> tags  

  Action: Re-enable the @next/next/no-img-element rule (or Biome equivalent). Replace <img> with <Image> from next/image for automatic optimization (WebP/AVIF, responsive sizes, lazy loading)  

  Justification: Audit 03 — ESLint rule disabled, missing image optimization

Accessibility (4h)

- [x] 4.9 — Add skip-to-content link  

  File: apps/web/src/app/layout.tsx or main layout component  

  Action: Add <a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a> as the first focusable element. Add id="main-content" to the main content area  

  Justification: Audit 03 — no skip-to-content link

- [x] 4.10 — Add focus management on route changes  

  File: apps/web/src/components/layout/ or root layout  

  Action: Use Next.js App Router's built-in focus management or add a custom hook that focuses the main content heading on route change. This is essential for screen reader users  

  Justification: Audit 03 — no focus management on route change

- [x] 4.11 — Add keyboard alternative for drag \& drop  

  File: File manager components, upload components  

  Action: Ensure all drag-and-drop actions have keyboard equivalents. For file manager: allow selecting via checkbox + action buttons. For upload: the file input already works. Ensure the custom DnD implementation supports onKeyDown for reordering  

  Justification: Audit 03 — custom DnD is mouse-only

- [x] 4.12 — Fix RTL support for Persian and Hebrew  

  File: apps/web/src/app/layout.tsx:104  

  Action: Change RTL detection from locale === "ar-SA" to ["ar-SA", "fa-IR", "he-IL"].includes(locale). Apply dir="rtl" to the HTML element for all RTL languages  

  Justification: Audit 03 — Persian and Hebrew are RTL languages but only Arabic triggers RTL

Component Deduplication (2h)

- [x] 4.14 — Extract shared UI primitives from duplicated file/folder row splits (Phase 3 QA-8)

  Files: apps/web/src/app/files/components/files-table-file-row.tsx, files-table-folder-row.tsx, files-grid-file-card.tsx, files-grid-folder-card.tsx

  Action: The Phase 3 file splits created ~100-120 lines of cross-file duplication: identical inline-edit UI (input + confirm/cancel buttons), checkbox selection blocks, and icon imports duplicated across file-row vs folder-row (and file-card vs folder-card). Extract `<EditableField>` and `<SelectionCheckbox>` components. Do a broader scan across all split components for other duplicated patterns. Goal: modifying inline-edit UX should require editing 1 file, not 4.

  Justification: Phase 3 quality audit QA-8 — mechanical splits increased file count but created maintenance burden

- [x] 4.15 — Consolidate duplicated File/Folder type interfaces into canonical imports

  Files: 11 files across apps/web/src/ define local File/Folder interfaces duplicating files-table-types.ts

  Action: 21 local type interfaces found duplicating the canonical FileItem/FolderItem types. 7 are exact duplicates (files-view-manager.tsx, share-details.tsx, files/page.tsx, dashboard-files-view.tsx, use-enhanced-file-manager.ts BulkFolder) — replace with imports. 10 are subsets — replace with Pick<FileItem, ...> or Pick<FolderItem, ...>. 4 are API-layer variants in http/endpoints/*/types.ts with meaningful null vs undefined and size type differences — these represent the real API/UI type boundary and should be kept as distinct types but renamed for clarity (e.g. ApiFileItem vs FileItem). The api-mappers.ts module (QA-4) already bridges this gap at runtime; the types should reflect that architecture.

  Justification: Phase 3 quality audit follow-up — QA-4 agent flagged type duplication beyond its scope

Middleware (2h)

- [x] 4.13 — Add Next.js middleware for route protection  

  File: apps/web/src/middleware.ts (new)  

  Action: Create middleware that checks for the auth cookie on protected routes and redirects to /login if absent. This provides server-side route protection instead of relying solely on client-side ProtectedRoute component  

  Justification: Audit 03 — no middleware.ts, route protection is purely client-side

---

Phase 5: Backend Hardening 🛡️

> Goal: Validation improvements, auth hardening, data layer cleanup, CSRF protection.  

> Estimated effort: \~28h

Validation \& Content Security (8h)

- [ ] 5.1 — Implement file content validation (magic bytes)  

  Files: apps/server/src/modules/file/controller.ts, new utility  

  Action: Install file-type package. After file registration (POST /files), verify magic bytes match the declared MIME type. Implement an extension allowlist/blocklist configurable via app settings. Reject suspicious mismatches (e.g., .jpg with application/x-executable magic bytes)  

  Justification: Audit H4/05 — zero server-side file content validation

- [ ] 5.2 — Validate file size at presigned URL generation time  

  File: apps/server/src/modules/file/controller.ts  

  Action: When generating presigned PUT URLs, include Content-Length condition in the presigned URL policy. Set max upload size based on user's quota/plan. Add a cron job to clean orphaned S3 objects (uploaded but never registered)  

  Justification: Audit 02 — file size only validated at registration, not at upload. Users can upload 100GB then fail registration, leaving orphaned data

- [ ] 5.3 — Fix password validation consistency  

  File: apps/server/src/modules/auth/dto.ts  

  Action: LoginSchema and RegisterSchema should both use the dynamic password policy (fetched from app config), not a hardcoded min(6). Create a shared password validation function  

  Justification: Audit 02 — LoginSchema hardcodes min(6) while dynamic policy may require more

Auth Improvements (8h)

- [ ] 5.4 — Implement CSRF protection  

  File: apps/server/src/app.ts, apps/web  

  Action: Install @fastify/csrf-protection. Implement double-submit cookie pattern: generate CSRF token, set as cookie, require it in X-CSRF-Token header on state-changing requests. Add CSRF token handling to the frontend Axios instance  

  Justification: Audit M3/05 — with credentials: true and cookie auth, CSRF attacks are possible even after fixing CORS

- [ ] 5.5 — Sign the JWT cookie  

  File: apps/server/src/app.ts:79-81  

  Action: Change signed: false to signed: true and configure a cookie signing secret (separate from JWT secret). This adds integrity verification by Fastify's cookie plugin  

  Justification: Audit M4 — cookie signed: false means no integrity check by Fastify

- [ ] 5.6 — Fix admin detection logic  

  Files: apps/server/src/modules/user/service.ts:33-34, apps/server/src/modules/app/routes.ts:11-32  

  Action: Don't use usersCount === 0 or usersCount <= 1 for admin detection in ongoing operations. The "first user is admin" pattern should only apply during initial setup. After that, use the isAdmin flag from the user record. The adminPreValidation should always require auth when usersCount > 0  

  Justification: Audit 02/M2 — admin bypass when ≤1 users

- [ ] 5.7 — Restrict trustProxy configuration  

  File: apps/server/src/app.ts:34  

  Action: Change trustProxy: true to a configurable value via env var TRUST\_PROXY (default: "loopback" for localhost proxy). Accept specific CIDR ranges for known reverse proxy IPs  

  Justification: Audit 02 — trustProxy: true trusts all proxy headers, IP spoofing

- [ ] 5.8 — Protect Swagger/API docs in production  

  File: apps/server/src/app.ts:92-102  

  Action: Conditionally register Swagger/Scalar only when NODE\_ENV !== "production" or when an env var ENABLE\_API\_DOCS=true is set. In production, these endpoints should require admin auth or be disabled entirely  

  Justification: Audit M1 — full API documentation publicly accessible

Data Layer (4h)

- [ ] 5.9 — Use crypto.randomUUID() instead of Math.random() for object names  

  File: apps/server/src/modules/file/controller.ts:46,667  

  Action: Replace Math.random() in file object name generation with crypto.randomUUID(). This provides cryptographically random, non-enumerable identifiers  

  Justification: Audit L3 — Math.random() is predictable, aids enumeration attacks

- [ ] 5.10 — Sanitize filenames for path traversal characters  

  File: apps/server/src/modules/file/controller.ts:46  

  Action: Sanitize uploaded filenames: strip path separators (/, \\), null bytes, leading dots. Use a library like sanitize-filename or write a focused utility  

  Justification: Audit L1 — filenames not sanitized for path characters

- [ ] 5.11 — Sanitize error messages sent to clients  

  Files: All controllers' catch blocks  

  Action: Never send raw error messages to clients. Map known errors to user-friendly messages. Log the full error server-side. This is partially covered by Phase 3.4's centralized error handler, but verify all controllers go through it  

  Justification: Audit L2 — implementation details exposed in error messages

Port Configuration (1h)

- [ ] 5.12 — Make server port configurable via env var  

  File: apps/server/src/server.ts:87  

  Action: Replace hardcoded 3333 with process.env.PORT || 3333  

  Justification: Audit 02 — port hardcoded, not configurable

- [ ] 5.13 — Require 2FA code (or backup code) to disable 2FA  

  Files: apps/server/src/modules/two-factor/service.ts, apps/server/src/modules/two-factor/controller.ts, apps/server/src/modules/two-factor/routes.ts  

  Action: Currently disabling 2FA only requires the user password. An attacker with the password can bypass 2FA by disabling it. Require a valid TOTP code or backup code in addition to the password when disabling 2FA  

  Justification: Post-Phase 1 review W13 — defense-in-depth for 2FA

- [ ] 5.14 — Standardize cookie:false on public proxy routes (Phase 2 review S3)

  File: apps/web/src/lib/proxy-routes.ts

  Action: Public endpoints (reverse-shares/alias/\*, shares/access, invite-tokens) should all set `cookie: false`. Some already do, some don't. Audit all routes and standardize based on whether auth is required.

  Justification: Phase 2 review S3 — inconsistent cookie forwarding

- [ ] 5.15 — Validate OAuth redirect URLs against allowlist (Phase 2 review S6)

  File: apps/web/src/lib/proxy.ts

  Action: When handling OAuth redirects, validate that the Location URL matches a known OAuth provider hostname or is same-origin. Defense in depth against open redirect.

  Justification: Phase 2 review S6

Note: S4 (X-Forwarded-For trust without TRUST\_PROXY) is already covered by item 5.7 above.

- [ ] 5.17 — Prefer `filename*` over `filename` in Content-Disposition parsing (Phase 3 review M-3)

  File: packages/shared/src/mime-types.ts

  Action: Per RFC 6266, when both `filename*` and `filename` are present in a Content-Disposition header, `filename*` should be preferred (it supports full UTF-8 encoding). Current regex returns whichever appears first. Implement two-pass: first scan for `filename*=`, fall back to `filename=`.

  Justification: Phase 3 review M-3 — pre-existing, not introduced by Phase 3

- [ ] 5.16 — Migrate controllers to use the centralized error handler (Phase 3 review I-2)

  Files: All server controller files (~15 files)

  Action: Remove try/catch wrappers from controller handlers. Let errors propagate to globalErrorHandler (registered in app.ts). This unifies the error response shape to `{ error, code, statusCode, details? }` instead of the current mix of global handler + per-controller `{ error: "..." }`. Consider adopting an AppError class for domain-specific errors.

  Justification: Phase 3 review I-2 — globalErrorHandler exists but is mostly bypassed by controller-level catch blocks, creating two inconsistent error response shapes.

---

Phase 6: Infrastructure \& Operations 🐳

> Goal: Hardened Docker setup, proper MinIO security, monitoring, reliable deployment.  

> Estimated effort: \~24h

Docker Improvements (8h)

- [ ] 6.1 — Move MinIO installation to a dedicated build stage or runtime-only  

  File: Dockerfile:16-21  

  Action: Install MinIO only in the final runner stage, not in the base stage. This avoids bloating intermediate build layers with +100MB  

  Justification: Audit 04 — MinIO in base stage inflates build cache

- [ ] 6.2 — Extract the 100-line heredoc startup script  

  Files: Dockerfile:145-248, infra/start.sh (new)  

  Action: Move the inline heredoc startup script to infra/start.sh. COPY it in the Dockerfile. This makes it testable and readable independently  

  Justification: Audit 04 — 100-line heredoc inline in Dockerfile, untestable

- [ ] 6.3 — Fix the VOLUME declaration  

  File: Dockerfile:253  

  Action: Remove VOLUME ["/app/server"] from Dockerfile. Volumes should be declared in docker-compose.yaml only, not baked into the image. Baked-in VOLUME creates anonymous volumes if not explicitly mapped, risking data loss  

  Justification: Audit 04 — VOLUME creates anonymous volumes by default

- [ ] 6.4 — Harmonize UID/GID defaults  

  Files: Dockerfile:87, infra/server-start.sh:34, infra/start-minio.sh  

  Action: Use 1001 consistently everywhere as the default UID/GID  

  Justification: Audit 04 — UID/GID 1000 in server-start.sh vs 1001 in Dockerfile

- [ ] 6.5 — Fix docker-compose.yaml STORAGE\_URL  

  File: docker-compose.yaml:35  

  Action: Change STORAGE\_URL: "https://ouitransfer-demo:9379" to use the container's internal hostname or localhost. Document clearly which URL should be used. Make scheme consistent with S3\_USE\_SSL setting  

  Justification: Audit 04 critical — placeholder hostname that doesn't work

MinIO Security (4h)

- [ ] 6.6 — Create a dedicated MinIO service account  

  File: infra/minio-setup.sh  

  Action: After MinIO starts, create a dedicated service account with limited permissions (only the bucket used by the app). Store service account credentials. Don't use root credentials for application access  

  Justification: Audit 04 — app uses root MinIO credentials, has full admin access

- [ ] 6.7 — Fix credential file permissions  

  File: infra/minio-setup.sh:109  

  Action: Change chmod 644 to chmod 600 for the credentials file  

  Justification: Audit 04 — credentials world-readable

- [ ] 6.8 — Stop deleting .minio.sys on every startup  

  File: infra/start-minio.sh:25-28  

  Action: Remove the rm -rf .minio.sys on startup. If there's a specific bug this works around, document it and find a targeted fix  

  Justification: Audit 04 — force-regenerating internal metadata can break persisted IAM policies

Binary Verification (2h)

- [ ] 6.9 — Add SHA256 checksum verification for downloaded binaries  

  Files: infra/install-minio.sh, infra/install-mc.sh  

  Action: After downloading MinIO server and client binaries, verify SHA256 checksums against known-good values. Pin the mc client version (currently unpinned, unlike the server)  

  Justification: Audit 04 — no integrity verification on downloaded binaries, mc version not pinned

Build Script (1h)

- [ ] 6.10 — Delete infra/build-docker.sh (superseded by CI)  

  File: infra/build-docker.sh  

  Action: Delete the interactive build script entirely. Docker builds are now handled by .github/workflows/docker.yml (triggered on v* tags). No production users, no legacy to maintain. For local builds, use `docker compose build` or `just build`  

  Justification: Audit 04 — interactive script with forced --push, now fully replaced by GitHub Actions CI

Monitoring (4h)

- [ ] 6.11 — Add structured health check endpoint  

  File: apps/server/src/modules/health/  

  Action: Enhance the health endpoint to return structured data: { status: "ok", checks: { database: "ok", storage: "ok", uptime: 12345 } }. Check actual database connectivity and S3 accessibility, not just "server is running"  

  Justification: Production readiness — current health check is superficial

- [ ] 6.12 — Add Docker Compose healthcheck for API  

  File: docker-compose.yaml  

  Action: Add healthcheck for the API service (currently only web port 5487 is checked). Add depends\_on with condition: service\_healthy  

  Justification: Ensure proper startup ordering and failure detection

Secrets Management (2h)

- [x] 6.13 — Stabilize JWT secret generation  

  File: apps/server/src/app.ts:15-19  

  Action: If no JWT secret exists in DB at first boot, generate one and immediately persist it. Verify at every subsequent boot that the secret in DB is consistent. Add a startup warning if the secret changes. Consider loading from env var JWT\_SECRET with DB as fallback  

  Justification: Audit 02 — risk of secret regeneration invalidating all tokens

- [ ] 6.14 — Remove SMTP placeholder credentials from seed  

  File: apps/server/prisma/seed.js:106-112  

  Action: Remove placeholder SMTP credentials. Use empty/null values that prompt the admin to configure SMTP on first access  

  Justification: Audit L4 — seed contains placeholder credentials

- [ ] 6.15 — Evaluate pnpm deploy for portable Docker runtime (Phase 2 review W10)

  File: Dockerfile

  Action: The current Docker build relies on pnpm symlinks created at deps stage pointing to paths resolved later. This works but is fragile. Evaluate using `pnpm deploy` to produce a flat, self-contained runtime directory that doesn't depend on symlink resolution.

  Justification: Phase 2 review W10 — Dockerfile pnpm symlink chain fragility

- [ ] 6.16 — Fix lefthook pre-commit hook for large commits on Windows (Phase 3 review)

  File: lefthook.yml

  Action: The `{staged_files}` expansion exceeds Windows ~8191 char command-line limit when >100 files are staged. Switch to `--stdin` mode or use `run: pnpm exec biome check --write --unsafe --changed --since=HEAD` instead of passing individual file paths.

  Justification: Phase 3 review — commit with 167 files failed with "La ligne de commande est trop longue"

---

Phase 7: Dependency Modernization 📦

> Goal: Replace abandoned/vulnerable packages, consolidate duplicates, clean up dependency tree.  

> Estimated effort: \~20h

Critical Replacements (12h)

- [x] 7.1 — Replace speakeasy with otpauth  

  Files: apps/server/src/modules/two-factor/, apps/server/package.json  

  Action: Install otpauth. Rewrite TOTP generation and verification to use otpauth API. Critical: write a migration path for existing users' TOTP secrets (test that otpauth can verify codes generated with the same base32 secrets that speakeasy used). Remove speakeasy and @types/speakeasy  

  Tool: otpauth (actively maintained, TypeScript native, standard-compliant)  

  Justification: Audit D2 — speakeasy abandoned since 2017, 9 years without security patches, manages TOTP secrets

- [x] 7.2 — Replace crypto-js with Node.js native crypto  

  Files: apps/server/src/, apps/server/package.json  

  Action: Find all crypto-js usages (likely encryption/hashing). Replace with crypto.createCipheriv, crypto.createHash, crypto.pbkdf2, etc. Remove crypto-js and @types/crypto-js from dependencies  

  Tool: Node.js built-in crypto module  

  Justification: Audit D1 — CVE-2023-46233, PBKDF2 uses 1 iteration by default, weak PRNG

- [x] 7.3 — Replace react-qr-reader with maintained alternative  

  Files: apps/web/src/, apps/web/package.json  

  Action: Replace react-qr-reader (archived beta) with @yudiel/react-qr-scanner or html5-qrcode. Update the QR scanning component (likely used for 2FA setup)  

  Justification: Audit D3 — archived beta version with camera access, no security patches

Cleanup \& Consolidation (8h)

- [ ] 7.4 — Consolidate icon libraries to lucide-react only  

  Files: apps/web/package.json, all components using @tabler/icons-react or react-icons  

  Action: Audit all icon usage (Knip can help). Replace @tabler/icons-react and react-icons imports with lucide-react equivalents. Lucide has 1500+ icons, covers virtually all use cases. Remove @tabler/icons-react and react-icons  

  Justification: Audit 07 — 3 icon libraries is excessive, increases bundle size

- [ ] 7.5 — Remove node-fetch, use native fetch  

  File: apps/server/package.json, all server files importing node-fetch  

  Action: Replace node-fetch imports with global fetch (available since Node 18, stable in Node 21+). The project uses Node 24  

  Justification: Audit 07 — node-fetch is superseded by native fetch in Node 18+

- [ ] 7.6 — Remove redundant ts-node, keep only tsx  

  File: apps/server/package.json  

  Action: Remove ts-node devDependency. Update prisma.seed script to use tsx instead of ts-node. tsx is faster and handles ESM/CJS automatically  

  Justification: Audit 07 — redundant, tsx does everything ts-node does but better

- [ ] 7.7 — Replace nookies with Next.js native cookies  

  File: apps/web/package.json, files using nookies  

  Action: Replace nookies usage with next/headers cookies() API (App Router native) for server-side cookie access, and document.cookie or a lightweight wrapper for client-side. nookies was designed for Pages Router  

  Justification: Audit 07 — stale since 2022, designed for Pages Router, App Router has native alternatives

- [ ] 7.8 — Rename framer-motion to motion  

  File: apps/web/package.json  

  Action: Replace framer-motion with motion (the package was officially renamed). Update all imports from framer-motion to motion/react. The docs app already uses motion correctly  

  Justification: Audit 07 — inconsistency, framer-motion is the legacy name

- [ ] 7.9 — Move @types/\* from dependencies to devDependencies  

  Files: apps/server/package.json (@types/crypto-js), apps/web/package.json (@types/react-dropzone)  

  Action: Move type packages to devDependencies. They're not needed at runtime  

  Justification: Audit 07 — @types/\* in production dependencies

- [ ] 7.10 — Align Prisma CLI and Client versions  

  File: apps/server/package.json  

  Action: Change prisma devDependency from ^6.3.1 to ^6.11.0 to match @prisma/client  

  Justification: Audit 07 — version mismatch between CLI and client

---

Phase 8: Polish \& Production Readiness ✨

> Goal: Documentation, final security review, performance audit, production hardening.  

> Estimated effort: \~20h

Documentation (4h)

- [ ] 8.1 — Add LICENSE file at repository root  

  File: LICENSE (new, root)  

  Action: Create Apache-2.0 license file. It's declared in package.json but the actual file is missing  

  Justification: Audit 07 — license declared but file absent

- [ ] 8.2 — Update CONTRIBUTING.md with new tooling  

  File: CONTRIBUTING.md  

  Action: Document: just commands, Biome formatting, conventional commit format, test writing guidelines, PR template expectations. Remove references to make  

  Justification: New tooling from Phase 1 needs documentation

- [ ] 8.3 — Add README.md to apps/server/src/ and apps/web/src/  

  Files: apps/server/src/README.md (new), apps/web/src/README.md (new)  

  Action: Brief architecture guides: module structure, key patterns, how to add new features  

  Justification: Audit 06 — no source README in either app

Upload Resume (8h)

- [ ] 8.4 — Implement upload resume for multipart uploads  

  File: apps/web/src/hooks/useUppyUpload.ts  

  Action: Implement the listParts callback that currently returns [] with a TODO comment. Store upload state (uploadId, completed parts) in localStorage. On retry, resume from the last completed part instead of restarting  

  Justification: Audit 03 — upload resume not implemented, large file uploads restart from zero on failure

Performance Audit (4h)

- [ ] 8.5 — Run Lighthouse CI and fix major issues  

  Action: Set up @lhci/cli in CI. Run Lighthouse on key pages (home, login, dashboard, file manager, share view). Target scores: Performance >90, Accessibility >95, Best Practices >95, SEO >90. Fix any major findings  

  Justification: No performance baseline exists

- [ ] 8.6 — Add @next/bundle-analyzer for bundle size monitoring  

  File: apps/web/next.config.ts  

  Action: Install and configure bundle analyzer. Run periodically to catch bundle size regressions. Add to CI as an optional check with size limit thresholds  

  Justification: With 3 icon libraries and heavy dependencies, bundle size is likely bloated

Final Security Review (4h)

- [ ] 8.7 — Run pnpm audit and resolve all findings  

  Action: After all dependency changes, run pnpm audit to verify zero known vulnerabilities. Add pnpm audit --audit-level=high to CI pipeline  

  Justification: Final verification after all dependency changes

- [ ] 8.8 — Add security headers via Fastify  

  File: apps/server/src/app.ts  

  Action: Install @fastify/helmet. Configure with appropriate CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy headers  

  Justification: No security headers configured

- [ ] 8.9 — Add Content Security Policy to Next.js  

  File: apps/web/next.config.ts or apps/web/src/middleware.ts  

  Action: Configure CSP headers: restrict script-src, style-src, img-src, connect-src to known origins. Use nonces for inline scripts  

  Justification: Defense-in-depth, no CSP exists

- [ ] 8.10 — Validate all env vars at startup  

  Files: apps/server/src/config/, apps/web/src/env.ts (new)  

  Action: Server: validate all required env vars at boot using Zod (print clear error messages for missing/invalid vars, fail fast). Web: use @t3-oss/env-nextjs or a custom Zod validation for NEXT\_PUBLIC\_\* and server-side env vars  

  Justification: Audit 02 — STORAGE\_URL required but not validated at startup, API\_BASE\_URL has a typo in example

- [ ] 8.11 — Configure timeout values for production  

  File: apps/server/src/app.ts:31-33  

  Action: Set reasonable timeouts: connectionTimeout: 30000 (30s), requestTimeout: 300000 (5min for uploads), keepAliveTimeout: 30000 (30s). These are currently all 0 (disabled) which enables slowloris DoS  

  Justification: Audit 02 — all timeouts disabled, slowloris vulnerability

- [ ] 8.12 — Add a11y testing to CI  

  Action: Install @axe-core/playwright. Add accessibility checks to Playwright E2E tests using checkA11y(). Configure rules severity (critical = fail, moderate = warn)  

  Justification: Audit 03 — no formal a11y testing

- [ ] 8.13 — QA validate OAuth flow through proxy (Phase 2 review W1)

  Action: End-to-end test the OAuth authorize/callback flow through the new catch-all proxy. The proxy now uses `text()` instead of `json()` for non-redirect OAuth responses, which is more correct but untested. Verify error cases where upstream returns non-JSON.

  Justification: Phase 2 review W1 — OAuth authorize response shape changed

- [ ] 8.14 — Evaluate proxy route matcher performance (Phase 2 review S1)

  File: apps/web/src/lib/proxy.ts

  Action: The route matcher is O(n) scanning 122 routes per request. Fine at current scale (~microseconds). If route count grows significantly, consider bucketing by method then segment count, or pre-compiling to a trie.

  Justification: Phase 2 review S1 — performance note

- [x] 8.15 — ~~PrismaClient singleton: add globalThis memoization for HMR/test reloads (Phase 3 review M-1)~~ — **CLOSED: not applicable**. Server uses `tsx watch` which restarts the process on file changes (no HMR). The `globalThis` memoization pattern is a Next.js-specific concern. Prisma is not used in the Next.js app (proxies to Fastify). If Prisma usage is ever added to `apps/web/` server components, revisit then.

- [ ] 8.16 — Expand health test and web smoke test to cover real app logic (Phase 3 review M-5/M-6)

  Files: apps/server/src/\_\_tests\_\_/health.test.ts, apps/web/src/\_\_tests\_\_/smoke.test.tsx

  Action: Health test currently has a single 200-status assertion — expand to exercise the global error handler, auth middleware, or at minimum test error paths. Web smoke test tests the shadcn Button (third-party) — replace with tests for actual app components or hooks. Consider renaming health.test.ts to health.smoke.test.ts if it stays minimal.

  Justification: Phase 3 review M-5/M-6

- [ ] 8.17 — Add JSDoc comment to frontend logger about module-load env capture (Phase 3 review M-4)

  File: apps/web/src/lib/logger.ts

  Action: `NEXT_PUBLIC_LOG_LEVEL` is captured once at module evaluation time. Runtime overrides won't work. Add a JSDoc comment documenting this intentional design constraint.

  Justification: Phase 3 review M-4 — trivial but worth documenting for future developers

- [ ] 8.18 — Honest frontend logger: rename or upgrade (Phase 3 QA-9)

  File: apps/web/src/lib/logger.ts

  Action: The frontend "structured logger" is a 37-line console wrapper with level filtering — no JSON serialization, no transports, no redaction, no correlation IDs. Either (a) rename references in docs/code comments to "client logger" / "level-filtered logger" to avoid misleading claims, or (b) back it with a real transport (Sentry breadcrumbs, OpenTelemetry browser SDK, etc.) for production builds. Also: ~54% of call sites pass only `{ err }` with no real context — review and enrich where meaningful.

  Justification: Phase 3 quality audit QA-9

- [ ] 8.19 — Translate placeholder strings in non-English locales  

  Files: apps/web/messages/\*.json (22 non-en-US locale files)  

  Action: During Phase 4 post-review, 15 strings were added as English placeholders to all 22 non-en-US locales: 13 keys under the \`errors\` namespace (\`somethingWentWrong\`, \`tryAgain\`, \`goHome\`, \`pageNotFound\`, \`pageNotFoundMessage\`, \`shareUnavailable\`, \`shareErrorMessage\`, \`uploadUnavailable\`, \`uploadErrorMessage\`, \`accessDenied\`, \`accessDeniedMessage\`, \`errorLoadingSettings\`, \`refreshPage\`), 1 key under \`a11y\` (\`skipToContent\`), and 1 key under \`auth\` (\`sessionExpired\`). Arabic, Japanese, Chinese etc. users see these in English. Replace with proper translations or configure next-intl \`getMessageFallback\` to explicitly show the English value with a visual indicator.  

  Justification: Phase 4 post-review A-I1, C-C2, B-I3 — English placeholders committed per existing pattern but never replaced with real translations

- [ ] 8.20 — Implement E2E CI workflow with full application stack

  File: .github/workflows/e2e.yml

  Action: The e2e.yml workflow exists but is disabled (if: false) because no app stack is started before tests run. Implement the prerequisites:
  1. Start the full stack via docker compose before tests (API port 3333, Web port 3000, MinIO)
  2. Wait for services to be healthy (use healthcheck or polling)
  3. Seed the database with test fixtures (prisma db seed against the containerized DB)
  4. Configure playwright.config.ts baseURL to point at the running stack
  5. Re-enable the job by removing the \`if: false\` guard
  This item bundles the intent of the original item 1.17 which was marked done but implemented as a non-functional placeholder.

  Justification: e2e.yml job disabled — no server running when Playwright tests execute

- [ ] 8.21 — Add test coverage reporting to CI *(optional — evaluate when project is in maintenance phase)*

  File: .github/workflows/ci.yml

  Note: Deferred. Coverage reporting in CI adds value only when (a) a minimum threshold is enforced (build fails below X%) and (b) someone actively monitors the trend. At the current stage (active development, pre-production), it adds CI overhead without proportional benefit. `just test-coverage` is available locally for on-demand inspection.

  Action when ready: Upload coverage reports as GitHub Actions artifacts (free, no external service). Optionally integrate Codecov (free for public repos, paid for private — repo is currently private) or Coveralls. Add a coverage threshold via vitest's \`thresholds\` config option before enabling CI enforcement.

  Justification: Item 1.15 specified coverage upload to Codecov but it was never implemented. Repo is private so Codecov would require a paid plan.

---

Summary \& Metrics

Phase	Items	Estimated Effort	Blocking

Phase 0: Security Emergency	16	\~20h	YES — no deployment before completion

Phase 1: Tooling \& DX Foundation	21	\~40h	YES — no safe development without this

Phase 2: Architecture Restructuring	8	\~24h	Partial — shared packages needed for Phase 3

Phase 3: Code Quality \& Type Safety	17	\~40h	No — but debt compounds fast

Phase 4: Frontend Modernization	15	\~40h	No — but UX suffers

Phase 5: Backend Hardening	17	\~28h	No — but attack surface remains

Phase 6: Infrastructure \& Operations	16	\~24h	No — but operational risk

Phase 7: Dependency Modernization	10	\~20h	Partial — critical deps in Phase 0/1

Phase 8: Polish \& Production Readiness	19	\~20h	No — but not production-grade without it

TOTAL	139 items	\~256h	 

Execution Notes

1\. Phase 0 and Phase 1 should overlap: Start Phase 1 tooling setup immediately after Phase 0 security fixes. Having Vitest ready before writing Phase 0 regression tests is ideal — but don't delay security fixes waiting for test infra.

2\. Phase 7 items 7.1-7.3 should be done in Phase 1: The speakeasy, crypto-js, and react-qr-reader replacements are security-critical and shouldn't wait for Phase 7. They're listed in Phase 7 for organizational clarity but should execute during Phase 1.

3\. Phase 2 enables Phase 3: The shared packages and consolidated configs from Phase 2 make the type safety work in Phase 3 much easier (shared types across apps).

4\. Biome is the clear winner for this stack: After evaluating ESLint+Prettier vs Biome vs oxlint+dprint:

   - Biome: single binary, lint+format, 10-100x faster, growing rule set (250+ rules), native import sorting, good TypeScript/React support. The only gap is Next.js-specific rules (\~5 rules) which can be supplemented minimally.

   - The @ianvs/prettier-plugin-sort-imports, eslint-plugin-prettier, eslint-config-prettier chain (7 packages) is replaced by 1 package.

5\. The proxy layer (Phase 2.5) is the highest-ROI architectural change: Reducing 101 files to 1 handler + config eliminates the single largest maintenance burden in the codebase.

