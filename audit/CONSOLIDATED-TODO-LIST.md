OUITRANSFER — Exhaustive State-of-the-Art TODO

> Project: Ouitransfer v3.3.2-beta — Self-hosted file transfer (WeTransfer alternative)  

> Baseline score: 4.3/10 (per audit synthesis)  

> Target: Production-grade, state-of-the-art quality  

> Source: Cross-referenced from 8 audit reports (architecture, backend, frontend, infrastructure, security, quality, dependencies, synthesis)

\---

Phase 0: Security Emergency 🚨

> Goal: Eliminate all exploitable vulnerabilities. No deployment before this phase is complete.  

> Estimated effort: \~20h

Prototype Pollution \& DoS (immediate, 30min total)

\- \[x] 0.1 — Re-enable prototype pollution protection  

&#x20; File: apps/server/src/app.ts:36-37  

&#x20; Action: Change onProtoPoisoning: "ignore" → "error" and onConstructorPoisoning: "ignore" → "error" (Fastify's secure defaults)  

&#x20; Justification: Audit C2/S2 — disabling these opens RCE/auth bypass vectors via crafted JSON payloads

\- \[x] 0.2 — Set a reasonable body limit  

&#x20; Files: apps/server/src/app.ts:30, apps/server/src/server.ts:58, apps/server/src/modules/reverse-share/routes.ts:389  

&#x20; Action: Set bodyLimit to 50 \* 1024 \* 1024 (50MB). File uploads use presigned S3 URLs, so the Fastify body limit only affects API JSON/metadata payloads. Also fix next.config.ts:21 bodySizeLimit: "1pb" → "50mb"  

&#x20; Justification: Audit C4/S5 — 1PB body limit = trivial DoS

Unauthenticated Routes (critical, 4h total)

\- \[x] 0.3 — Add JWT preValidation to all /s3/\* routes  

&#x20; File: apps/server/src/modules/s3-storage/routes.ts  

&#x20; Action: Add preValidation: \[app.authenticate] to /s3/upload-url, /s3/download-url, /s3/object/:objectName, /s3/exists. Ensure the controller validates the user owns/has access to the referenced objects  

&#x20; Justification: Audit S3 — unauthenticated upload/download/delete/enumerate of arbitrary S3 objects

\- \[x] 0.4 — Add authentication to /embed/:id  

&#x20; Files: apps/server/src/modules/file/routes.ts:134-155, apps/server/src/modules/file/controller.ts:583-625  

&#x20; Action: Require either (a) the user is authenticated and owns the file, or (b) the file belongs to an active share with valid access (alias + optional password). Generate cryptographic embed tokens tied to shares instead of using raw file IDs  

&#x20; Justification: Audit C3/S4 — any file media downloadable by guessing CUID

CORS \& Transport (critical, 2h)

\- \[x] 0.5 — Restrict CORS to known frontend origins  

&#x20; File: apps/server/src/app.ts:71-74  

&#x20; Action: Replace origin: true with an allowlist from env var CORS\_ORIGINS (comma-separated). Default to http://localhost:3000,http://localhost:5487. Validate format at startup  

&#x20; Justification: Audit C1/S1 — any website can make authenticated cross-origin requests with cookies

\- \[x] 0.6 — Default SECURE\_SITE to "true"  

&#x20; File: apps/server/src/modules/auth/controller.ts:43-48  

&#x20; Action: Change default to "true". Add an explicit INSECURE\_COOKIES=true env var for development only, with a startup warning when active  

&#x20; Justification: Audit H3 — cookies sent over plain HTTP by default, vulnerable to MITM

Command Injection (critical, 1h)

\- \[x] 0.7 — Replace exec() with execFile() or native fs.statfs()  

&#x20; File: apps/server/src/modules/storage/service.ts:1,49-51  

&#x20; Action: Replace import { exec } from "child\_process" with Node.js native fs.statfs() (available since Node 18.15) for disk space queries. This eliminates shell interpretation entirely  

&#x20; Justification: Audit C5/S6 — exec() interprets shell metacharacters, potential command injection

Rate Limiting (critical, 4h)

\- \[x] 0.8 — Install and configure @fastify/rate-limit  

&#x20; Files: apps/server/src/app.ts, per-module routes.ts  

&#x20; Action: Install @fastify/rate-limit. Configure global limit (100 req/min/IP), strict on auth endpoints (5/min/IP for login, password-reset, 2FA), moderate on upload endpoints (30/min/IP). Use keyGenerator based on IP (considering trustProxy)  

&#x20; Justification: Audit H1/S8 — zero rate limiting enables brute-force, email bombing, resource exhaustion

2FA Bypass Fix (critical, 4h)

\- \[x] 0.9 — Fix 2FA flow with server-side challenge token  

&#x20; Files: apps/server/src/modules/auth/dto.ts:41-42, apps/server/src/modules/auth/controller.ts:56-84  

&#x20; Action: After successful password verification, generate a short-lived signed JWT "challenge token" (e.g., 5min TTL) containing the userId. The 2FA completion endpoint must receive this challenge token instead of a raw userId. Validate and verify the challenge token server-side before accepting the TOTP code  

&#x20; Justification: Audit H5/S7 — attacker can skip password step and brute-force 6-digit TOTP

Presigned URL Object Name (high, 2h)

\- \[x] 0.10 — Generate objectName server-side for write operations  

&#x20; Files: apps/server/src/modules/file/controller.ts:202-270, apps/server/src/modules/reverse-share/controller.ts:190-214  

&#x20; Action: For all presigned PUT URL generation, generate the S3 object key server-side (e.g., {userId}/{uuid}/{sanitizedFilename}). Never accept client-provided objectName for write operations. Read operations can use object names from the database  

&#x20; Justification: Audit H6 — user-controlled objectName allows overwriting other users' files

Share Passwords (high, 2h)

\- \[x] 0.11 — Move share passwords from query parameters to request body  

&#x20; Files: apps/server/src/modules/share/routes.ts:82, apps/server/src/modules/file/routes.ts:117-118, apps/server/src/modules/reverse-share/routes.ts:188  

&#x20; Action: Change password-protected share/file access from GET ?password=xxx to POST with password in body. Update frontend API layer accordingly  

&#x20; Justification: Audit H2 — passwords in URLs are logged in access logs, browser history, proxy logs, Referer headers

TLS \& Image Proxy (medium, 1h)

\- \[x] 0.12 — Scope TLS bypass to S3 client only  

&#x20; File: apps/server/src/config/storage.config.ts:65-71  

&#x20; Action: Remove the global NODE\_TLS\_REJECT\_UNAUTHORIZED=0. Instead, pass rejectUnauthorized: false only to the S3 client's HTTP agent when S3\_REJECT\_UNAUTHORIZED=false  

&#x20; Justification: Audit M7 — global TLS bypass affects all outbound connections

\- \[x] 0.13 — Restrict Next.js image remote patterns  

&#x20; File: apps/web/next.config.ts:7-16  

&#x20; Action: Replace hostname: "\*\*" with specific allowed hostnames (the app's own domain, configured S3 endpoint). Add env var ALLOWED\_IMAGE\_HOSTS for additional hosts  

&#x20; Justification: Audit M6 — wildcard allows SSRF via /\_next/image

Auth Route Consistency (medium, 2h)

\- \[x] 0.14 — Move all auth checks to preValidation hooks  

&#x20; Files: apps/server/src/modules/share/routes.ts:119-139, apps/server/src/modules/file/controller.ts:60, apps/server/src/modules/folder/controller.ts:21  

&#x20; Action: Ensure all authenticated routes use preValidation: \[app.authenticate] at the route level, not inside controller handlers. This prevents accidentally bypassing auth  

&#x20; Justification: Audit 02 — inconsistent auth (some routes check JWT in controller, not preValidation)

Validation Gaps (medium, 2h)

\- \[x] 0.15 — Replace z.any() with proper Zod schema on auth provider update  

&#x20; File: apps/server/src/modules/auth-providers/routes.ts:188  

&#x20; Action: Define a proper Zod schema for the auth provider update body with all expected fields validated  

&#x20; Justification: Audit 02 — z.any() bypasses all validation on a sensitive endpoint

\- \[x] 0.16 — Enable removeAdditional to strip unknown fields  

&#x20; File: apps/server/src/app.ts:22-24  

&#x20; Action: Set removeAdditional: true in Fastify's Ajv options (or use Zod's .strict() on critical schemas)  

&#x20; Justification: Audit 02 — combined with disabled proto pollution protection, extra fields widen attack surface

\---

Phase 1: Tooling \& DX Foundation 🔧

> Goal: Modern devbox-quality development environment with CI/CD, testing, and automated quality gates.  

> Estimated effort: \~40h

Monorepo Foundation (4h)

\- \[x] 1.1 — Create pnpm-workspace.yaml  

&#x20; File: pnpm-workspace.yaml (new, root)  

