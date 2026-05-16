# Phase 9: Documentation Site Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all documentation pages in `apps/docs/content/docs/v3-beta/` in sync with the 3-container architecture, current tooling, and security requirements from Phases 0–8.

**Architecture:** 7 MDX files need updating. The gold-standard reference is `quick-start.mdx` (already rewritten in Phase 6). All files should align to: 3-container Docker architecture (storage/server/web), RustFS as default S3 storage, mandatory secrets (JWT_SECRET/CSRF_SECRET/COOKIE_SECRET), React 19, pnpm 10, Node 24, Biome, Vitest, Turborepo, `just`.

**Tech Stack:** Fumadocs (MDX), no code changes — documentation only.

---

## Reference: Correct Values (source of truth)

All 7 files should use these values consistently:

| Item | Correct Value |
|------|---------------|
| Container names | `ouitransfer-storage`, `ouitransfer-server`, `ouitransfer-web` |
| Docker Compose services | `storage`, `server`, `web` |
| Images | `rustfs/rustfs:latest`, `ouitransfer/server:latest`, `ouitransfer/web:latest` |
| Ports | 9000 (storage S3 API), 3333 (server API), 5487 (web frontend) |
| Health endpoint | `http://localhost:3333/health` on the **server** container |
| Storage model | S3-compatible always. RustFS is internal default. `ENABLE_S3=true` for external S3. No filesystem storage mode. |
| Required secrets | `JWT_SECRET`, `CSRF_SECRET`, `COOKIE_SECRET` — each min 32 chars, all distinct |
| `STORAGE_URL` | Required when using internal RustFS (public URL browsers use to reach port 9000) |
| React version | React 19 |
| Node version | Node 24 |
| Package manager | pnpm 10.6.0 |
| Linting/formatting | Biome (replaces ESLint + Prettier) |
| Testing | Vitest (unit), Playwright (e2e) |
| Task runner | `just` (see `Justfile` at repo root) |
| Build orchestration | Turborepo |
| Git hooks | Lefthook + commitlint (Conventional Commits) |
| Validation | Zod schemas via `fastify-type-provider-zod` |
| Monorepo packages | `packages/shared` (@ouitransfer/shared), `packages/config` (@ouitransfer/config) |
| Server WORKDIR | `/app/ouitransfer-app` (per Dockerfile) |
| `docker logs` command | `docker compose logs server` (not `docker logs OUITRANSFER`) |
| Quick-start reference | `apps/docs/content/docs/v3-beta/quick-start.mdx` — already correct, use as template |

---

## Task 1: Architecture Pages (9.1, 9.5)

**Audit items:** 9.1 (architecture.mdx), 9.5 (github-architecture.mdx)

**Files:**
- Modify: `apps/docs/content/docs/v3-beta/architecture.mdx` (143 lines)
- Modify: `apps/docs/content/docs/v3-beta/github-architecture.mdx` (144 lines)

**Context:** Both files describe the project's architecture but are stuck in the pre-Phase-6 world: filesystem storage as default, single-container Docker, React 18, no mention of packages/ or modern tooling. They need substantial rewrites.

### architecture.mdx

- [ ] **Step 1: Read current file**

Read `apps/docs/content/docs/v3-beta/architecture.mdx` in full.

- [ ] **Step 2: Rewrite storage sections**

Replace the entire "Filesystem storage" section (lines ~37-53) with an "S3-Compatible Storage" section describing:
- RustFS as the built-in default (runs as a separate container)
- All files stored via S3 API (PutObject, GetObject, presigned URLs)
- External S3 option (`ENABLE_S3=true`) for AWS, Backblaze, etc.
- Remove ALL references to filesystem storage, `DISABLE_FILESYSTEM_ENCRYPTION`, AES-NI, `/proc/cpuinfo`

- [ ] **Step 3: Add Docker architecture section**

