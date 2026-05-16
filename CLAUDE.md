# Ouitransfer - Agent Instructions

## Project Overview
Ouitransfer is a self-hosted file transfer solution (WeTransfer alternative).
- **Monorepo**: `apps/server`, `apps/web`, `apps/docs` (pnpm workspace + Turborepo)
- **Server**: Fastify 5 + Prisma (SQLite) + S3-compatible storage (RustFS or external)
- **Web**: Next.js 15 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui
- **Docs**: Fumadocs (Next.js)
- **Package manager**: pnpm 10.6.0
- **Node**: 24 (Alpine in Docker)
- **Version**: 0.0.0-dev (displayed as `vdev` in UI; injected from git tag at Docker build time via `NEXT_PUBLIC_APP_VERSION`)

## Architecture
```
D:\Code\Ouitransfer\
  apps/server/        Fastify API (ESM), port 3333, ~74 TS files
  apps/web/           Next.js frontend, port 3000 (dev) / 5487 (prod), ~300 TSX files
  apps/docs/          Fumadocs site, port 3001, ~31 files
  packages/shared/    @ouitransfer/shared — shared utilities (mime-types, etc.)
  packages/config/    @ouitransfer/config — shared tsconfig presets (base, server, nextjs)
  infra/              Docker, deployment scripts
  audit/              Historical audit reports (all archived in audit/archive/)
  features/           Active feature specs, plans, and tracking (see below)
```

## Development Tools
- **Task runner**: `just` is installed — use `just --list` or `just` to see all available recipes (see `Justfile` at root)
  - Common: `just dev`, `just test`, `just lint`, `just validate`, `just setup`
  - Local dev: `just setup-dev` (first-time setup), `just db-dev-init` (create/recreate SQLite DB)
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
- **Auth**: JWT in httpOnly signed cookie, bcrypt, 2FA via otpauth (TOTP, RFC 6238), CSRF double-submit cookie
- **i18n**: next-intl, 23 languages, messages in `apps/web/messages/`
- **UI**: shadcn/ui (new-york style), Radix primitives, lucide-react icons, motion (framer-motion)
- **Dependency versions**: pnpm catalogs in `pnpm-workspace.yaml` for shared deps (2+ apps)
- **Error handling**: AppError hierarchy (server), ErrorDisplay component (frontend), globalErrorHandler
- **Logging**: Pino (server), level-filtered logger wrapper (frontend)
- **Testing**: Vitest (unit/integration), Playwright (E2E), `app.inject()` for Fastify route tests
- **Docker**: 3-container architecture (RustFS storage + Fastify server + Next.js web)

## Refactor History (Phases 0-9) — COMPLETE

A comprehensive 8-dimension audit scored the codebase at 4.3/10. Nine remediation phases (0-9) plus CI/Docker integration and post-phase polish brought it to production-ready quality. All audit items are resolved, all review follow-ups are closed.

Key outcomes:
- **Security**: CSRF, JWT signed cookies, brute-force lockout, refresh token rotation, CSP headers, MIME validation
- **Architecture**: ESM migration, pnpm workspace, Turborepo, packages/shared + packages/config
- **Code quality**: Biome (noExplicitAny enforced), AppError hierarchy, Pino logging, 420+ tests
- **Frontend**: TanStack Query, error boundaries, code splitting, a11y (skip-to-content, RTL, route announcer)
- **Infrastructure**: 3-container Docker Compose, health endpoint with DB+S3 checks, CI pipeline
- **Dependencies**: 10 packages removed, framer-motion → motion, icons consolidated to lucide-react
- **Documentation**: All docs rewritten for current architecture

Full historical details are in `audit/archive/`. The audit phase is closed — we are now in the feature development phase.

## Active Work — Feature Development

All planning and tracking lives in `features/`. See [`features/README.md`](features/README.md) for the full status table.