&#x20; Action: Create with packages: \["apps/\*", "packages/\*"]. Delete per-app pnpm-lock.yaml files. Run pnpm install from root to generate a single unified lockfile  

&#x20; Justification: Audit 01 critical — fake monorepo, 3 independent lockfiles, no deduplication

\- \[x] 1.2 — Add .npmrc with strict settings  

&#x20; File: .npmrc (new, root)  

&#x20; Action: Create with strict-peer-dependencies=true, auto-install-peers=true, shamefully-hoist=false, prefer-workspace-packages=true  

&#x20; Justification: Audit 07 — no .npmrc exists, needed for workspace discipline

\- \[x] 1.3 — Add .nvmrc / .node-version  

&#x20; File: .node-version (new, root)  

&#x20; Action: Pin to 24 (matching Dockerfile node:24-alpine). Consider mise or fnm as the version manager (faster than nvm)  

&#x20; Justification: Audit 07 — no Node version pinning

Build Orchestration (4h)

\- \[x] 1.4 — Install and configure Turborepo  

&#x20; Files: root package.json, turbo.json (new)  

&#x20; Action: pnpm add -Dw turbo. Create turbo.json with pipelines: build (depends on ^build), lint, type-check, test, validate (depends on lint + type-check). Configure remote caching if using Vercel, or local caching otherwise  

&#x20; Justification: Audit 01/08 — zero build orchestration, sequential validation

\- \[x] 1.5 — Add workspace-level scripts to root package.json  

&#x20; File: root package.json  

&#x20; Action: Add scripts: "build": "turbo build", "lint": "turbo lint", "type-check": "turbo type-check", "test": "turbo test", "validate": "turbo validate", "dev": "turbo dev", "format": "biome format --write .", "check": "biome check --write ."  

&#x20; Justification: Audit 01 — root package.json has zero workspace scripts

Replace Makefile with Justfile (2h)

\- \[x] 1.6 — Create a justfile replacing the Makefile  

&#x20; File: justfile (new, root), delete Makefile  

&#x20; Action: Migrate all Makefile targets to just recipes with improvements:

&#x20; - just dev — start all apps in parallel via turbo

&#x20; - just build — turbo build all apps

&#x20; - just lint / just check — biome check

&#x20; - just test — turbo test

&#x20; - just validate — full validation (lint + type-check + test)

&#x20; - just docker-build \[version] — non-interactive Docker build (local by default, --push flag)

&#x20; - just docker-start / just docker-stop / just docker-logs

&#x20; - just update-version version — update all package.json versions

&#x20; - just db-seed / just db-migrate / just db-studio — Prisma operations

&#x20; - just clean — clean all build artifacts and node\_modules

&#x20; - just setup — full first-time setup (pnpm install, prisma generate, etc.)

&#x20; - Use just --list for self-documenting help  

&#x20; Tool: just (https://github.com/casey/just)  

&#x20; Justification: User's devbox philosophy — just is superior to make for non-build task runners (no tabs requirement, better variable handling, cross-platform)

Linting \& Formatting Modernization (4h)

\- \[x] 1.7 — Replace ESLint + Prettier with Biome  

&#x20; Files: Delete all eslint.config.mjs (×3), all .prettierrc.json (×3), remove ESLint/Prettier deps from all package.json. Create biome.json at root  

&#x20; Action: Install @biomejs/biome as root devDependency. Configure biome.json with:

&#x20; - formatter: indentStyle: "space", indentWidth: 2, lineWidth: 120, quoteStyle: "double", trailingCommas: "es5"

&#x20; - linter.rules.suspicious.noExplicitAny: "warn" (escalate to "error" in Phase 3)

&#x20; - linter.rules.correctness.noUnusedVariables: "error"

&#x20; - linter.rules.correctness.useExhaustiveDependencies: "warn"

&#x20; - organizeImports.enabled: true

&#x20; - overrides for apps/docs and apps/web/src/components/ui/ (shadcn) with relaxed rules

&#x20; - files.ignore: \["\*\*/dist", "\*\*/.next", "\*\*/node\_modules", "\*\*/prisma/migrations"]

&#x20; Why Biome over ESLint+Prettier: Single tool for lint+format, 10-100x faster (Rust), zero plugin ecosystem headaches, built-in import sorting (replaces @ianvs/prettier-plugin-sort-imports), native TypeScript support. For this stack (Next.js + Fastify + Tailwind), Biome covers 95%+ of needed rules. The 5% gap (Next.js-specific rules like no-img-element) can be supplemented with eslint-plugin-next in a minimal ESLint config if absolutely needed, but most are better enforced by Biome's own rules.

&#x20; Alternative evaluated: oxlint + dprint — faster linting but immature formatting, Biome is more integrated  

&#x20; Justification: Audit 06 — 3× duplicated ESLint/Prettier configs, critical rules disabled. Biome consolidates to one config file

\- \[x] 1.8 — Add supplementary oxlint for rules Biome doesn't cover (optional)  

&#x20; File: .oxlintrc.json (new, root)  

&#x20; Action: Only if specific Next.js rules are needed that Biome doesn't cover. Install oxlint and configure only the gap rules. Run after Biome in CI  

&#x20; Justification: Belt-and-suspenders linting for Next.js-specific patterns

Testing Infrastructure (8h)

\- \[x] 1.9 — Install Vitest as the test runner  

&#x20; Files: root package.json, vitest.workspace.ts (new), per-app vitest.config.ts  

&#x20; Action: pnpm add -Dw vitest @vitest/coverage-v8. Create workspace config pointing to all apps. Configure per-app:

&#x20; - apps/server: environment: "node", aliases matching tsconfig paths

&#x20; - apps/web: environment: "jsdom", setup file for React Testing Library

&#x20; - apps/docs: skip (content site)  

&#x20; Add "test": "vitest run", "test:watch": "vitest", "test:coverage": "vitest run --coverage" to workspace scripts  

&#x20; Tool: Vitest (native ESM, Vite-powered, fast HMR in watch mode)  

&#x20; Justification: Audit 02/03/06 critical — ZERO tests across 508 files

\- \[x] 1.10 — Install React Testing Library for frontend tests  

&#x20; File: apps/web/package.json  

&#x20; Action: pnpm add -D @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom  

&#x20; Justification: Required for component/hook testing with Vitest

\- \[x] 1.11 — Install Playwright for E2E tests  

&#x20; File: root package.json, playwright.config.ts (new)  

&#x20; Action: pnpm add -Dw @playwright/test. Configure with baseURL pointing to local dev, projects for chromium/firefox/webkit, webServer config to auto-start the app. Create e2e/ directory at root  

&#x20; Tool: Playwright (faster, more reliable than Cypress, native multi-browser)  

&#x20; Justification: Audit 03/06 — zero E2E tests for critical user flows

\- \[x] 1.12 — Write initial smoke tests for critical backend services  

&#x20; Files: apps/server/src/modules/auth/\_\_tests\_\_/, apps/server/src/modules/file/\_\_tests\_\_/, apps/server/src/modules/share/\_\_tests\_\_/  

&#x20; Action: Write tests for auth service (login, JWT, 2FA flow), file service (presigned URL generation, upload registration), share service (create, access with password). Use Fastify's inject() for integration tests without HTTP  

&#x20; Justification: Audit 08 risk matrix — regression during security fixes with zero tests

Git Hooks \& Commit Quality (2h)

\- \[x] 1.13 — Replace Husky with Lefthook  

&#x20; Files: Delete .husky/, root package.json (remove husky dep), lefthook.yml (new)  

&#x20; Action: pnpm add -Dw lefthook. Create lefthook.yml:

&#x20; - pre-commit: run biome check --staged --no-errors-on-unmatched on staged files (replaces lint-staged pattern — Lefthook has built-in staged file filtering)

&#x20; - commit-msg: run commitlint --edit for conventional commits

&#x20; - pre-push: run turbo validate (lint + type-check + test)

&#x20; 

&#x20; Why Lefthook over Husky+lint-staged: Single Go binary, built-in staged file filtering (no lint-staged needed), parallel hook execution, faster startup  

&#x20; Justification: Audit 04 — fragile cd chains in pre-push, no pre-commit hook, no commit message validation

\- \[x] 1.14 — Install commitlint with conventional commits  

&#x20; Files: root package.json, commitlint.config.ts (new)  

&#x20; Action: pnpm add -Dw @commitlint/cli @commitlint/config-conventional. Configure with extends: \['@commitlint/config-conventional'] and custom scopes: server, web, docs, infra, deps  

&#x20; Justification: No commit message discipline exists. Conventional commits enable automated changelogs

CI/CD Pipeline (8h)

\- \[x] 1.15 — Create GitHub Actions CI workflow  

&#x20; File: .github/workflows/ci.yml (new)  

&#x20; Action: Create workflow triggered on push and pull\_request to main/develop:

&#x20; 1. Setup: pnpm with --frozen-lockfile, Node.js from .node-version, Turborepo cache (actions/cache on .turbo/)