Add a section describing the 3-container architecture:
- `storage` (RustFS) — S3-compatible object storage
- `server` (Fastify) — API + SQLite database
- `web` (Next.js) — frontend, proxies API requests to server
- Startup ordering: storage → server → web (healthcheck-based)
- Reference the architecture table from `quick-start.mdx`

- [ ] **Step 4: Update storage flexibility section**

Replace "Default setup (Filesystem)" with "Default setup (RustFS)". Replace "Optional S3-compatible storage" with "External S3 (AWS, Backblaze, etc.)". Update the framing: S3 is always used, the choice is internal vs external.

- [ ] **Step 5: Add mandatory security secrets**

Add mention of `JWT_SECRET`, `CSRF_SECRET`, `COOKIE_SECRET` in the security/configuration part of the architecture overview. Reference `openssl rand -hex 32` for generation.

- [ ] **Step 6: Update "File Storage" line**

Change "Filesystem storage handles file operations with optional S3-compatible support" to "S3-compatible object storage (RustFS built-in or external S3)".

### github-architecture.mdx

- [ ] **Step 7: Read current file**

Read `apps/docs/content/docs/v3-beta/github-architecture.mdx` in full.

- [ ] **Step 8: Fix React and stack versions**

- "React 18" → "React 19" (all occurrences)
- "TailwindCSS" → "Tailwind CSS 4"
- Add Node 24, pnpm 10.6.0 to the stack description
- Add Zod to backend stack list

- [ ] **Step 9: Update project structure tree**

Add `packages/` directory with `shared/` and `config/` subdirectories. This was added in Phase 2.

- [ ] **Step 10: Fix validation description**

"Every route is validated using JSON schema" → "Every route is validated using Zod schemas (via `fastify-type-provider-zod`)".

- [ ] **Step 11: Fix storage references**

- Remove all "filesystem storage as default" descriptions
- "stored directly in the filesystem" → "stored in S3-compatible object storage (RustFS)"
- "filesystem storage for all file operations by default" → "S3-compatible storage (RustFS) for all file operations"

- [ ] **Step 12: Fix Docker architecture description**

"every service: frontend, backend, database, storage, runs in its own isolated environment" → "3 Docker containers: storage (RustFS), server (Fastify API + embedded SQLite), web (Next.js frontend)"

- [ ] **Step 13: Add modern tooling mentions**

Add mentions of: Biome (linting/formatting), Vitest (testing), Turborepo (build orchestration), Lefthook (git hooks), pnpm catalogs (shared dependency versions).

- [ ] **Step 14: Fix typo**

"Per-locale localstorage" → fix if it's a typo (likely means "Per-locale translations" or similar).

- [ ] **Step 15: Verify type-check**

Run: `pnpm --filter ouitransfer-docs type-check`
Expected: exit 0

- [ ] **Step 16: Commit**

```bash
git add apps/docs/content/docs/v3-beta/architecture.mdx apps/docs/content/docs/v3-beta/github-architecture.mdx
git commit -m "docs: rewrite architecture pages for 3-container S3-first model (9.1, 9.5)"
```

---

## Task 2: Operational Docs (9.2, 9.3, 9.4)

**Audit items:** 9.2 (password-reset), 9.3 (api.mdx), 9.4 (reverse-proxy)

**Files:**
- Modify: `apps/docs/content/docs/v3-beta/password-reset-without-smtp.mdx` (180 lines)
- Modify: `apps/docs/content/docs/v3-beta/api.mdx` (236 lines)
- Modify: `apps/docs/content/docs/v3-beta/reverse-proxy-configuration.mdx` (198 lines)

**Context:** All three files reference the old single-container `OUITRANSFER` name, wrong ports/paths, and monolith Docker examples. Container names must be `ouitransfer-server`, health endpoint is `http://localhost:3333/health`.

### password-reset-without-smtp.mdx (9.2)

- [ ] **Step 1: Read current file**

Read `apps/docs/content/docs/v3-beta/password-reset-without-smtp.mdx` in full.

- [ ] **Step 2: Fix container references**

