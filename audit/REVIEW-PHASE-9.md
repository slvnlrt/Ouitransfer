# Phase 9 — Documentation Site Overhaul: Review Report

## Overview

Phase 9 updated 7 documentation pages to align with the 3-container (RustFS + Fastify + Next.js) architecture. The changes are thorough and largely accurate: old MinIO/Garage/filesystem references are eliminated, container names and ports are correct, and security configuration (3 mandatory secrets) is consistently documented. A few issues remain, ranging from an incomplete docker-run example that would break a user's setup to minor inconsistencies in Swagger/Scalar naming.

## Verification

- **Type-check**: `pnpm --filter ouitransfer-docs type-check` — **PASS** (clean)
- **Old reference scan**:
  - `OUITRANSFER` as old container name: **CLEAN** — all instances are the stylized product name `OUITRANSFER.` (with period), which is intentional branding
  - `filesystem storage`: **CLEAN** in all 7 files (3 references remain in `s3-providers.mdx`, which was not in scope)
  - `burger-cie/ouitransfer:` as Docker image: **CLEAN** — no such references found
  - `/api/health`: **CLEAN** — no incorrect health endpoint paths
  - `MinIO`/`Garage`/`supervisord`: **CLEAN** — none found
  - `ENCRYPTION_KEY`/`DISABLE_FILESYSTEM`: **CLEAN** — none found
  - `pnpm dlx`: **CLEAN** — not used (correct `pnpm exec` is used)

## Findings

### Critical