&#x20; 2. Lint: turbo lint (Biome)

&#x20; 3. Type-check: turbo type-check

&#x20; 4. Test: turbo test with coverage upload to Codecov

&#x20; 5. Build: turbo build (verify all apps compile)

&#x20; 

&#x20; Use pnpm/action-setup and actions/setup-node with built-in pnpm cache. Parallelize independent jobs via matrix strategy  

&#x20; Justification: Audit 04 critical — ZERO CI/CD, zero automated quality gates

\- \[x] 1.16 — Create GitHub Actions Docker build workflow  

&#x20; File: .github/workflows/docker.yml (new)  

&#x20; Action: Triggered on version tags (v\*). Build multi-platform image (linux/amd64, linux/arm64) via docker/build-push-action. Push to GHCR (ghcr.io/burger-cie/ouitransfer). Use Docker layer caching via type=gha cache backend  

&#x20; Justification: Audit 04 — builds are manual via interactive script with forced --push

\- \[x] 1.17 — Create GitHub Actions E2E workflow  

&#x20; File: .github/workflows/e2e.yml (new)  

&#x20; Action: Run Playwright tests on PRs. Use Docker Compose to spin up the full stack (API + Web + MinIO). Upload test artifacts (screenshots, traces) on failure  

&#x20; Justification: E2E validation before merge

Dead Code Detection (1h)

\- \[x] 1.18 — Install and configure Knip  

&#x20; File: knip.json (new, root)  

&#x20; Action: pnpm add -Dw knip. Configure with workspace entries for each app. Run knip to detect unused exports, unused dependencies, unused files. Add to CI  

&#x20; Tool: Knip (purpose-built for monorepos, understands Next.js/Fastify patterns)  

&#x20; Justification: Audit 06 — suspected dead code (types/layout.ts, i18n-mock.ts), 3 icon libraries likely have unused icons

Dependency Management (1h)

\- \[x] 1.19 — Configure Renovate for automated dependency updates  

&#x20; File: renovate.json (new, root)  

&#x20; Action: Add Renovate config with: extends: \["config:recommended"], automerge for patch updates, group pnpm monorepo packages, pin @types/\* versions, schedule "before 7am on Monday". Set rangeStrategy: "pin" for production deps  

&#x20; Alternative: Dependabot — simpler but less powerful grouping. Renovate is state-of-the-art  

&#x20; Justification: Audit 07 — version drift between apps, no automated updates

Local Environment (1h)

\- \[x] 1.20 — Create .envrc for direnv integration  

&#x20; File: .envrc (new, root), .env.example updated  

&#x20; Action: Create .envrc that sources .env and sets PATH\_add node\_modules/.bin. Fix the malformed URL in apps/web/.env.example: http:localhost:3333 → http://localhost:3333. Create a root .env.example documenting all env vars across all apps  

&#x20; Justification: User's devbox philosophy — direnv for seamless env management. Audit 01 — malformed URL in .env.example

\- \[x] 1.21 — Add Changesets for version management  

&#x20; Files: .changeset/config.json (new), root package.json  

&#x20; Action: pnpm add -Dw @changesets/cli. Initialize with pnpm changeset init. Configure fixed mode (all apps versioned together). Replace infra/update-versions.sh sed script  

&#x20; Tool: Changesets (standard for monorepo versioning, integrates with CI for automated releases)  

&#x20; Justification: Audit 01 — version management via fragile sed script

\---

Phase 2: Architecture Restructuring 🏗️

> Goal: True monorepo with shared packages, deduplicated code, consolidated configs.  

> Estimated effort: \~24h

Shared Packages (8h)

\- \[x] 2.1 — Create packages/shared for cross-app utilities  

&#x20; Files: packages/shared/ (new directory), packages/shared/package.json, packages/shared/tsconfig.json  

&#x20; Action: Create package with:

&#x20; - src/mime-types.ts — merged from apps/server/src/utils/mime-types.ts (378L) and apps/web/src/utils/mime-types.ts (435L)

&#x20; - src/types/ — shared types (User, File, Folder, Share interfaces)

&#x20; - src/constants.ts — shared constants

&#x20; - src/validation/ — shared Zod schemas for DTOs that both apps need

&#x20; 

&#x20; Add workspace:\* references in consuming apps' package.json. Build with tsup for dual CJS/ESM output  

&#x20; Justification: Audit 01 critical — zero workspace: references, mime-types.ts duplicated (378+435 LOC), zero shared types

\- \[x] 2.2 — Create packages/config for shared tooling configs  

&#x20; Files: packages/config/ (new directory)  

&#x20; Action: Create shared configs:

&#x20; - tsconfig/base.json — shared compiler options, extended by each app's tsconfig.json

&#x20; - biome.json — shared Biome config (if per-app overrides are needed, use overrides)

&#x20; Each app's tsconfig.json becomes { "extends": "../../packages/config/tsconfig/base.json", ... }  

&#x20; Justification: Audit 01 — 3× duplicated tsconfig, ESLint, Prettier configs

Config Consolidation (4h)

\- \[x] 2.3 — Unify TypeScript versions and tsconfig settings  

&#x20; Files: All tsconfig.json files, all package.json files  

&#x20; Action: Align TypeScript to ^5.8.3 everywhere. Set forceConsistentCasingInFileNames: true in base tsconfig (only docs had it). Evaluate moving server to module: "nodenext" / moduleResolution: "nodenext" for consistency  

&#x20; Justification: Audit 01/07 — TypeScript drift: ^5.7.3 vs 5.8.3

\- \[x] 2.4 — Remove ignoreDuringBuilds and ignoreBuildErrors from docs  

&#x20; File: apps/docs/next.config.mjs  

&#x20; Action: Remove typescript.ignoreBuildErrors: true and eslint.ignoreDuringBuilds: true. Fix the underlying TS/lint errors in the docs app  

&#x20; Justification: Audit 01 — docs silently ignores all build errors

Proxy Layer Rationalization (8h)

\- \[x] 2.5 — Evaluate and reduce the 101-route proxy layer  

&#x20; Files: apps/web/src/app/api/(proxy)/ (101 files)  

&#x20; Action: Two approaches (evaluate both, implement the better one):

&#x20; 

&#x20; Option A (recommended): Create a single catch-all proxy middleware at apps/web/src/app/api/\[...proxy]/route.ts using a route mapping config. Each route maps URL pattern → backend path with method/auth requirements. Reduces 101 files to \~1 handler + 1 config  

&#x20; 

&#x20; Option B: In Docker, add a Caddy/nginx reverse proxy that forwards /api/\* directly to Fastify, eliminating the Next.js proxy entirely. This requires cookie handling adjustment  

&#x20; 

&#x20; Either way, create shared proxy utilities (apps/web/src/lib/proxy.ts) for cookie forwarding, error handling, and response streaming  

&#x20; Justification: Audit 01/03/06 — 101 boilerplate proxy files, massive maintenance burden

Docker Architecture (2h)

\- \[x] 2.8 — Evaluate replacing supervisord with docker compose multi-container  

&#x20; Files: infra/supervisord.conf, Dockerfile, docker-compose.yaml  

&#x20; Action: The current Docker image runs 4 processes (minio, minio-setup, server, web) via supervisord in a single container. Evaluate splitting into separate containers orchestrated by docker compose (one per service). If splitting, delete infra/supervisord.conf and simplify the Dockerfile to single-process. No backward compatibility needed — no production users  

&#x20; Justification: Audit 04/01 — multi-process container is an anti-pattern, complicates scaling and debugging

Dependency Deduplication (4h)

\- \[x] 2.6 — Hoist shared dependencies to workspace root  

&#x20; Files: Root package.json, per-app package.json files  

&#x20; Action: After pnpm-workspace.yaml (Phase 1.1), move shared devDependencies to root: typescript, @biomejs/biome, vitest. Verify shared production deps are properly hoisted by pnpm (zod, react, next, lucide-react, clsx, etc.)  

&#x20; Justification: Audit 07 — duplicated deps across apps, version drift

\- \[x] 2.7 — Align drifting dependency versions  

&#x20; Files: Per-app package.json  

&#x20; Action: Align: @radix-ui/react-dialog → ^1.1.15, tailwind-merge → ^3.3.1, prisma CLI → ^6.11.0 (match client). Use pnpm catalog (pnpm 9+) or Renovate grouping to prevent future drift  

&#x20; Justification: Audit 07 — multiple version drifts identified

\---

Phase 3: Code Quality \& Type Safety 🎯

> Goal: Eliminate any types, proper error handling, structured logging, type-safe request objects.  

> Estimated effort: \~40h

Type Safety (16h)

\- \[x] 3.1 — Type the Fastify request decoration properly  

&#x20; Files: apps/server/src/types/fastify.d.ts, all controller files using (request as any).user  

&#x20; Action: Declare the Fastify request decoration in types/fastify.d.ts:

&#x20;   declare module 'fastify' {

&#x20;   interface FastifyRequest {

