# GitHub Copilot Instructions — Ouitransfer

Ouitransfer is a self-hosted file transfer solution (WeTransfer alternative), built as a pnpm monorepo with Turborepo.

## Stack

- **Backend**: Fastify 5 + TypeScript (ESM), Prisma ORM (SQLite), S3-compatible storage (RustFS default)
- **Frontend**: Next.js 15 (App Router) + React 19 + Tailwind CSS 4 + shadcn/ui (new-york style)
- **Docs**: Fumadocs (Next.js)
- **Package manager**: pnpm 10.6.0 with workspace catalogs
- **Node**: 24
- **Monorepo tooling**: Turborepo, pnpm workspaces

## Repository structure

```
apps/
  server/     # Fastify API, port 3333
  web/        # Next.js frontend, port 3000
  docs/       # Fumadocs documentation site, port 3001
packages/
  shared/     # @ouitransfer/shared — shared utilities (mime-types, etc.)
  config/     # @ouitransfer/config — shared tsconfig presets
infra/        # Docker, deployment config
e2e/          # Playwright end-to-end tests
```

## Key conventions

- **Module system**: ESM throughout — server uses `"type": "module"`, all relative imports use `.js` extensions
- **File naming**: kebab-case for files, PascalCase for React components
- **Server modules**: `src/modules/{feature}/` with `controller.ts`, `service.ts`, `routes.ts`, `dto.ts`
- **Shared code**: `packages/shared` via subpath exports (`@ouitransfer/shared/mime-types`)
- **Validation**: Zod schemas via `fastify-type-provider-zod`
- **Auth**: JWT (httpOnly cookie, 15-min access + refresh rotation), bcrypt, 2FA via otpauth (TOTP)
- **i18n**: next-intl, 23 languages, messages in `apps/web/messages/`
- **Error handling**: AppError hierarchy thrown from services/controllers, caught by `globalErrorHandler`

## Code quality tools

- **Linter + formatter**: Biome (replaces ESLint + Prettier) — run `pnpm lint` or `pnpm format`
- **Type checking**: `pnpm type-check`
- **Tests**: Vitest (unit + integration), Playwright (e2e)
- **Validation**: `pnpm validate` (lint + type-check)
- **Git hooks**: Lefthook (replaces Husky)
- **Dead code**: Knip — `pnpm knip`

## Common commands

```bash
# Development
pnpm dev                        # Start all apps
pnpm --filter ouitransfer-api dev   # Start server only
pnpm --filter ouitransfer-web dev   # Start web only

# Quality
pnpm lint        # Biome lint (all apps)
pnpm format      # Biome format (all apps)
pnpm type-check  # TypeScript check (all apps)
pnpm validate    # lint + type-check
pnpm test        # Vitest (all packages)

# Database (server)
pnpm --filter ouitransfer-api db:generate   # Generate Prisma client
pnpm --filter ouitransfer-api db:migrate    # Run migrations

# Docker
docker compose up    # Start all 3 containers (storage + server + web)
docker compose down  # Stop all containers
```

## Commit convention

Conventional Commits format:

```
<type>(<scope>): <description>

Types: feat, fix, docs, test, refactor, style, chore, perf, ci
```

## License

Apache-2.0
