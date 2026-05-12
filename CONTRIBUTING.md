# Contributing to Ouitransfer

Ouitransfer is a self-hosted file transfer solution (WeTransfer alternative) built as a pnpm monorepo with Turborepo. Contributions are welcome — this guide covers the developer workflow from setup through submitting a PR.

Repository: **[https://github.com/burger-cie/ouitransfer](https://github.com/burger-cie/ouitransfer)**

---

## Prerequisites

| Tool | Version |
|------|---------|
| Node.js | 24 |
| pnpm | 10.6.0 |
| Docker | any recent version (for S3-compatible storage) |
| `just` | any recent version (task runner) |

Install `just` via [https://github.com/casey/just](https://github.com/casey/just) or your system package manager.

---

## Local Setup

```bash
# 1. Clone and install dependencies
git clone https://github.com/burger-cie/ouitransfer.git
cd ouitransfer
pnpm install

# 2. Copy environment config
cp .env.example .env
# Edit .env with your storage credentials and secrets

# 3. Set up the database
just db-migrate-dev   # Apply migrations (creates SQLite DB)
just db-seed          # Seed initial data (admin user, etc.)

# 4. Start all apps in development mode
just dev
```

The following services will be available:
- **Server** (Fastify API): http://localhost:3333
- **Web** (Next.js frontend): http://localhost:3000
- **Docs** (Fumadocs): http://localhost:3001

---

## Project Structure

```
ouitransfer/
  apps/
    server/         Fastify 5 API — port 3333
    web/            Next.js 15 frontend — port 3000 (dev) / 5487 (prod)
    docs/           Fumadocs documentation site — port 3001
  packages/
    shared/         @ouitransfer/shared — cross-app utilities (mime-types, etc.)
    config/         @ouitransfer/config — shared tsconfig presets
  infra/            Docker Compose, deployment config
  audit/            Audit reports and remediation tracking
```

---

## Development Workflow

```bash
just dev        # Start all apps (server + web + docs) in watch mode
just test       # Run all Vitest unit/integration tests
just lint       # Run Biome linter across the monorepo
just validate   # type-check + lint + test (full CI check locally)
```

Run tests for a specific app:

```bash
pnpm --filter @ouitransfer/server test
pnpm --filter @ouitransfer/web test
```

Run E2E tests (requires a running dev server):

```bash
pnpm e2e
```

---

## Common `just` Commands

Run `just --list` to see all available recipes.

| Command | Description |
|---------|-------------|
| `just dev` | Start all apps in development mode |
| `just test` | Run all tests (Vitest) |
| `just lint` | Run Biome linter |
| `just validate` | type-check + lint + test |
| `just db-generate` | Re-generate Prisma client after schema changes |
| `just db-migrate-dev` | Apply pending migrations (dev) |
| `just db-studio` | Open Prisma Studio (database GUI) |
| `just db-seed` | Seed the database with initial data |
| `just db-reset` | Drop and re-create the database |
| `just clean` | Remove build artifacts |
| `just clean-all` | Remove build artifacts + node_modules |
| `just docker-start` | Start Docker Compose (storage + server + web) |
| `just docker-stop` | Stop Docker Compose |
| `just docker-build [tag]` | Build Docker images |

---

## Code Standards

**Biome** handles linting and formatting (replaces ESLint + Prettier). Configuration is in `biome.json` at the root.

**Lefthook** runs Biome automatically on staged files before each commit — no manual formatting step needed.

Key rules enforced:
- No `any` types (`noExplicitAny` + `noImplicitAnyLet` as errors)
- No unused imports or variables
- Consistent import ordering

To check or fix manually:

```bash
just lint                          # Check all files
pnpm biome check --write .         # Auto-fix
```

---

## Commit Format

Commits are enforced by **commitlint** (Conventional Commits specification):

```
<type>(<scope>): <description>

Types: feat, fix, docs, style, refactor, test, chore, perf, build, ci
```

Examples:
```
feat(share): add password-protected share expiry
fix(auth): correct token refresh cookie path
docs: update CONTRIBUTING.md
chore(deps): update Fastify to v5.3
```

Scopes are optional but encouraged (e.g., `auth`, `share`, `file`, `web`, `server`).

---

## Testing

- **Unit/integration tests**: [Vitest](https://vitest.dev/) — run with `just test` or `pnpm test`
- **E2E tests**: [Playwright](https://playwright.dev/) — run with `pnpm e2e`
- **Test pattern**: `*.test.ts` / `*.spec.ts` files co-located in `__tests__/` directories

For server integration tests, use Fastify's `app.inject()` to exercise the full request lifecycle (route registration, middleware, schema validation). Service-layer unit tests alone are not sufficient for security-critical flows.

---

## Pull Requests

1. Fork the repository and create a branch from `main`
2. Make your changes with atomic, conventional commits
3. Ensure `just validate` passes locally (type-check + lint + test)
4. Open a PR against the `main` branch of `burger-cie/ouitransfer`
5. Fill in the PR template with a clear description of what changed and why

CI will run: lint, type-check, tests, and build for all packages.

Keep PRs focused — one concern per PR makes review faster.

---

## Architecture Notes

### Server (`apps/server`)

- **Framework**: Fastify 5 with `fastify-type-provider-zod` for schema validation
- **Database**: Prisma ORM with SQLite
- **Storage**: S3-compatible (RustFS by default in Docker)
- **Module structure**: `src/modules/{feature}/` — each module has `controller.ts`, `service.ts`, `routes.ts`, `dto.ts`
- **Auth**: JWT in httpOnly cookies (15-min access tokens + refresh rotation), 2FA via TOTP (RFC 6238)
- **Validation**: Zod schemas on both route level and controller level — keep them in sync

### Web (`apps/web`)

- **Framework**: Next.js 15 (App Router) + React 19
- **Data fetching**: TanStack Query v5 — all server state lives in the TQ cache (no Zustand/Context for server data)
- **API communication**: Single catch-all proxy at `apps/web/src/app/api/[...proxy]/route.ts`, route table in `proxy-routes.ts`
- **Auth**: JWT verification via `jose` at the Edge in `src/middleware.ts`
- **i18n**: next-intl with 23 languages, message files in `apps/web/messages/`
- **UI**: shadcn/ui (new-york style) + Radix primitives + lucide-react icons

### Shared packages

- `@ouitransfer/shared` — utilities shared across apps (mime-type helpers, etc.). Use subpath exports: `import { ... } from "@ouitransfer/shared/mime-types"`, not barrel imports.
- `@ouitransfer/config` — shared TypeScript config presets (`base`, `server`, `nextjs`)