&#x20;     user: { userId: string; isAdmin: boolean; }

&#x20;   }

&#x20; }

&#x20;   Then replace all 15+ occurrences of (request as any).user?.userId with request.user.userId  

&#x20; Justification: Audit 06 — 15+ (request as any).user casts, defeats type safety

\- \[x] 3.2 — Escalate noExplicitAny to error in Biome  

&#x20; File: biome.json  

&#x20; Action: Change noExplicitAny from "warn" to "error". Fix remaining any types across the codebase. Priority files:

&#x20; - shares-table.tsx (17+ any) — create proper Share interface

&#x20; - useUppyUpload.ts (15+) — type Uppy callbacks properly

&#x20; - share-actions-modals.tsx (12+) — use shared Share type

&#x20; - two-factor/controller.ts (14+) — use typed request (3.1)

&#x20; 

&#x20; For catch blocks, use catch (error: unknown) and narrow with type guards  

&#x20; Justification: Audit 06 — 470+ any occurrences, no-explicit-any disabled

\- \[x] 3.3 — Fix the "\_\_DELETE\_\_" as any sentinel pattern  

&#x20; File: apps/web/src/hooks/use-enhanced-file-manager.ts  

&#x20; Action: Replace the "\_\_DELETE\_\_" as any pattern with a proper discriminated union or Symbol sentinel. Use undefined or a dedicated delete action type  

&#x20; Justification: Audit 06 — fragile sentinel value pattern

Error Handling (8h)

\- \[x] 3.4 — Implement centralized Fastify error handler  

&#x20; File: apps/server/src/app.ts  

&#x20; Action: Add app.setErrorHandler() with:

&#x20; - Prisma error sanitization (don't expose schema details to clients)

&#x20; - Zod validation error formatting (structured field errors)

&#x20; - Consistent error response shape: { error: string, code: string, statusCode: number, details?: object }

&#x20; - Proper status code mapping (401 for auth, 403 for authorization, 404 for not found, 422 for validation)

&#x20; - Log full error server-side, send sanitized version to client  

&#x20; Justification: Audit 02/06 — no global error handler, Prisma errors leak to clients, inconsistent status codes

\- \[x] 3.5 — Fix silent catch blocks  

&#x20; Files: apps/server/src/modules/file/controller.ts:253, :359  

&#x20; Action: Replace empty catch blocks with proper error logging. At minimum, log the error. If the error is expected/recoverable, document why it's safe to swallow  

&#x20; Justification: Audit 06 — 2 empty catch blocks silently swallow errors

\- \[x] 3.6 — Fix inconsistent eslint-disable react-hooks/exhaustive-deps  

&#x20; Files: 8 files with the suppression  

&#x20; Action: Fix the actual dependency arrays instead of suppressing the rule. Common fixes: extract callbacks to useCallback, memoize derived values, properly list dependencies  

&#x20; Justification: Audit 06 — 8 suppressions indicate stale closures or missing reactive updates

Logging (4h)

\- \[x] 3.7 — Replace console.\* with Fastify's built-in Pino logger on the server  

&#x20; Files: apps/server/src/server.ts, all server modules  

&#x20; Action: Use request.log / app.log (Pino) instead of console.log/error/warn. Set log level via env var LOG\_LEVEL (default: "info"). Configure pino-pretty for dev, JSON output for production. Remove the \~50 console.\* calls in server code (keep the CLI scripts which legitimately use console)  

&#x20; Justification: Audit 06 — 334 console.\* occurrences, server bypasses configured Pino logger

\- \[x] 3.8 — Add structured logging to frontend  

&#x20; Files: apps/web/src/lib/logger.ts (new)  

&#x20; Action: Create a lightweight logger wrapper that: uses console.\* in dev, is no-op or sends to a reporting service in prod. Replace raw console.error calls in hooks and services  

&#x20; Justification: Audit 06 — 30+ raw console.error in hooks with insufficient context

Code Decomposition (8h)

\- \[x] 3.9 — Break up files exceeding 500 lines  

&#x20; Priority files:

&#x20; - files-table.tsx (972L) → split into files-table-columns.tsx, files-table-actions.tsx, files-table-toolbar.tsx, files-table.tsx (orchestrator)

&#x20; - reverse-share/service.ts (919L) → extract sub-services: reverse-share-upload.service.ts, reverse-share-multipart.service.ts

&#x20; - received-files-modal.tsx (918L) → extract list component, file item component, actions

&#x20; - files-grid.tsx (917L) → extract grid item component, grid toolbar

&#x20; - file/controller.ts (770L) → extract upload controller, embed controller

&#x20; 

&#x20; Justification: Audit 06 — 15 files exceed 500 lines, concentrated in reverse-share domain

Miscellaneous Quality (2h)

\- \[x] 3.10 — Fix typo in filename  

&#x20; File: apps/web/src/utils/unahthenticated-only-paths.ts → unauthenticated-only-paths.ts  

&#x20; Action: Rename file and update all imports  

&#x20; Justification: Audit 06 — typo unahthenticated

\- \[x] 3.11 — Unify PrismaClient to singleton  

&#x20; Files: apps/server/src/modules/user/service.ts:16, apps/server/src/modules/storage/service.ts:11  

&#x20; Action: Replace new PrismaClient() in UserService and StorageService with the singleton import from src/shared/prisma.ts  

&#x20; Justification: Audit 02 — multiple PrismaClient instances waste connections and conflict with SQLite's single-writer lock

\- \[x] 3.12 — Use Prisma migrations instead of schema push  

&#x20; Files: apps/server/prisma/  

&#x20; Action: Initialize migration history with prisma migrate dev --name init. Use prisma migrate deploy in production (Docker entrypoint). This enables rollback and migration tracking  

&#x20; Justification: Audit 02 — no migration history, only schema push, no rollback capability

\- \[x] 3.13 — Replace trivial smoke tests with real integration tests  

&#x20; Files: apps/server/src/__tests__/health.test.ts, apps/web/src/__tests__/smoke.test.tsx  

&#x20; Action: Server: use Fastify inject() to boot the app and test /health endpoint. Web: render a component with next-intl provider and assert i18n works. Replace current tests that only verify imports  

&#x20; Justification: Post-Phase 1 review S5 — current smoke tests only verify that modules are importable, not that the app works

\- \[x] 3.14 — Review and fix Knip configuration for docs MDX  

&#x20; File: knip.json  

&#x20; Action: Evaluate if Knip can reliably parse MDX imports in apps/docs. If not, add docs-specific ignoreDependencies for packages only consumed via MDX content files. Run knip and verify false positive rate is acceptable  

&#x20; Justification: Post-Phase 1 review S6 — MDX entry points removed from knip.json due to unreliable parsing

\- \[x] 3.15 — Add unit test for proxy route resolution ordering (Phase 2 review S2)

&#x20; File: apps/web/src/lib/\_\_tests\_\_/proxy-routes.test.ts (new)

&#x20; Action: Write a test that verifies each known frontend API call resolves to the correct route config. The route table relies on static-before-dynamic ordering which is easy to break when adding routes.

&#x20; Justification: Phase 2 review S2 — route ordering is a maintenance trap

\- \[x] 3.16 — Clean up extractFilenameFromContentDisposition regex (Phase 2 review S5)

&#x20; File: packages/shared/src/mime-types.ts

&#x20; Action: The greedy capture `[^";\r\n]*` makes the trailing `["]?` dead. Also only handles UTF-8 per RFC 5987. Tighten the regex and document encoding limitations.

&#x20; Justification: Phase 2 review S5

\- \[x] 3.17 — Keep subpath export pattern for packages/shared (Phase 2 review W9)

&#x20; File: packages/shared/package.json

&#x20; Action: When adding more utilities to packages/shared, use subpath exports (`"./foo"`, `"./bar"`) rather than a catch-all `"."` barrel export. Subpath imports keep tree-shaking optimal.

&#x20; Justification: Phase 2 review W9 — architectural guidance

\---

Phase 4: Frontend Modernization ⚡

> Goal: Server-state management, error boundaries, performance, accessibility.  

> Estimated effort: \~40h

Error Recovery (4h)

\- \[x] 4.1 — Add error.tsx boundaries on every route segment  

&#x20; Files: apps/web/src/app/error.tsx (root), plus per-segment: dashboard/error.tsx, files/error.tsx, (shares)/error.tsx, settings/error.tsx, profile/error.tsx, etc.  

&#x20; Action: Create error boundaries with:

&#x20; - User-friendly error message (not stack trace)

&#x20; - "Try again" button calling reset()

&#x20; - "Go home" link

&#x20; - Error reporting to logger (Phase 3.8)

&#x20; 

&#x20; Root error.tsx catches everything. Segment-level ones provide contextual recovery  

&#x20; Justification: Audit 03 critical — ZERO error boundaries, any unhandled error crashes the entire app to white screen

\- \[x] 4.2 — Add loading.tsx streaming boundaries  