**C-1: `api.mdx` docker-run example is missing required S3 env vars**
- **File**: `apps/docs/content/docs/v3-beta/api.mdx`, lines 33–44
- **Issue**: The `docker run` example for the server container is missing 6 required env vars: `S3_PORT`, `S3_USE_SSL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `S3_FORCE_PATH_STYLE`. Without these, the server cannot connect to storage and will fail at startup.
- **Comparison**: The equivalent `docker run` command in `quick-start.mdx` (lines 359–377) includes all of them.
- **Impact**: A user following only the API docs to set up API access will get a non-functional server.
- **Fix**: Add the missing env vars to match the quick-start example, or explicitly state "this is a partial example — see Quick Start for the complete command" with a link.

### Important

**I-1: `manual-installation.mdx` inaccurately describes Swagger/Scalar doc availability**
- **File**: `apps/docs/content/docs/v3-beta/manual-installation.mdx`, line 202
- **Current text**: "The Swagger UI at `/docs` is only available in development mode (`NODE_ENV=development`). It is disabled in production for security reasons."
- **Issues**:
  1. `/docs` is the **Scalar** UI, not "Swagger UI" (Swagger is at `/swagger`). The `api.mdx` page correctly distinguishes them.
  2. The actual gating logic is `isDevMode || env.ENABLE_API_DOCS === "true"` (see `apps/server/src/app.ts:106`), so docs CAN be enabled in production via `ENABLE_API_DOCS=true`. The statement is incomplete and misleading.
- **Fix**: Correct to: "The API documentation at `/docs` (Scalar) and `/swagger` (Swagger UI) is available in development mode by default. In production (`NODE_ENV=production`), set `ENABLE_API_DOCS=true` to enable it."

**I-2: `password-reset-without-smtp.mdx` troubleshooting has incorrect DB path**
- **File**: `apps/docs/content/docs/v3-beta/password-reset-without-smtp.mdx`, line 135
- **Current text**: "Confirm that the `prisma/ouitransfer.db` file exists and has the correct permissions."
- **Issue**: In the Docker container, the database is at the absolute path `/app/server/prisma/ouitransfer.db` (on the data volume), not at the relative path `prisma/ouitransfer.db` from the working directory `/app/ouitransfer-app`. While `prisma/` exists at `/app/ouitransfer-app/prisma/` (contains schema), the actual DB file is on the volume mount.
- **Fix**: Change to "Confirm that the `/app/server/prisma/ouitransfer.db` file exists and has the correct permissions."

**I-3: `manual-installation.mdx` broken cross-link to `/docs/v3-beta/manage-users`**
- **File**: `apps/docs/content/docs/v3-beta/manual-installation.mdx`, line 268
- **Current text**: `[Users Management](/docs/v3-beta/manage-users)`
- **Issue**: No `manage-users.mdx` file exists in the docs. The link leads to a 404.
- **Fix**: Either create the page, or remove/replace this link. If there's no dedicated user management page, link to a relevant section of another page or remove the bullet.

### Minor

**M-1: `architecture.mdx` title uses `OUITRANSFER.` while other updated pages use `Ouitransfer`**
- **File**: `apps/docs/content/docs/v3-beta/architecture.mdx`, line 2
- **Current**: `title: Architecture of OUITRANSFER.`
- **Inconsistency**: `contribute.mdx` uses `title: How to Contribute` (referring to "Ouitransfer" in body text), `manual-installation.mdx` uses `title: Manual Installation` (referring to "Ouitransfer" in body text). The `architecture.mdx` title includes the stylized name while others don't. This is a style preference, not a correctness issue.
- **Suggestion**: For consistency, consider `title: Architecture` (matching the pattern of other pages).

**M-2: `password-reset-without-smtp.mdx` has stale error message reference**
- **File**: `apps/docs/content/docs/v3-beta/password-reset-without-smtp.mdx`, line 138
- **Current**: `Error: "Script must be run from application directory"` → fix suggestion is `cd /app/ouitransfer-app`
- **Issue**: The actual `reset-password.sh` script (line 11-13) prints "This script must be run from the server directory (/app/server)" — not "application directory". The error message text doesn't match, and the script's own error message says `/app/server` when the actual WORKDIR is `/app/ouitransfer-app`. This is a pre-existing bug in the script itself, but the docs should match what users will actually see.
- **Suggestion**: Update the error message text to match the script's actual output, and note that the actual directory is `/app/ouitransfer-app` (the script error message is misleading).

**M-3: `api.mdx` authentication example shows inconsistent endpoint format**
- **File**: `apps/docs/content/docs/v3-beta/api.mdx`, lines 147-154
- **Current**: Shows `POST /auth/login` and `GET /api/files`
- **Issue**: The server routes don't have an `/api` prefix — all routes are at the root (e.g., `/auth/login`, `/files`). The `/api/files` path is only used via the Next.js proxy layer. Since this is documenting direct API access on port 3333, it should be `GET /files`.
- **Impact**: Users making direct API calls to port 3333 would get 404s using `/api/files`.

**M-4: `reverse-proxy-configuration.mdx` references `OUITRANSFER_UID`/`OUITRANSFER_GID` without container context**
- **File**: `apps/docs/content/docs/v3-beta/reverse-proxy-configuration.mdx`, lines 128-129
- **Issue**: The snippet shows `OUITRANSFER_UID=1000` and `OUITRANSFER_GID=1000` without specifying which container these belong to (they go on the `server` service). In a 3-container setup, this matters. Minor since the UID/GID config page is linked right below.

**M-5: `contribute.mdx` refers to `pnpm e2e` but root `package.json` script is `e2e` (runs `playwright test`)**
- **File**: `apps/docs/content/docs/v3-beta/contribute.mdx`, line 65
- **Current**: `pnpm e2e`
- **Verification**: Root package.json has `"e2e": "playwright test"` ✓ — this is correct. No issue.

## Verified OK

The following were checked and found correct:

1. **Container names**: `ouitransfer-storage`, `ouitransfer-server`, `ouitransfer-web` — match `docker-compose.yaml` ✓
2. **Docker images**: `rustfs/rustfs:latest`, `ouitransfer/server:latest`, `ouitransfer/web:latest` — match compose ✓
3. **Ports**: Storage 9000, Server 3333, Web 5487 — match compose and Dockerfile ✓
4. **Health endpoint**: `http://localhost:3333/health` — correct in all references ✓
5. **Health response format**: `{ status, timestamp, uptime, checks: { database, storage } }` with 200/503 — accurate ✓
6. **3 mandatory secrets**: JWT_SECRET, CSRF_SECRET, COOKIE_SECRET documented consistently across architecture.mdx, api.mdx, manual-installation.mdx ✓
7. **STORAGE_URL**: Correctly explained in architecture.mdx, reverse-proxy-configuration.mdx, manual-installation.mdx, api.mdx ✓
8. **ENABLE_S3**: Correctly documented as the external S3 toggle ✓
9. **Startup ordering**: storage → server → web via healthcheck dependencies — matches compose ✓
10. **Package manager**: `pnpm` used consistently (not npm/yarn/bun) for all commands ✓
11. **pnpm exec**: Used correctly (not `pnpm dlx`) for local dependencies ✓
12. **Filter names**: `ouitransfer-api` and `ouitransfer-web` match package.json `name` fields ✓
13. **Node.js version**: 24 — matches CLAUDE.md and project config ✓
14. **pnpm version**: 10.6.0 — matches root package.json ✓
15. **Technology stack descriptions**: Fastify 5, Next.js 15, React 19, Tailwind CSS 4, Prisma, Zod — all accurate ✓
16. **Monorepo tooling**: Biome, Vitest, Playwright, Lefthook, commitlint, Turborepo, pnpm catalogs, `just` — all accurately listed ✓
17. **S3_ENDPOINT values**: `storage` for compose, `ouitransfer-storage` for docker-run — correct for respective networking models ✓
18. **CSRF protection**: Documented in api.mdx with double-submit cookie pattern ✓
19. **MDX frontmatter**: All 7 files have valid frontmatter with title and icon ✓
20. **Fumadocs imports**: `architecture.mdx` imports ZoomableImage, `github-architecture.mdx` imports File/Files/Folder from fumadocs-ui — both valid ✓
21. **Cross-links in `architecture.mdx`**: `/docs/v3-beta/s3-providers` → file exists ✓
22. **Cross-links in `reverse-proxy-configuration.mdx`**: `/docs/v3-beta/uid-gid-configuration` → file exists ✓
23. **Cross-links in `manual-installation.mdx`**: `/docs/v3-beta/quick-start` → exists ✓, `/docs/v3-beta/architecture` → exists ✓
24. **GitHub links**: `https://github.com/burger-cie/ouitransfer` — correct org/repo URL ✓
25. **No old storage model references**: No filesystem storage, MinIO, Garage, supervisord in any of the 7 files ✓
26. **`contribute.mdx` dev ports**: API 3333, Web 3000, Docs 3001 — match dev scripts ✓
27. **RustFS documentation link**: `https://rustfs.com/docs/` in architecture.mdx ✓
28. **Web prod port 5487**: Matches Dockerfile `ENV PORT=5487` and compose ports mapping ✓

## Pre-Existing Issues (Not in Phase 9 Scope)

For awareness, these issues exist in files NOT modified by Phase 9:

- `s3-providers.mdx` still references "filesystem storage" in 3 places (lines 10, 220, 370)
- `quick-start.mdx` links to `/docs/v3-beta/s3-configuration` (line 457) and `/docs/v3-beta/download-memory-management` (line 456) — neither file exists
- `quick-start.mdx` links to `/docs/v3-beta/manage-users` (wait — no, that link is only in `manual-installation.mdx` which IS a Phase 9 file)

## Summary

| Severity | Count |
|----------|-------|
| Critical | 1 |
| Important | 3 |
| Minor | 4 |

The Phase 9 documentation overhaul successfully modernizes the docs for the 3-container architecture. The critical finding (C-1) would cause user failure if they follow the API docs' docker-run example without cross-referencing quick-start. The important findings (I-1, I-2, I-3) are accuracy issues that could confuse users. The minor findings are polish-level consistency issues.