- `ouitransfer-app` → `ouitransfer-server` for container name
- `docker exec -it <container_name_or_id> /bin/sh` — update example to use `ouitransfer-server`
- `docker logs OUITRANSFER` → `docker compose logs server`
- Add a note at the top: "These commands target the **server** container (`ouitransfer-server`) — the API container in the 3-container architecture."
- Keep `/app/ouitransfer-app` path — it IS correct per the Dockerfile WORKDIR

- [ ] **Step 3: Fix package manager references**

- `npm install` → `pnpm install` (if present)
- `npx prisma generate` → `pnpm exec prisma generate`

### api.mdx (9.3)

- [ ] **Step 4: Read current file**

Read `apps/docs/content/docs/v3-beta/api.mdx` in full.

- [ ] **Step 5: Replace Docker examples**

Replace the monolith Docker Compose example (single `OUITRANSFER` service) with the 3-container architecture. Use the same format as `quick-start.mdx` but simplified (just the relevant services/ports).

Replace the `docker run` example with the 3-container CLI approach from `quick-start.mdx` (network + 3 containers) or a note pointing to the Quick Start guide.

- [ ] **Step 6: Fix image and volume references**

- `burger-cie/ouitransfer:latest` → `ouitransfer/server:latest`
- `OUITRANSFER_data:/app/server` → `server_data:/app/server`
- Port mapping: API is on port 3333 (server service), not 5487

- [ ] **Step 7: Fix capabilities section**

Remove "Manage filesystem and S3 storage options" → replace with "S3-compatible object storage management".

- [ ] **Step 8: Add CSRF note**

Add a note that mutating API endpoints require a CSRF token (double-submit cookie pattern, implemented in Phase 5).

### reverse-proxy-configuration.mdx (9.4)

- [ ] **Step 9: Read current file**

Read `apps/docs/content/docs/v3-beta/reverse-proxy-configuration.mdx` in full.

- [ ] **Step 10: Fix container references**

- `docker exec -it OUITRANSFER env` → `docker exec -it ouitransfer-server env`
- `docker logs OUITRANSFER` → `docker compose logs server`
- Service name `OUITRANSFER:` → `server:`

- [ ] **Step 11: Fix health endpoint**

- `http://localhost:5487/api/health` → `http://localhost:3333/health`
- Note that the health endpoint is on the **server** service, not the web service

- [ ] **Step 12: Add STORAGE_URL and proxy guidance**

Add a section or callout explaining:
- When behind a reverse proxy, `STORAGE_URL` must point to the externally-reachable storage address
- Browsers need to reach port 9000 (or its proxied equivalent) for presigned URL uploads
- CSP headers: the web container adds `connect-src` restrictions; use `CSP_CONNECT_SOURCES` env var to allow the storage origin

- [ ] **Step 13: Verify type-check**

Run: `pnpm --filter ouitransfer-docs type-check`
Expected: exit 0

- [ ] **Step 14: Commit**

```bash
git add apps/docs/content/docs/v3-beta/password-reset-without-smtp.mdx apps/docs/content/docs/v3-beta/api.mdx apps/docs/content/docs/v3-beta/reverse-proxy-configuration.mdx
git commit -m "docs: fix container names, Docker examples, health endpoints (9.2, 9.3, 9.4)"
```

---

## Task 3: Contributor & Setup Docs (9.6, 9.7)

**Audit items:** 9.6 (contribute.mdx), 9.7 (manual-installation.mdx)

**Files:**
- Modify: `apps/docs/content/docs/v3-beta/contribute.mdx` (442 lines)
- Modify: `apps/docs/content/docs/v3-beta/manual-installation.mdx` (300 lines)

**Context:** `contribute.mdx` is 442 lines of generic GitHub tutorial — no project-specific dev tooling. Phase 8 created `CONTRIBUTING.md` with all the dev setup details. This page should be significantly shortened and link to `CONTRIBUTING.md`. `manual-installation.mdx` is missing mandatory secrets and has wrong commands.