&#x20; Files: apps/web/src/app/loading.tsx (root), plus per-segment: dashboard/loading.tsx, files/loading.tsx, (shares)/loading.tsx  

&#x20; Action: Create loading states with skeleton UI matching the page layout. Use shadcn/ui Skeleton component. Consider Suspense boundaries within pages for granular loading  

&#x20; Justification: Audit 03 critical — ZERO loading states, pages show nothing during navigation/data fetching

Server-State Management (16h)

\- \[x] 4.3 — Integrate TanStack Query (React Query v5)  

&#x20; Files: apps/web/package.json, apps/web/src/providers/query-provider.tsx (new), all data-fetching hooks  

&#x20; Action:

&#x20; 1. Install @tanstack/react-query and @tanstack/react-query-devtools

&#x20; 2. Create QueryClientProvider wrapper in app layout

&#x20; 3. Refactor data fetching into custom hooks using useQuery / useMutation:

&#x20;    - useShares(), useShare(id), useCreateShare()

&#x20;    - useFiles(), useFile(id), useUploadFile()

&#x20;    - useUser(), useUsers(), useUpdateProfile()

&#x20;    - useAppInfo(), useAppConfig()

&#x20; 4. Configure staleTime, gcTime, cache invalidation on mutations

&#x20; 5. Add queryClient.prefetchQuery() in server components where possible  

&#x20; Justification: Audit 03 critical — no server-state library, every component calls axios directly, no cache/dedup/SWR

\- \[x] 4.4 — Add Axios response interceptor for 401 handling  

&#x20; File: apps/web/src/http/client.ts or equivalent  

&#x20; Action: Add response interceptor that catches 401 errors globally, clears auth state, and redirects to login. Integrate with TanStack Query's onError for automatic retry on token refresh  

&#x20; Justification: Audit 03 — no centralized 401 handling, auth expiration only detected at initial check

\- \[x] 4.5 — Unify state management paradigm  

&#x20; Files: apps/web/src/contexts/app-info-context.tsx, apps/web/src/contexts/auth-context.tsx  

&#x20; Action: With TanStack Query handling server-state:

&#x20; - Move app-info data fetching to a useAppInfo() query hook (replace Zustand store)

&#x20; - Keep auth context for client-only state (isAuthenticated, current user) but feed it from a TanStack Query useCurrentUser() hook

&#x20; - Move Zustand store out of contexts/ directory if kept, or replace entirely  

&#x20; Justification: Audit 03 — mixed paradigms (Zustand + Context), Zustand store in contexts/ directory

Performance (8h)

\- \[x] 4.6 — Lazy-load Google Fonts based on user selection  

&#x20; File: apps/web/src/app/layout.tsx  

&#x20; Action: Load only the default font (Outfit) in the root layout. Load the user-selected font dynamically via next/font/google with display: 'swap' in a client component that reads the user's customization setting. Remove the 10 preloaded font declarations  

&#x20; Justification: Audit 01/03 — 11 Google Fonts loaded on every page regardless of selection, significant LCP impact

\- \[x] 4.7 — Add React.lazy / next/dynamic for heavy components  

&#x20; Files: Large modals, table components, upload components  

&#x20; Action: Dynamically import:

&#x20; - Upload modal (Uppy is heavy)

&#x20; - Share details modal (682L)

&#x20; - Edit reverse share modal (724L)

&#x20; - QR code components

&#x20; - File manager grid/table views (load on viewport visibility)

&#x20; 

&#x20; Use next/dynamic with loading fallback components  

&#x20; Justification: Audit 03 — zero lazy loading, only 1 dynamic import in entire app

\- \[x] 4.8 — Replace <img> with next/image  

&#x20; Files: All components using raw <img> tags  

&#x20; Action: Re-enable the @next/next/no-img-element rule (or Biome equivalent). Replace <img> with <Image> from next/image for automatic optimization (WebP/AVIF, responsive sizes, lazy loading)  

&#x20; Justification: Audit 03 — ESLint rule disabled, missing image optimization

Accessibility (4h)

\- \[x] 4.9 — Add skip-to-content link  

&#x20; File: apps/web/src/app/layout.tsx or main layout component  

&#x20; Action: Add <a href="#main-content" className="sr-only focus:not-sr-only ...">Skip to content</a> as the first focusable element. Add id="main-content" to the main content area  

&#x20; Justification: Audit 03 — no skip-to-content link

\- \[x] 4.10 — Add focus management on route changes  

&#x20; File: apps/web/src/components/layout/ or root layout  

&#x20; Action: Use Next.js App Router's built-in focus management or add a custom hook that focuses the main content heading on route change. This is essential for screen reader users  

&#x20; Justification: Audit 03 — no focus management on route change

\- \[x] 4.11 — Add keyboard alternative for drag \& drop  

&#x20; File: File manager components, upload components  

&#x20; Action: Ensure all drag-and-drop actions have keyboard equivalents. For file manager: allow selecting via checkbox + action buttons. For upload: the file input already works. Ensure the custom DnD implementation supports onKeyDown for reordering  

&#x20; Justification: Audit 03 — custom DnD is mouse-only

\- \[x] 4.12 — Fix RTL support for Persian and Hebrew  

&#x20; File: apps/web/src/app/layout.tsx:104  

&#x20; Action: Change RTL detection from locale === "ar-SA" to \["ar-SA", "fa-IR", "he-IL"].includes(locale). Apply dir="rtl" to the HTML element for all RTL languages  

&#x20; Justification: Audit 03 — Persian and Hebrew are RTL languages but only Arabic triggers RTL

Component Deduplication (2h)

\- \[x] 4.14 — Extract shared UI primitives from duplicated file/folder row splits (Phase 3 QA-8)

&#x20; Files: apps/web/src/app/files/components/files-table-file-row.tsx, files-table-folder-row.tsx, files-grid-file-card.tsx, files-grid-folder-card.tsx

&#x20; Action: The Phase 3 file splits created ~100-120 lines of cross-file duplication: identical inline-edit UI (input + confirm/cancel buttons), checkbox selection blocks, and icon imports duplicated across file-row vs folder-row (and file-card vs folder-card). Extract `<EditableField>` and `<SelectionCheckbox>` components. Do a broader scan across all split components for other duplicated patterns. Goal: modifying inline-edit UX should require editing 1 file, not 4.

&#x20; Justification: Phase 3 quality audit QA-8 — mechanical splits increased file count but created maintenance burden

\- \[x] 4.15 — Consolidate duplicated File/Folder type interfaces into canonical imports

&#x20; Files: 11 files across apps/web/src/ define local File/Folder interfaces duplicating files-table-types.ts

&#x20; Action: 21 local type interfaces found duplicating the canonical FileItem/FolderItem types. 7 are exact duplicates (files-view-manager.tsx, share-details.tsx, files/page.tsx, dashboard-files-view.tsx, use-enhanced-file-manager.ts BulkFolder) — replace with imports. 10 are subsets — replace with Pick<FileItem, ...> or Pick<FolderItem, ...>. 4 are API-layer variants in http/endpoints/*/types.ts with meaningful null vs undefined and size type differences — these represent the real API/UI type boundary and should be kept as distinct types but renamed for clarity (e.g. ApiFileItem vs FileItem). The api-mappers.ts module (QA-4) already bridges this gap at runtime; the types should reflect that architecture.

&#x20; Justification: Phase 3 quality audit follow-up — QA-4 agent flagged type duplication beyond its scope

Middleware (2h)

\- \[x] 4.13 — Add Next.js middleware for route protection  

&#x20; File: apps/web/src/middleware.ts (new)  

&#x20; Action: Create middleware that checks for the auth cookie on protected routes and redirects to /login if absent. This provides server-side route protection instead of relying solely on client-side ProtectedRoute component  

&#x20; Justification: Audit 03 — no middleware.ts, route protection is purely client-side

\---

Phase 5: Backend Hardening 🛡️

> Goal: Validation improvements, auth hardening, data layer cleanup, CSRF protection.  

> Estimated effort: \~28h

Validation \& Content Security (8h)

\- \[ ] 5.1 — Implement file content validation (magic bytes)  

&#x20; Files: apps/server/src/modules/file/controller.ts, new utility  

&#x20; Action: Install file-type package. After file registration (POST /files), verify magic bytes match the declared MIME type. Implement an extension allowlist/blocklist configurable via app settings. Reject suspicious mismatches (e.g., .jpg with application/x-executable magic bytes)  

&#x20; Justification: Audit H4/05 — zero server-side file content validation

\- \[ ] 5.2 — Validate file size at presigned URL generation time  

&#x20; File: apps/server/src/modules/file/controller.ts  

&#x20; Action: When generating presigned PUT URLs, include Content-Length condition in the presigned URL policy. Set max upload size based on user's quota/plan. Add a cron job to clean orphaned S3 objects (uploaded but never registered)  

&#x20; Justification: Audit 02 — file size only validated at registration, not at upload. Users can upload 100GB then fail registration, leaving orphaned data

