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
- **Proxy layer**: Dev-mode Edge Middleware (`apps/web/src/proxy.ts`) with Next.js runtime rewrite; Traefik infrastructure routing in production
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
- **Code quality**: Biome (noExplicitAny enforced), AppError hierarchy, Pino logging, 476 tests (255 server + 221 web)
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
  BUGS.md             ← bug reports and resolution status
  TECHNICAL-DEBT.md   ← tracked technical debt items
  specs/              ← one file per feature (design + decisions)
    5.1-quotas.md       Per-User Storage Quotas (Done)
    5.2-cleanup.md      Automatic Cleanup of Expired Content
    5.3-ldap.md         LDAP / Active Directory Sync
    5.4-groups.md       Groups
    6.1-ui-audit.md     UI Code Audit (Done)
    6.2-ui-fixes.md     UI Code Quality Fixes (Done)
    6.3-visual-redesign.md  Visual Redesign (Done)
    7.1-error-handling-dashboard.md  Error Handling & Dashboard (Done)
  plans/              ← implementation plans (tasks, batches)
  reviews/            ← review findings (checkboxes = post-review TODO)
```

### Workstreams

**5.x — New Features**: 5.1 Quotas (Done) → 5.4 Groups → 5.3 LDAP/AD (sequential dependency). 5.2 Auto-cleanup is independent.

**6.x — UI Overhaul**: Done (6.1 audit → 6.2 fixes → 6.3 redesign). Smart, sober, corporate look with indigo palette (hue 265).

**7.x — Error Handling & Polish**: 7.1 Done. Error handling, dashboard redesign, bug fixes B-1 through B-6.

**Bugs & Tech Debt**: B-7 (login validation) + TD-1 (unsafe TData generics) + TD-2 (ACCOUNT_LOCKED) all resolved. TD-3 (2FA brute-force gap) tracked in `TECHNICAL-DEBT.md`.

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
0. **NEVER dispatch multiple agents in parallel.** Always sequential, one at a time. Parallel agents see each other's uncommitted changes, create stash conflicts, do git resets, and produce inconsistent results. Wait for one agent to fully complete before dispatching the next.
1. **IMPORTANT: Empty subagent output is a bug, not a signal.** If a subagent returns an empty or near-empty result, it means the Task tool timed out or hit a transport error while the agent was still working. The agent is likely STILL running and making changes (edits, commits). **Do NOT re-dispatch, re-do work, or touch the working tree.** Wait for the agent to finish on its own — it will complete its work independently. Only after confirming the agent is truly done (wait for the agent's actual output message, or ask the user to provide it) should you proceed.
2. **Consistency over compatibility** — prefer clean implementations, no need to preserve legacy behavior
3. **One concern per commit** — atomic changes, clear commit messages
4. **Check for side effects** — search for all callers/importers before changing a function signature
5. **Preserve i18n** — don't break translation keys
6. **Test your changes** — at minimum verify TypeScript compiles (`pnpm run type-check` in the relevant app)
7. **Report clearly** — state what was changed, which files, and any risks or follow-up needed
8. **Reference files, don't copy them** — reference files by path and line range instead of copy-pasting content into prompts
9. **Run the FULL test suite for affected packages** — not just new tests. Always `pnpm --filter <package> test` for every package touched.
10. **Fastify + Zod route schemas strip unknown properties** — keep route-level and controller-level schemas in sync. Service-layer unit tests don't catch missing fields — use integration tests with `app.inject()`.
11. **Service-layer tests are necessary but not sufficient** — for security-critical flows, always add at least one `app.inject()` integration test that exercises the full request lifecycle.
12. **Production-only bugs require production-like testing** — dev mode is too permissive. The E2E workflow (`e2e.yml`) catches SSR, cookie, and build-time issues.

## Context Compression Discipline
- **Never compress context you're about to use.** If you gathered file contents or code context for an upcoming task (writing a plan, implementing a feature), do NOT compress it before completing that task. Re-reading files wastes tokens and time.
- **Compress only closed sections** — research that concluded, dead-end exploration, completed implementation steps that won't be revisited.
- **Compress between phases, not within** — e.g., compress the brainstorming phase AFTER the spec is written and approved, not before. Compress the planning context AFTER the plan is written, not before.
- **Keep active working context raw** — if you're about to write code, the file contents, schemas, and patterns you just read are your working material. Don't summarize them away.
- **When in doubt, don't compress** — a slightly longer context is always better than re-reading 10 files.