### Directory Structure
```
features/
  README.md           ← orientation, status table, workflow
  SESSIONS.md         ← session log (date + bullet points)
  specs/              ← one file per feature (design + decisions)
    5.1-quotas.md       Per-User Storage Quotas
    5.2-cleanup.md      Automatic Cleanup of Expired Content
    5.3-ldap.md         LDAP / Active Directory Sync
    5.4-groups.md       Groups
    6.1-ui-audit.md     UI Code Audit
    6.2-ui-fixes.md     UI Code Quality Fixes
    6.3-visual-redesign.md  Visual Redesign (new identity)
  plans/              ← implementation plans (tasks, batches)
  reviews/            ← review findings (checkboxes = post-review TODO)
```

### Workstreams

**5.x — New Features**: Quotas → Groups → LDAP/AD (sequential dependency). Auto-cleanup is independent.

**6.x — UI Overhaul**: Audit → Fixes → Visual Redesign (sequential). Independent from 5.x, can run in parallel.

The visual redesign (6.3) aims for a **smart, sober, corporate** look with **wow factor** — replacing the current green palette with a new identity that signals the project's fresh direction.

## Important: No Production, No Legacy
The app is **not in production** and has no existing users. This means:
- **No backward compatibility required** — APIs, env vars, DB schemas can be changed freely
- **No incremental migrations** — Prisma schema can be reset/recreated from scratch
- **No legacy shims** — dead code, deprecated patterns, and proxy layers can be deleted outright
- **No gradual rollouts** — breaking changes are fine, no feature flags needed
- **Clean slate** — prefer the correct solution over the compatible one

## Quality Standard
**Perfect implementation, zero technical debt.**
- Fix pre-existing issues encountered along the way — not just items explicitly in scope
- All review findings must be addressed: Critical, Important, AND Minor — none are optional
- No compromises justified by "it's minor" or "it works for now"
- Future-proof: prefer the clean solution even if it requires more refactoring

## Implementation Workflow
Use **subagent-driven development** (see `subagent-driven-development` skill):
1. **Spec** — resolve open questions, record decisions in the spec file (`features/specs/`)
2. **Plan** — write implementation plan (`features/plans/`)
3. **Implement** — execute with subagents (implementer → spec review → quality review per task)
4. **Review** — reviewer agent writes findings in `features/reviews/` (each finding = checkbox)
5. **Fix ALL** — address every finding, check them off in the review file
6. **Done** — update `features/README.md` status table and `features/SESSIONS.md` log

The review file IS the post-review TODO. A feature is not Done until every checkbox is checked.
Findings are rated Critical / Important / Minor — **all must be fixed, none are optional**.

**Batching strategy**: Group tasks into a single agent dispatch when they are:
- Mechanical/repetitive (e.g., rename a type across N files, fix N locale files)
- Touching the same system or files
- Low-risk with clear specs (no architectural judgment required)
Reserve separate agents for tasks requiring distinct architectural decisions or large file sets.

## Rules for Agents
1. **Consistency over compatibility** — prefer clean implementations, no need to preserve legacy behavior
2. **One concern per commit** — atomic changes, clear commit messages
3. **Check for side effects** — search for all callers/importers before changing a function signature
4. **Preserve i18n** — don't break translation keys
5. **Test your changes** — at minimum verify TypeScript compiles (`pnpm run type-check` in the relevant app)
6. **Report clearly** — state what was changed, which files, and any risks or follow-up needed
7. **Reference files, don't copy them** — reference files by path and line range instead of copy-pasting content into prompts
8. **Run the FULL test suite for affected packages** — not just new tests. Always `pnpm --filter <package> test` for every package touched.
9. **Fastify + Zod route schemas strip unknown properties** — keep route-level and controller-level schemas in sync. Service-layer unit tests don't catch missing fields — use integration tests with `app.inject()`.
10. **Service-layer tests are necessary but not sufficient** — for security-critical flows, always add at least one `app.inject()` integration test that exercises the full request lifecycle.
11. **Production-only bugs require production-like testing** — dev mode is too permissive. The E2E workflow (`e2e.yml`) catches SSR, cookie, and build-time issues.