\- \[ ] 5.3 — Fix password validation consistency  

&#x20; File: apps/server/src/modules/auth/dto.ts  

&#x20; Action: LoginSchema and RegisterSchema should both use the dynamic password policy (fetched from app config), not a hardcoded min(6). Create a shared password validation function  

&#x20; Justification: Audit 02 — LoginSchema hardcodes min(6) while dynamic policy may require more

Auth Improvements (8h)

\- \[ ] 5.4 — Implement CSRF protection  

&#x20; File: apps/server/src/app.ts, apps/web  

&#x20; Action: Install @fastify/csrf-protection. Implement double-submit cookie pattern: generate CSRF token, set as cookie, require it in X-CSRF-Token header on state-changing requests. Add CSRF token handling to the frontend Axios instance  

&#x20; Justification: Audit M3/05 — with credentials: true and cookie auth, CSRF attacks are possible even after fixing CORS

\- \[ ] 5.5 — Sign the JWT cookie  

&#x20; File: apps/server/src/app.ts:79-81  

&#x20; Action: Change signed: false to signed: true and configure a cookie signing secret (separate from JWT secret). This adds integrity verification by Fastify's cookie plugin  

&#x20; Justification: Audit M4 — cookie signed: false means no integrity check by Fastify

\- \[ ] 5.6 — Fix admin detection logic  

&#x20; Files: apps/server/src/modules/user/service.ts:33-34, apps/server/src/modules/app/routes.ts:11-32  

&#x20; Action: Don't use usersCount === 0 or usersCount <= 1 for admin detection in ongoing operations. The "first user is admin" pattern should only apply during initial setup. After that, use the isAdmin flag from the user record. The adminPreValidation should always require auth when usersCount > 0  

&#x20; Justification: Audit 02/M2 — admin bypass when ≤1 users

\- \[ ] 5.7 — Restrict trustProxy configuration  

&#x20; File: apps/server/src/app.ts:34  

&#x20; Action: Change trustProxy: true to a configurable value via env var TRUST\_PROXY (default: "loopback" for localhost proxy). Accept specific CIDR ranges for known reverse proxy IPs  

&#x20; Justification: Audit 02 — trustProxy: true trusts all proxy headers, IP spoofing

\- \[ ] 5.8 — Protect Swagger/API docs in production  

&#x20; File: apps/server/src/app.ts:92-102  

&#x20; Action: Conditionally register Swagger/Scalar only when NODE\_ENV !== "production" or when an env var ENABLE\_API\_DOCS=true is set. In production, these endpoints should require admin auth or be disabled entirely  

&#x20; Justification: Audit M1 — full API documentation publicly accessible

Data Layer (4h)

\- \[ ] 5.9 — Use crypto.randomUUID() instead of Math.random() for object names  

&#x20; File: apps/server/src/modules/file/controller.ts:46,667  

&#x20; Action: Replace Math.random() in file object name generation with crypto.randomUUID(). This provides cryptographically random, non-enumerable identifiers  

&#x20; Justification: Audit L3 — Math.random() is predictable, aids enumeration attacks

\- \[ ] 5.10 — Sanitize filenames for path traversal characters  

&#x20; File: apps/server/src/modules/file/controller.ts:46  

&#x20; Action: Sanitize uploaded filenames: strip path separators (/, \\), null bytes, leading dots. Use a library like sanitize-filename or write a focused utility  

&#x20; Justification: Audit L1 — filenames not sanitized for path characters

\- \[ ] 5.11 — Sanitize error messages sent to clients  

&#x20; Files: All controllers' catch blocks  

&#x20; Action: Never send raw error messages to clients. Map known errors to user-friendly messages. Log the full error server-side. This is partially covered by Phase 3.4's centralized error handler, but verify all controllers go through it  

&#x20; Justification: Audit L2 — implementation details exposed in error messages

Port Configuration (1h)

\- \[ ] 5.12 — Make server port configurable via env var  

&#x20; File: apps/server/src/server.ts:87  

&#x20; Action: Replace hardcoded 3333 with process.env.PORT || 3333  

&#x20; Justification: Audit 02 — port hardcoded, not configurable

\- \[ ] 5.13 — Require 2FA code (or backup code) to disable 2FA  

&#x20; Files: apps/server/src/modules/two-factor/service.ts, apps/server/src/modules/two-factor/controller.ts, apps/server/src/modules/two-factor/routes.ts  

&#x20; Action: Currently disabling 2FA only requires the user password. An attacker with the password can bypass 2FA by disabling it. Require a valid TOTP code or backup code in addition to the password when disabling 2FA  

&#x20; Justification: Post-Phase 1 review W13 — defense-in-depth for 2FA

\- \[ ] 5.14 — Standardize cookie:false on public proxy routes (Phase 2 review S3)

&#x20; File: apps/web/src/lib/proxy-routes.ts

&#x20; Action: Public endpoints (reverse-shares/alias/\*, shares/access, invite-tokens) should all set `cookie: false`. Some already do, some don't. Audit all routes and standardize based on whether auth is required.

&#x20; Justification: Phase 2 review S3 — inconsistent cookie forwarding

\- \[ ] 5.15 — Validate OAuth redirect URLs against allowlist (Phase 2 review S6)

&#x20; File: apps/web/src/lib/proxy.ts

&#x20; Action: When handling OAuth redirects, validate that the Location URL matches a known OAuth provider hostname or is same-origin. Defense in depth against open redirect.

&#x20; Justification: Phase 2 review S6

Note: S4 (X-Forwarded-For trust without TRUST\_PROXY) is already covered by item 5.7 above.

\- \[ ] 5.17 — Prefer `filename*` over `filename` in Content-Disposition parsing (Phase 3 review M-3)

&#x20; File: packages/shared/src/mime-types.ts

&#x20; Action: Per RFC 6266, when both `filename*` and `filename` are present in a Content-Disposition header, `filename*` should be preferred (it supports full UTF-8 encoding). Current regex returns whichever appears first. Implement two-pass: first scan for `filename*=`, fall back to `filename=`.

&#x20; Justification: Phase 3 review M-3 — pre-existing, not introduced by Phase 3

\- \[ ] 5.16 — Migrate controllers to use the centralized error handler (Phase 3 review I-2)

&#x20; Files: All server controller files (~15 files)

&#x20; Action: Remove try/catch wrappers from controller handlers. Let errors propagate to globalErrorHandler (registered in app.ts). This unifies the error response shape to `{ error, code, statusCode, details? }` instead of the current mix of global handler + per-controller `{ error: "..." }`. Consider adopting an AppError class for domain-specific errors.

&#x20; Justification: Phase 3 review I-2 — globalErrorHandler exists but is mostly bypassed by controller-level catch blocks, creating two inconsistent error response shapes.

\---

Phase 6: Infrastructure \& Operations 🐳

> Goal: Hardened Docker setup, proper MinIO security, monitoring, reliable deployment.  

> Estimated effort: \~24h

Docker Improvements (8h)

\- \[ ] 6.1 — Move MinIO installation to a dedicated build stage or runtime-only  

&#x20; File: Dockerfile:16-21  

&#x20; Action: Install MinIO only in the final runner stage, not in the base stage. This avoids bloating intermediate build layers with +100MB  

&#x20; Justification: Audit 04 — MinIO in base stage inflates build cache

\- \[ ] 6.2 — Extract the 100-line heredoc startup script  

&#x20; Files: Dockerfile:145-248, infra/start.sh (new)  

&#x20; Action: Move the inline heredoc startup script to infra/start.sh. COPY it in the Dockerfile. This makes it testable and readable independently  

&#x20; Justification: Audit 04 — 100-line heredoc inline in Dockerfile, untestable

\- \[ ] 6.3 — Fix the VOLUME declaration  

&#x20; File: Dockerfile:253  

&#x20; Action: Remove VOLUME \["/app/server"] from Dockerfile. Volumes should be declared in docker-compose.yaml only, not baked into the image. Baked-in VOLUME creates anonymous volumes if not explicitly mapped, risking data loss  

&#x20; Justification: Audit 04 — VOLUME creates anonymous volumes by default

\- \[ ] 6.4 — Harmonize UID/GID defaults  

&#x20; Files: Dockerfile:87, infra/server-start.sh:34, infra/start-minio.sh  

&#x20; Action: Use 1001 consistently everywhere as the default UID/GID  

&#x20; Justification: Audit 04 — UID/GID 1000 in server-start.sh vs 1001 in Dockerfile

\- \[ ] 6.5 — Fix docker-compose.yaml STORAGE\_URL  

&#x20; File: docker-compose.yaml:35  

&#x20; Action: Change STORAGE\_URL: "https://ouitransfer-demo:9379" to use the container's internal hostname or localhost. Document clearly which URL should be used. Make scheme consistent with S3\_USE\_SSL setting  

&#x20; Justification: Audit 04 critical — placeholder hostname that doesn't work

