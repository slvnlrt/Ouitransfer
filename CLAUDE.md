# Ouitransfer - Agent Instructions

## Project Overview
Ouitransfer is a self-hosted file transfer solution (WeTransfer alternative).
- **Monorepo**: `apps/server`, `apps/web`, `apps/docs` (pnpm workspace + Turborepo)
- **Server**: Fastify 5 + Prisma (SQLite) + S3-compatible storage (MinIO or external)
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
  infra/              Docker, MinIO, deployment scripts
  audit/              Audit reports and remediation tracking
```

## Key Conventions
- **Module system**: ESM throughout (server has `"type": "module"`, all relative imports use `.js` extensions)
- **File naming**: kebab-case for files, PascalCase for React components
- **Server modules**: `src/modules/{feature}/` with `controller.ts`, `service.ts`, `routes.ts`, `dto.ts`
- **Shared code**: `packages/shared` for cross-app utilities — use subpath exports (`./mime-types`) not barrel exports
- **Proxy layer**: Single catch-all handler at `apps/web/src/app/api/[...proxy]/route.ts` with route table in `proxy-routes.ts`
- **Validation**: Zod schemas via `fastify-type-provider-zod`
- **Auth**: JWT in httpOnly cookie, bcrypt, 2FA via otpauth (TOTP, RFC 6238)
- **i18n**: next-intl, 22 languages, messages in `apps/web/messages/`
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
eliminated). Fastify request typing via `@fastify/jwt` augmentation (66 casts removed). Centralized
error handler (`globalErrorHandler` — catches Zod, JWT, Prisma, generic errors; controllers still
have own try/catch — migration deferred to Phase 5 item 5.16). Pino logger replaces console.* on
server (~87 calls), frontend structured logger for all hooks + components (54 + 57 calls). 9 large
files split (4 server modules, 5 web components). PrismaClient singleton unified. Initial Prisma
migration committed. Real tests: health endpoint inject test, Button component tests, 62 proxy route
tests, 29 error handler tests. Knip config fixed for docs MDX. `__DELETE__` sentinel typed.
eslint-disable comments removed. 13 pre-existing a11y lint errors fixed.
Review follow-ups: I-1/I-3/I-4/I-5/I-6/I-7/I-8 fixed; I-2 deferred to Phase 5.

### Remediation Workflow
Each phase follows this process:
1. Execute items from `audit/CONSOLIDATED-TODO-LIST.md`
2. Reviewer agent verifies each batch
3. Follow-ups go into `audit/TODO-POST-PHASE-N.md`
4. Completed items are tracked in `audit/DONE.md`

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
  CONSOLIDATED-TODO-LIST.md   Master roadmap (~120 items, 9 phases)
  DONE.md                     Completed items log
  TODO-POST-PHASE-0.md        Reviewer follow-ups from Phase 0
  TODO-POST-PHASE-1.md        Reviewer follow-ups from Phase 1 (all resolved)
  TODO-POST-PHASE-2.md        Reviewer follow-ups from Phase 2 (all resolved)
  TODO-POST-PHASE-3.md        Reviewer follow-ups from Phase 3
```

### Next Up
- Phase 4 of CONSOLIDATED-TODO-LIST — Backend Refinement

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