### contribute.mdx (9.6)

- [ ] **Step 1: Read current file**

Read `apps/docs/content/docs/v3-beta/contribute.mdx` in full.

- [ ] **Step 2: Streamline and modernize**

The file is 442 lines of generic Git/GitHub tutorial. It should be shortened significantly (~100-150 lines) and updated to include:
- Link to `CONTRIBUTING.md` in the repository for detailed dev setup
- Prerequisites: Node 24, pnpm 10.6.0, Docker (for RustFS), `just` task runner
- Quick setup: `pnpm install` → `just dev`
- Linting: Biome (not ESLint/Prettier), enforced by Lefthook pre-commit hook
- Testing: `just test` (Vitest), `pnpm e2e` (Playwright)
- Commit format: Conventional Commits, enforced by commitlint via Lefthook
- Remove all the detailed Git tutorial content (forking, what is a PR, etc.) — this is covered by standard GitHub docs
- Keep the project-specific contribution guidelines (branch naming, PR process, code review)

### manual-installation.mdx (9.7)

- [ ] **Step 3: Read current file**

Read `apps/docs/content/docs/v3-beta/manual-installation.mdx` in full.

- [ ] **Step 4: Add mandatory security secrets**

Add `JWT_SECRET`, `CSRF_SECRET`, `COOKIE_SECRET` to the environment variable setup section with:
- Explanation that all three are required (min 32 chars each, must be distinct)
- Generation command: `openssl rand -hex 32`
- This should be prominent — a user following this guide will get a Zod startup error without these

- [ ] **Step 5: Add STORAGE_URL**

Add `STORAGE_URL` to the env var section. Required when using internal RustFS. Example: `STORAGE_URL=http://localhost:9000`.

- [ ] **Step 6: Fix S3 configuration section**

- For local RustFS option: do NOT show `ENABLE_S3=true` (internal RustFS doesn't use this). Show the S3_* vars directly.
- For external S3: show `ENABLE_S3=true` with the external S3 vars.
- Add `S3_FORCE_PATH_STYLE=true` for RustFS option.

- [ ] **Step 7: Fix install commands**

- `pnpm install` should run from the repo root (not from `apps/server`)
- `pnpm dlx prisma generate` → `pnpm exec prisma generate` (or `just db-generate`)
- `pnpm dlx prisma migrate deploy` → `pnpm exec prisma migrate deploy` (or `just db-migrate-dev`)
- `pnpm db:seed` → verify script exists, or use `just db-seed`
- `pnpm serve` → `pnpm start` for Next.js production

- [ ] **Step 8: Fix port for production web**

Frontend in production runs on port 5487 (set by Dockerfile), not 3000. Update the access URLs accordingly.

- [ ] **Step 9: Add prerequisites**

Add Node 24 and pnpm 10.6.0 as requirements. Mention `packages/shared` needs to be built.

- [ ] **Step 10: Verify type-check**

Run: `pnpm --filter ouitransfer-docs type-check`
Expected: exit 0

- [ ] **Step 11: Commit**

```bash
git add apps/docs/content/docs/v3-beta/contribute.mdx apps/docs/content/docs/v3-beta/manual-installation.mdx
git commit -m "docs: modernize contributor guide and fix manual installation (9.6, 9.7)"
```

---

## Post-Implementation Checks

After all 3 tasks are complete:

- [ ] All 7 MDX files updated
- [ ] `pnpm --filter ouitransfer-docs type-check` passes
- [ ] No references to `OUITRANSFER` (old container name) remain in any docs
- [ ] No references to "filesystem storage" as default remain
- [ ] All Docker examples use 3-container architecture
- [ ] Health endpoint references use `http://localhost:3333/health`
- [ ] All required secrets (JWT_SECRET, CSRF_SECRET, COOKIE_SECRET) mentioned in relevant pages
- [ ] `STORAGE_URL` mentioned wherever storage configuration is discussed