MinIO Security (4h)

\- \[ ] 6.6 — Create a dedicated MinIO service account  

&#x20; File: infra/minio-setup.sh  

&#x20; Action: After MinIO starts, create a dedicated service account with limited permissions (only the bucket used by the app). Store service account credentials. Don't use root credentials for application access  

&#x20; Justification: Audit 04 — app uses root MinIO credentials, has full admin access

\- \[ ] 6.7 — Fix credential file permissions  

&#x20; File: infra/minio-setup.sh:109  

&#x20; Action: Change chmod 644 to chmod 600 for the credentials file  

&#x20; Justification: Audit 04 — credentials world-readable

\- \[ ] 6.8 — Stop deleting .minio.sys on every startup  

&#x20; File: infra/start-minio.sh:25-28  

&#x20; Action: Remove the rm -rf .minio.sys on startup. If there's a specific bug this works around, document it and find a targeted fix  

&#x20; Justification: Audit 04 — force-regenerating internal metadata can break persisted IAM policies

Binary Verification (2h)

\- \[ ] 6.9 — Add SHA256 checksum verification for downloaded binaries  

&#x20; Files: infra/install-minio.sh, infra/install-mc.sh  

&#x20; Action: After downloading MinIO server and client binaries, verify SHA256 checksums against known-good values. Pin the mc client version (currently unpinned, unlike the server)  

&#x20; Justification: Audit 04 — no integrity verification on downloaded binaries, mc version not pinned

Build Script (1h)

\- \[ ] 6.10 — Delete infra/build-docker.sh (superseded by CI)  

&#x20; File: infra/build-docker.sh  

&#x20; Action: Delete the interactive build script entirely. Docker builds are now handled by .github/workflows/docker.yml (triggered on v* tags). No production users, no legacy to maintain. For local builds, use `docker compose build` or `just build`  

&#x20; Justification: Audit 04 — interactive script with forced --push, now fully replaced by GitHub Actions CI

Monitoring (4h)

\- \[ ] 6.11 — Add structured health check endpoint  

&#x20; File: apps/server/src/modules/health/  

&#x20; Action: Enhance the health endpoint to return structured data: { status: "ok", checks: { database: "ok", storage: "ok", uptime: 12345 } }. Check actual database connectivity and S3 accessibility, not just "server is running"  

&#x20; Justification: Production readiness — current health check is superficial

\- \[ ] 6.12 — Add Docker Compose healthcheck for API  

&#x20; File: docker-compose.yaml  

&#x20; Action: Add healthcheck for the API service (currently only web port 5487 is checked). Add depends\_on with condition: service\_healthy  

&#x20; Justification: Ensure proper startup ordering and failure detection

Secrets Management (2h)

\- \[x] 6.13 — Stabilize JWT secret generation  

&#x20; File: apps/server/src/app.ts:15-19  

&#x20; Action: If no JWT secret exists in DB at first boot, generate one and immediately persist it. Verify at every subsequent boot that the secret in DB is consistent. Add a startup warning if the secret changes. Consider loading from env var JWT\_SECRET with DB as fallback  

&#x20; Justification: Audit 02 — risk of secret regeneration invalidating all tokens

\- \[ ] 6.14 — Remove SMTP placeholder credentials from seed  

&#x20; File: apps/server/prisma/seed.js:106-112  

&#x20; Action: Remove placeholder SMTP credentials. Use empty/null values that prompt the admin to configure SMTP on first access  

&#x20; Justification: Audit L4 — seed contains placeholder credentials

\- \[ ] 6.15 — Evaluate pnpm deploy for portable Docker runtime (Phase 2 review W10)

&#x20; File: Dockerfile

&#x20; Action: The current Docker build relies on pnpm symlinks created at deps stage pointing to paths resolved later. This works but is fragile. Evaluate using `pnpm deploy` to produce a flat, self-contained runtime directory that doesn't depend on symlink resolution.

&#x20; Justification: Phase 2 review W10 — Dockerfile pnpm symlink chain fragility

\- \[ ] 6.16 — Fix lefthook pre-commit hook for large commits on Windows (Phase 3 review)

&#x20; File: lefthook.yml

&#x20; Action: The `{staged_files}` expansion exceeds Windows ~8191 char command-line limit when >100 files are staged. Switch to `--stdin` mode or use `run: pnpm exec biome check --write --unsafe --changed --since=HEAD` instead of passing individual file paths.

&#x20; Justification: Phase 3 review — commit with 167 files failed with "La ligne de commande est trop longue"

\---

Phase 7: Dependency Modernization 📦

> Goal: Replace abandoned/vulnerable packages, consolidate duplicates, clean up dependency tree.  

> Estimated effort: \~20h

Critical Replacements (12h)

\- \[x] 7.1 — Replace speakeasy with otpauth  

&#x20; Files: apps/server/src/modules/two-factor/, apps/server/package.json  

&#x20; Action: Install otpauth. Rewrite TOTP generation and verification to use otpauth API. Critical: write a migration path for existing users' TOTP secrets (test that otpauth can verify codes generated with the same base32 secrets that speakeasy used). Remove speakeasy and @types/speakeasy  

&#x20; Tool: otpauth (actively maintained, TypeScript native, standard-compliant)  

&#x20; Justification: Audit D2 — speakeasy abandoned since 2017, 9 years without security patches, manages TOTP secrets

\- \[x] 7.2 — Replace crypto-js with Node.js native crypto  

&#x20; Files: apps/server/src/, apps/server/package.json  

&#x20; Action: Find all crypto-js usages (likely encryption/hashing). Replace with crypto.createCipheriv, crypto.createHash, crypto.pbkdf2, etc. Remove crypto-js and @types/crypto-js from dependencies  

&#x20; Tool: Node.js built-in crypto module  

&#x20; Justification: Audit D1 — CVE-2023-46233, PBKDF2 uses 1 iteration by default, weak PRNG

\- \[x] 7.3 — Replace react-qr-reader with maintained alternative  

&#x20; Files: apps/web/src/, apps/web/package.json  

&#x20; Action: Replace react-qr-reader (archived beta) with @yudiel/react-qr-scanner or html5-qrcode. Update the QR scanning component (likely used for 2FA setup)  

&#x20; Justification: Audit D3 — archived beta version with camera access, no security patches

Cleanup \& Consolidation (8h)

\- \[ ] 7.4 — Consolidate icon libraries to lucide-react only  

&#x20; Files: apps/web/package.json, all components using @tabler/icons-react or react-icons  

&#x20; Action: Audit all icon usage (Knip can help). Replace @tabler/icons-react and react-icons imports with lucide-react equivalents. Lucide has 1500+ icons, covers virtually all use cases. Remove @tabler/icons-react and react-icons  

&#x20; Justification: Audit 07 — 3 icon libraries is excessive, increases bundle size

\- \[ ] 7.5 — Remove node-fetch, use native fetch  

&#x20; File: apps/server/package.json, all server files importing node-fetch  

&#x20; Action: Replace node-fetch imports with global fetch (available since Node 18, stable in Node 21+). The project uses Node 24  

&#x20; Justification: Audit 07 — node-fetch is superseded by native fetch in Node 18+

\- \[ ] 7.6 — Remove redundant ts-node, keep only tsx  

&#x20; File: apps/server/package.json  

&#x20; Action: Remove ts-node devDependency. Update prisma.seed script to use tsx instead of ts-node. tsx is faster and handles ESM/CJS automatically  

&#x20; Justification: Audit 07 — redundant, tsx does everything ts-node does but better

\- \[ ] 7.7 — Replace nookies with Next.js native cookies  

&#x20; File: apps/web/package.json, files using nookies  

&#x20; Action: Replace nookies usage with next/headers cookies() API (App Router native) for server-side cookie access, and document.cookie or a lightweight wrapper for client-side. nookies was designed for Pages Router  

&#x20; Justification: Audit 07 — stale since 2022, designed for Pages Router, App Router has native alternatives

\- \[ ] 7.8 — Rename framer-motion to motion  

&#x20; File: apps/web/package.json  

&#x20; Action: Replace framer-motion with motion (the package was officially renamed). Update all imports from framer-motion to motion/react. The docs app already uses motion correctly  

&#x20; Justification: Audit 07 — inconsistency, framer-motion is the legacy name

\- \[ ] 7.9 — Move @types/\* from dependencies to devDependencies  

&#x20; Files: apps/server/package.json (@types/crypto-js), apps/web/package.json (@types/react-dropzone)  

&#x20; Action: Move type packages to devDependencies. They're not needed at runtime  

&#x20; Justification: Audit 07 — @types/\* in production dependencies

\- \[ ] 7.10 — Align Prisma CLI and Client versions  

&#x20; File: apps/server/package.json  

&#x20; Action: Change prisma devDependency from ^6.3.1 to ^6.11.0 to match @prisma/client  

&#x20; Justification: Audit 07 — version mismatch between CLI and client

\---

Phase 8: Polish \& Production Readiness ✨

