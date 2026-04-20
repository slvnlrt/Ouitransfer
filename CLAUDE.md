# Ouitransfer - Agent Instructions

## Project Overview
Ouitransfer is a self-hosted file transfer solution (WeTransfer alternative).
- **Monorepo** (currently fake — no `pnpm-workspace.yaml` yet): `apps/server`, `apps/web`, `apps/docs`
- **Server**: Fastify 5 + Prisma (SQLite) + S3-compatible storage (MinIO or external)
- **Web**: Next.js 15 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui
- **Docs**: Fumadocs (Next.js)
- **Package manager**: pnpm 10.6.0
- **Node**: 24 (Alpine in Docker)
- **Version**: 3.3.2-beta

## Architecture
```
D:\Code\Ouitransfer\
  apps/server/     Fastify API, port 3333, ~74 TS files
  apps/web/        Next.js frontend, port 5487, ~403 TSX files
  apps/docs/       Fumadocs site, port 3001, ~31 files
  infra/           Docker, MinIO, deployment scripts
  audit/           Audit reports and remediation tracking
```

## Key Conventions
- **File naming**: kebab-case for files, PascalCase for React components
- **Server modules**: `src/modules/{feature}/` with `controller.ts`, `service.ts`, `routes.ts`, `dto.ts`
- **Validation**: Zod schemas via `fastify-type-provider-zod`
- **Auth**: JWT in httpOnly cookie, bcrypt, 2FA via speakeasy (to be replaced)
- **i18n**: next-intl, 22 languages, messages in `apps/web/messages/`
- **UI**: shadcn/ui (new-york style), Radix primitives, lucide-react icons

## Current State (Post-Audit)
A comprehensive 8-dimension audit was completed. Score: 4.3/10. See `audit/` directory for full reports.

### Active Remediation: Phase 0 — Security Emergency
We are currently fixing critical security vulnerabilities. See `audit/CONSOLIDATED-TODO-LIST.md` for the full roadmap and `audit/DONE.md` for completed items.

### Critical Issues Being Fixed
1. Prototype pollution protection disabled (`app.ts:36-37`)
2. 1PB body limit (DoS vector)
3. `/s3/*` routes have zero authentication
4. `/embed/:id` serves files without auth
5. CORS allows any origin
6. No rate limiting
7. Shell `exec()` in storage service
8. 2FA bypass (userId from client)

## Rules for Agents
1. **Never break existing functionality** — the app must remain functional after each change
2. **One concern per commit** — atomic changes, clear commit messages
3. **Check for side effects** — search for all callers/importers before changing a function signature
4. **Preserve i18n** — don't break translation keys
5. **Test your changes** — at minimum verify TypeScript compiles (`pnpm run type-check` in the relevant app)
6. **Report clearly** — state what was changed, which files, and any risks or follow-up needed