> Goal: Documentation, final security review, performance audit, production hardening.  

> Estimated effort: \~20h

Documentation (4h)

\- \[ ] 8.1 — Add LICENSE file at repository root  

&#x20; File: LICENSE (new, root)  

&#x20; Action: Create Apache-2.0 license file. It's declared in package.json but the actual file is missing  

&#x20; Justification: Audit 07 — license declared but file absent

\- \[ ] 8.2 — Update CONTRIBUTING.md with new tooling  

&#x20; File: CONTRIBUTING.md  

&#x20; Action: Document: just commands, Biome formatting, conventional commit format, test writing guidelines, PR template expectations. Remove references to make  

&#x20; Justification: New tooling from Phase 1 needs documentation

\- \[ ] 8.3 — Add README.md to apps/server/src/ and apps/web/src/  

&#x20; Files: apps/server/src/README.md (new), apps/web/src/README.md (new)  

&#x20; Action: Brief architecture guides: module structure, key patterns, how to add new features  

&#x20; Justification: Audit 06 — no source README in either app

Upload Resume (8h)

\- \[ ] 8.4 — Implement upload resume for multipart uploads  

&#x20; File: apps/web/src/hooks/useUppyUpload.ts  

&#x20; Action: Implement the listParts callback that currently returns \[] with a TODO comment. Store upload state (uploadId, completed parts) in localStorage. On retry, resume from the last completed part instead of restarting  

&#x20; Justification: Audit 03 — upload resume not implemented, large file uploads restart from zero on failure

Performance Audit (4h)

\- \[ ] 8.5 — Run Lighthouse CI and fix major issues  

&#x20; Action: Set up @lhci/cli in CI. Run Lighthouse on key pages (home, login, dashboard, file manager, share view). Target scores: Performance >90, Accessibility >95, Best Practices >95, SEO >90. Fix any major findings  

&#x20; Justification: No performance baseline exists

\- \[ ] 8.6 — Add @next/bundle-analyzer for bundle size monitoring  

&#x20; File: apps/web/next.config.ts  

&#x20; Action: Install and configure bundle analyzer. Run periodically to catch bundle size regressions. Add to CI as an optional check with size limit thresholds  

&#x20; Justification: With 3 icon libraries and heavy dependencies, bundle size is likely bloated

Final Security Review (4h)

\- \[ ] 8.7 — Run pnpm audit and resolve all findings  

&#x20; Action: After all dependency changes, run pnpm audit to verify zero known vulnerabilities. Add pnpm audit --audit-level=high to CI pipeline  

&#x20; Justification: Final verification after all dependency changes

\- \[ ] 8.8 — Add security headers via Fastify  

&#x20; File: apps/server/src/app.ts  

&#x20; Action: Install @fastify/helmet. Configure with appropriate CSP, HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy headers  

&#x20; Justification: No security headers configured

\- \[ ] 8.9 — Add Content Security Policy to Next.js  

&#x20; File: apps/web/next.config.ts or apps/web/src/middleware.ts  

&#x20; Action: Configure CSP headers: restrict script-src, style-src, img-src, connect-src to known origins. Use nonces for inline scripts  

&#x20; Justification: Defense-in-depth, no CSP exists

\- \[ ] 8.10 — Validate all env vars at startup  

&#x20; Files: apps/server/src/config/, apps/web/src/env.ts (new)  

&#x20; Action: Server: validate all required env vars at boot using Zod (print clear error messages for missing/invalid vars, fail fast). Web: use @t3-oss/env-nextjs or a custom Zod validation for NEXT\_PUBLIC\_\* and server-side env vars  

&#x20; Justification: Audit 02 — STORAGE\_URL required but not validated at startup, API\_BASE\_URL has a typo in example

\- \[ ] 8.11 — Configure timeout values for production  

&#x20; File: apps/server/src/app.ts:31-33  

&#x20; Action: Set reasonable timeouts: connectionTimeout: 30000 (30s), requestTimeout: 300000 (5min for uploads), keepAliveTimeout: 30000 (30s). These are currently all 0 (disabled) which enables slowloris DoS  

&#x20; Justification: Audit 02 — all timeouts disabled, slowloris vulnerability

\- \[ ] 8.12 — Add a11y testing to CI  

&#x20; Action: Install @axe-core/playwright. Add accessibility checks to Playwright E2E tests using checkA11y(). Configure rules severity (critical = fail, moderate = warn)  

&#x20; Justification: Audit 03 — no formal a11y testing

\- \[ ] 8.13 — QA validate OAuth flow through proxy (Phase 2 review W1)

&#x20; Action: End-to-end test the OAuth authorize/callback flow through the new catch-all proxy. The proxy now uses `text()` instead of `json()` for non-redirect OAuth responses, which is more correct but untested. Verify error cases where upstream returns non-JSON.

&#x20; Justification: Phase 2 review W1 — OAuth authorize response shape changed

\- \[ ] 8.14 — Evaluate proxy route matcher performance (Phase 2 review S1)

&#x20; File: apps/web/src/lib/proxy.ts

&#x20; Action: The route matcher is O(n) scanning 122 routes per request. Fine at current scale (~microseconds). If route count grows significantly, consider bucketing by method then segment count, or pre-compiling to a trie.

&#x20; Justification: Phase 2 review S1 — performance note

\- \[x] 8.15 — ~~PrismaClient singleton: add globalThis memoization for HMR/test reloads (Phase 3 review M-1)~~ — **CLOSED: not applicable**. Server uses `tsx watch` which restarts the process on file changes (no HMR). The `globalThis` memoization pattern is a Next.js-specific concern. Prisma is not used in the Next.js app (proxies to Fastify). If Prisma usage is ever added to `apps/web/` server components, revisit then.

\- \[ ] 8.16 — Expand health test and web smoke test to cover real app logic (Phase 3 review M-5/M-6)

&#x20; Files: apps/server/src/\_\_tests\_\_/health.test.ts, apps/web/src/\_\_tests\_\_/smoke.test.tsx

&#x20; Action: Health test currently has a single 200-status assertion — expand to exercise the global error handler, auth middleware, or at minimum test error paths. Web smoke test tests the shadcn Button (third-party) — replace with tests for actual app components or hooks. Consider renaming health.test.ts to health.smoke.test.ts if it stays minimal.

&#x20; Justification: Phase 3 review M-5/M-6

\- \[ ] 8.17 — Add JSDoc comment to frontend logger about module-load env capture (Phase 3 review M-4)

&#x20; File: apps/web/src/lib/logger.ts

&#x20; Action: `NEXT_PUBLIC_LOG_LEVEL` is captured once at module evaluation time. Runtime overrides won't work. Add a JSDoc comment documenting this intentional design constraint.

&#x20; Justification: Phase 3 review M-4 — trivial but worth documenting for future developers

\- \[ ] 8.18 — Honest frontend logger: rename or upgrade (Phase 3 QA-9)

&#x20; File: apps/web/src/lib/logger.ts

&#x20; Action: The frontend "structured logger" is a 37-line console wrapper with level filtering — no JSON serialization, no transports, no redaction, no correlation IDs. Either (a) rename references in docs/code comments to "client logger" / "level-filtered logger" to avoid misleading claims, or (b) back it with a real transport (Sentry breadcrumbs, OpenTelemetry browser SDK, etc.) for production builds. Also: ~54% of call sites pass only `{ err }` with no real context — review and enrich where meaningful.

&#x20; Justification: Phase 3 quality audit QA-9

\---

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

Phase 8: Polish \& Production Readiness	18	\~20h	No — but not production-grade without it

TOTAL	138 items	\~256h	 

Execution Notes

1\. Phase 0 and Phase 1 should overlap: Start Phase 1 tooling setup immediately after Phase 0 security fixes. Having Vitest ready before writing Phase 0 regression tests is ideal — but don't delay security fixes waiting for test infra.

2\. Phase 7 items 7.1-7.3 should be done in Phase 1: The speakeasy, crypto-js, and react-qr-reader replacements are security-critical and shouldn't wait for Phase 7. They're listed in Phase 7 for organizational clarity but should execute during Phase 1.

3\. Phase 2 enables Phase 3: The shared packages and consolidated configs from Phase 2 make the type safety work in Phase 3 much easier (shared types across apps).

4\. Biome is the clear winner for this stack: After evaluating ESLint+Prettier vs Biome vs oxlint+dprint:

&#x20;  - Biome: single binary, lint+format, 10-100x faster, growing rule set (250+ rules), native import sorting, good TypeScript/React support. The only gap is Next.js-specific rules (\~5 rules) which can be supplemented minimally.

&#x20;  - The @ianvs/prettier-plugin-sort-imports, eslint-plugin-prettier, eslint-config-prettier chain (7 packages) is replaced by 1 package.

5\. The proxy layer (Phase 2.5) is the highest-ROI architectural change: Reducing 101 files to 1 handler + config eliminates the single largest maintenance burden in the codebase.

