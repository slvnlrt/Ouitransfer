# Documentation Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring all Fumadocs documentation pages (`apps/docs/content/docs/v1-beta/`) fully up to date with the current codebase, create missing pages for implemented features, and perform a complete audit of the API reference.

**Architecture:** Audit-and-fix approach: each task reads both the existing doc page AND the authoritative code/spec sources, identifies gaps/errors, and fixes them in one pass. Tasks are sequential (each builds on the previous). No tests to write for documentation — verification is a docs build check.

**Tech Stack:** Fumadocs MDX pages, Fastify routes (ESM TypeScript), Prisma schema, env vars in Docker Compose / `.env.docker.example`.

**Spec:** `features/specs/doc-update-2026-05-24.md`

---

## File Map

### Files to CREATE
- `apps/docs/content/docs/v1-beta/activity-log.mdx` — Audit Trail / Activity Log doc page (8.1)

### Files to MODIFY
- `apps/docs/content/docs/v1-beta/meta.json` — Add `activity-log` to sidebar
- `apps/docs/content/docs/v1-beta/api.mdx` — Complete endpoint audit, add all missing routes
- `apps/docs/content/docs/v1-beta/index.mdx` — Add Activity Log mention
- `apps/docs/content/docs/v1-beta/architecture.mdx` — Add Audit Trail to feature list
- `apps/docs/content/docs/v1-beta/quotas.mdx` — Verify accuracy vs. spec + code
- `apps/docs/content/docs/v1-beta/groups.mdx` — Verify accuracy vs. spec + code
- `apps/docs/content/docs/v1-beta/ldap-configuration.mdx` — Verify accuracy vs. spec + code
- `apps/docs/content/docs/v1-beta/quick-share.mdx` — Verify accuracy vs. spec + UI code
- `apps/docs/content/docs/v1-beta/oidc-authentication/index.mdx` + sub-pages — Verify after auth refactor
- `apps/docs/content/docs/v1-beta/configuring-smtp.mdx` — Verify vs. server SMTP config
- `apps/docs/content/docs/v1-beta/s3-providers.mdx` — Verify env vars vs. server code
- `apps/docs/content/docs/v1-beta/uid-gid-configuration.mdx` — Spot-check
- `apps/docs/content/docs/v1-beta/reverse-proxy-configuration.mdx` — Verify TRUST_PROXY env var added
- `apps/docs/content/docs/v1-beta/password-reset-without-smtp.mdx` — Spot-check
- `apps/docs/content/docs/v1-beta/quick-start.mdx` — Verify env vars
- `apps/docs/content/docs/v1-beta/manual-installation.mdx` — Verify install steps
- `apps/docs/content/docs/v1-beta/github-architecture.mdx` — Verify monorepo structure
- `apps/docs/content/docs/v1-beta/available-languages.mdx` — Verify language count (23)
- `apps/docs/content/docs/v1-beta/translation-management.mdx` — Spot-check

### Files NOT touched
- `apps/docs/content/docs/v1-beta/screenshots.mdx` — Deferred
- `apps/docs/content/docs/v1-beta/contribute.mdx` — Static
- `apps/docs/content/docs/v1-beta/open-an-issue.mdx` — Static
- `apps/docs/content/docs/v1-beta/gh-star.mdx` — Static
- `apps/docs/content/docs/v1-beta/gh-sponsor.mdx` — Static

---

## Task 1: Create activity-log.mdx + update meta.json

**Goal:** Create the missing documentation page for the 8.1 Audit Trail / Activity Log feature and register it in the sidebar.

**Files:**
- Create: `apps/docs/content/docs/v1-beta/activity-log.mdx`
- Modify: `apps/docs/content/docs/v1-beta/meta.json`

**Authoritative sources to read:**
- `features/specs/8.1-auditing.md` — Full spec with all actions, filter params, export format, retention setting
- `apps/server/src/modules/audit/routes.ts` — Actual API routes
- `apps/server/src/modules/audit/service.ts` — Service for filter params and response shape
- `apps/server/src/modules/audit/dto.ts` — Response schemas (if exists)
- `apps/web/src/app/(dashboard)/admin/audit/` — Frontend page structure

**Steps:**

- [ ] **Step 1: Read authoritative sources**

  Read all source files listed above. Extract:
  - The exact API routes (method, path, query params, response shape)
  - The full list of audit action categories (Auth, Share, File, Folder, Reverse Share, Group, LDAP, Admin, System) with key actions per category
  - The `auditRetentionDays` config setting (default 365, min 7, 0=forever)
  - The filter params: `action`, `userId`, `targetType`, `targetId`, `dateFrom`, `dateTo`, `search`
  - The export params: `format` (csv|json), requires `dateFrom`+`dateTo`, 100k row ceiling
  - Target types: user, share, reverse_share, file, folder, group, ldap_config, ldap_sync_log, setting, auth_provider, background_image, invite_token, trusted_device, logo

- [ ] **Step 2: Create `activity-log.mdx`**

  Create the page following the style of existing feature pages (see `ldap-configuration.mdx` as a style reference — it has good section structure, callouts, API reference tables).

  The page must cover:
  1. **Overview** — What the Activity Log is, who can see it (admin only), where to find it (Admin → Activity Log)
  2. **Reading the log** — Columns in the table (date, user, action badge, target, IP address, details/metadata)
  3. **Filtering** — All filter options: action type, user, target type, date range, search (IP + action text)
  4. **Exporting** — CSV and JSON export, date range required, 100,000 row ceiling, streaming download
  5. **Retention** — `auditRetentionDays` admin setting (default 365 days, 0=keep forever, minimum 7). Location: Admin → Settings → Security section
  6. **What gets logged** — Table of action categories with examples (not exhaustive, but representative)
  7. **Privacy and security notes** — Passwords/tokens/secrets never stored in metadata, GDPR note on userId retention
  8. **API reference** — `GET /admin/audit-logs` and `GET /admin/audit-logs/export` with all params

  Front matter:
  ```mdx
  ---
  title: Activity Log
  icon: ScrollText
  ---
  ```

  Use these imports:
  ```mdx
  import { Callout } from "fumadocs-ui/components/callout";
  import { Tab, Tabs } from "fumadocs-ui/components/tabs";
  ```

- [ ] **Step 3: Update `meta.json`**

  Add `"activity-log"` to the `pages` array in `meta.json`. Place it after `"quick-share"` in the `---Usage---` section.

  Current `pages` array:
  ```json
  "pages": [
    "---Introduction---",
    "index",
    "quick-start",
    "manual-installation",
    "screenshots",
    "s3-providers",
    "---Usage---",
    "quick-share",
    "---Configuration---",
    ...
  ]
  ```

  Updated `---Usage---` section:
  ```json
  "---Usage---",
  "quick-share",
  "activity-log",
  ```

- [ ] **Step 4: Verify docs build**

  ```bash
  pnpm --filter @ouitransfer/docs build
  ```

  Expected: build completes with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/docs/content/docs/v1-beta/activity-log.mdx apps/docs/content/docs/v1-beta/meta.json
  git commit -m "docs: add Activity Log page and update sidebar (8.1)"
  ```

---

## Task 2: Complete API page audit and rewrite

**Goal:** Audit `api.mdx` against all actual server routes and produce an accurate, complete API reference.

**Files:**
- Modify: `apps/docs/content/docs/v1-beta/api.mdx`

**Authoritative sources to read (ALL of these):**
- `apps/server/src/modules/auth/routes.ts`
- `apps/server/src/modules/auth-providers/routes.ts`
- `apps/server/src/modules/two-factor/routes.ts`
- `apps/server/src/modules/user/routes.ts`
- `apps/server/src/modules/quota/routes.ts`
- `apps/server/src/modules/file/routes.ts`
- `apps/server/src/modules/folder/routes.ts`
- `apps/server/src/modules/share/routes.ts`
- `apps/server/src/modules/reverse-share/routes.ts`
- `apps/server/src/modules/group/routes.ts`
- `apps/server/src/modules/ldap/routes.ts`
- `apps/server/src/modules/audit/routes.ts`
- `apps/server/src/modules/invite/routes.ts`
- `apps/server/src/modules/app/routes.ts`
- `apps/server/src/modules/background-image/routes.ts`
- `apps/server/src/modules/storage/routes.ts`
- `apps/server/src/modules/s3-storage/routes.ts`
- `apps/server/src/modules/health/routes.ts`
- `apps/server/src/modules/admin/routes.ts`

**Steps:**

- [ ] **Step 1: Read the current `api.mdx`**

  Read `apps/docs/content/docs/v1-beta/api.mdx` to understand what's currently documented.

- [ ] **Step 2: Read all routes files and build the complete endpoint inventory**

  For each routes file, extract: HTTP method, path, authentication requirement (public / authenticated user / admin), brief description. Group by module.

- [ ] **Step 3: Compare and identify gaps**

  Find all endpoints that exist in code but are missing or incorrectly described in `api.mdx`.

- [ ] **Step 4: Rewrite `api.mdx`**

  The page should be organized by module/category, not a flat list. Suggested structure:
  
  1. **Authentication** — login, logout, register, forgot-password, reset-password, refresh, CSRF token
  2. **Two-Factor Authentication** — setup, enable, disable, verify, backup codes, trusted devices
  3. **SSO / Auth Providers** — list providers, create, update, delete, OAuth callback
  4. **Users** — list, get, create, update, delete, activate/deactivate, role change
  5. **Quotas** — get user quota, update quota override
  6. **Files** — upload (presigned URL), register, download, delete, move, rename
  7. **Folders** — create, list, update, delete, move
  8. **Shares** — create, list, get, update, delete, alias, password, recipients, notify, items
  9. **Reverse Shares** — create, list, get, update, delete, activate/deactivate, password, upload, files
  10. **Groups** — create, list, get, update, delete, members
  11. **LDAP** — config, test, sync, logs, status
  12. **Audit Logs** — list, export
  13. **Invites** — create token, register with invite
  14. **App Settings** — get config, update settings, logo, background image, SMTP test
  15. **Storage** — stats
  16. **Health** — health check

  For each endpoint, include: method + path in code block, authentication level, brief description, key params if notable.

  Keep the existing introduction (how to expose port 3333, how to enable ENABLE_API_DOCS, authentication) and add a note about the Scalar/Swagger UI available at `/docs` when `ENABLE_API_DOCS=true`.

- [ ] **Step 5: Verify docs build**

  ```bash
  pnpm --filter @ouitransfer/docs build
  ```

  Expected: build completes with no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/docs/content/docs/v1-beta/api.mdx
  git commit -m "docs: complete API endpoint audit and rewrite api.mdx"
  ```

---

## Task 3: Verify and update feature pages (quotas, groups, ldap, quick-share)

**Goal:** Verify `quotas.mdx`, `groups.mdx`, `ldap-configuration.mdx`, and `quick-share.mdx` against the actual specs and code. Fix anything that's wrong or missing.

**Files:**
- Modify (as needed): `apps/docs/content/docs/v1-beta/quotas.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/groups.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/ldap-configuration.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/quick-share.mdx`

**Authoritative sources:**
- `features/specs/5.1-quotas.md` + `apps/server/src/modules/quota/routes.ts` + `apps/server/src/modules/quota/service.ts`
- `features/specs/5.4-groups.md` + `apps/server/src/modules/group/routes.ts`
- `features/specs/5.3-ldap.md` + `apps/server/src/modules/ldap/routes.ts` + `apps/server/src/modules/ldap/sync.scheduler.ts`
- `features/specs/9.1-quickshare.md` + `apps/web/src/components/quick-share/` (or wherever the component lives)

**Steps:**

- [ ] **Step 1: Audit `quotas.mdx`**

  Read `quotas.mdx` + spec + `quota/routes.ts` + `quota/service.ts`. Check:
  - Are all API endpoints documented? (GET /users/:id/quota, PATCH /users/:id/quota)
  - Is the response shape accurate?
  - Is the `sources` field documented correctly?
  - Is the warning level table accurate?
  - Fix any discrepancies.

- [ ] **Step 2: Audit `groups.mdx`**

  Read `groups.mdx` + spec + `group/routes.ts`. Check:
  - Are all API endpoints correct? (GET, POST, PUT, DELETE /groups, /groups/:id/members, etc.)
  - Is the `ldapDn` warning still accurate? (It is — `ldapDn` is confirmed not exposed in UI/API)
  - Is `storageUsed` returned in the group list response?
  - Fix any discrepancies.

- [ ] **Step 3: Audit `ldap-configuration.mdx`**

  Read `ldap-configuration.mdx` + spec + `ldap/routes.ts`. Check:
  - Are all API endpoints documented? (GET /admin/ldap/config, PUT, POST /test, POST /sync, GET /sync/logs, GET /sync/logs/:id, GET /status)
  - Are the sync log status types correct? (success, partial, error)
  - Is the scheduler description accurate? (chained setTimeout pattern, not setInterval)
  - Is the `ldapDn` group mapping section accurate?
  - Fix any discrepancies.

- [ ] **Step 4: Audit `quick-share.mdx`**

  Read `quick-share.mdx` + spec + the QuickShare component in the web app. Check:
  - Does the 3-step flow match the actual implementation?
  - Is the "Recipients" SMTP condition documented correctly?
  - Is there anything about `maxViews` that references old `ShareSecurity.maxViews`? (Should now be `Share.maxViews`)
  - Fix any discrepancies.

- [ ] **Step 5: Verify docs build**

  ```bash
  pnpm --filter @ouitransfer/docs build
  ```

  Expected: build completes with no errors.

- [ ] **Step 6: Commit**

  ```bash
  git add apps/docs/content/docs/v1-beta/quotas.mdx apps/docs/content/docs/v1-beta/groups.mdx apps/docs/content/docs/v1-beta/ldap-configuration.mdx apps/docs/content/docs/v1-beta/quick-share.mdx
  git commit -m "docs: verify and update feature pages (quotas, groups, ldap, quickshare)"
  ```

---

## Task 4: Verify and update Auth/OIDC pages

**Goal:** Verify all OIDC authentication provider pages against the current auth-providers implementation after the auth system refactor.

**Files:**
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/index.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/auth0.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/authentik.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/discord.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/frontegg.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/github.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/google.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/kinde-auth.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/other.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/pocket-id.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/oidc-authentication/zitadel.mdx`

**Authoritative sources:**
- `apps/server/src/modules/auth-providers/routes.ts`
- `apps/server/src/modules/auth-providers/service.ts` (or similar)
- `apps/server/src/modules/auth-providers/dto.ts` (provider schema)
- `apps/web/src/app/(dashboard)/admin/auth-providers/` — Admin UI for SSO configuration

**Steps:**

- [ ] **Step 1: Read all OIDC doc pages**

  Read all 11 files (index + 10 provider pages) to understand what's currently documented: the configuration fields, the callback URL format, the provider-specific setup steps.

- [ ] **Step 2: Read the auth-providers implementation**

  Read `auth-providers/routes.ts`, `auth-providers/service.ts`, and the admin UI page. Extract:
  - What fields are required to configure a provider (clientId, clientSecret, issuerUrl, scope, etc.)
  - What's the callback URL format? (e.g., `https://your-domain.com/api/auth/callback/:providerName`)
  - What provider types are supported? (OIDC, OAuth2, specific named providers?)
  - Any changes from what's documented?

- [ ] **Step 3: Identify and fix discrepancies**

  For each provider page, check:
  - Are the required configuration fields accurate?
  - Is the callback URL format correct?
  - Are the provider-specific scopes/settings accurate?
  - Any references to old architecture or env vars?

  Fix any inaccuracies. If a page is mostly accurate, leave it as-is.

- [ ] **Step 4: Verify docs build**

  ```bash
  pnpm --filter @ouitransfer/docs build
  ```

  Expected: build completes with no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add apps/docs/content/docs/v1-beta/oidc-authentication/
  git commit -m "docs: verify and update OIDC authentication provider pages"
  ```

---

## Task 5: Verify and update configuration pages

**Goal:** Verify configuration pages against actual server env vars and code. Add `TRUST_PROXY` to reverse-proxy page if missing.

**Files:**
- Modify (as needed): `apps/docs/content/docs/v1-beta/configuring-smtp.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/s3-providers.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/uid-gid-configuration.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/reverse-proxy-configuration.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/password-reset-without-smtp.mdx`

**Authoritative sources:**
- `apps/server/src/server.ts` — where env vars are read/validated
- `infra/` directory — Docker Compose files
- `.env.docker.example` (if it exists in the repo root or infra/)
- `apps/server/src/modules/app/routes.ts` — SMTP configuration routes

**Steps:**

- [ ] **Step 1: Read env var sources**

  Read `apps/server/src/server.ts` (or wherever env vars are declared/validated) to get the definitive list of all environment variables the server accepts.

  Also read `apps/docs/content/docs/v1-beta/quick-start.mdx` section on "Additional Optional Variables" as the canonical list — compare to what's in code.

- [ ] **Step 2: Audit `reverse-proxy-configuration.mdx`**

  Read the page. Verify:
  - Is `TRUST_PROXY` env var mentioned? (It was added as a new env var — default `loopback`, comma-separated IPs, or `true` for all proxies)
  - Are `SECURE_SITE=true` instructions accurate?
  - Is the Caddy/nginx/Traefik config still accurate?
  - Fix if needed.

- [ ] **Step 3: Audit `configuring-smtp.mdx`**

  Read the page. Verify against `app/routes.ts` SMTP config endpoint:
  - Are all SMTP fields documented? (host, port, user, password, from email, encryption, etc.)
  - Is the test email feature mentioned?
  - Fix if needed.

- [ ] **Step 4: Audit `s3-providers.mdx`**

  Read the page. Verify:
  - Is `ENABLE_S3=true` the correct env var?
  - Are the S3 env vars correct? (`S3_ENDPOINT`, `S3_PORT`, `S3_USE_SSL`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION`, `S3_FORCE_PATH_STYLE`)
  - Are provider-specific examples (AWS S3, Cloudflare R2, Backblaze B2) still accurate?
  - Fix if needed.

- [ ] **Step 5: Spot-check `uid-gid-configuration.mdx` and `password-reset-without-smtp.mdx`**

  Quick read of each page. Verify:
  - `uid-gid-configuration.mdx`: Does `OUITRANSFER_UID` / `OUITRANSFER_GID` still work as documented?
  - `password-reset-without-smtp.mdx`: Is the admin password reset flow still accurate (admin can set password directly in User Management)?
  - Fix if needed.

- [ ] **Step 6: Verify docs build**

  ```bash
  pnpm --filter @ouitransfer/docs build
  ```

  Expected: build completes with no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/docs/content/docs/v1-beta/configuring-smtp.mdx apps/docs/content/docs/v1-beta/s3-providers.mdx apps/docs/content/docs/v1-beta/uid-gid-configuration.mdx apps/docs/content/docs/v1-beta/reverse-proxy-configuration.mdx apps/docs/content/docs/v1-beta/password-reset-without-smtp.mdx
  git commit -m "docs: verify and update configuration pages"
  ```

---

## Task 6: Verify and update getting started pages

**Goal:** Verify `quick-start.mdx` and `manual-installation.mdx` against actual deployment steps, env vars, and Justfile recipes.

**Files:**
- Modify (as needed): `apps/docs/content/docs/v1-beta/quick-start.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/manual-installation.mdx`

**Authoritative sources:**
- `infra/` — Docker Compose files (actual docker-compose.yml)
- `.env.docker.example` — Canonical env var template
- `Justfile` — Available recipes for development
- `CLAUDE.md` — Current architecture overview (Node 24, pnpm 10.6.0, etc.)
- `pnpm-workspace.yaml` — Workspace config
- `apps/server/package.json` + `apps/web/package.json` — Build commands

**Steps:**

- [ ] **Step 1: Audit `quick-start.mdx`**

  Read `quick-start.mdx`. Then read the actual `infra/docker-compose.yml` (or equivalent) and `.env.docker.example`. Check:
  - Are the docker-compose examples in the page identical to the actual infra files? If infra files have drifted, the doc should reflect the infra.
  - Is the complete env var table accurate? (Named Volumes + Bind Mounts sections, Fixed Configuration table, Additional Optional Variables table)
  - Is `ENABLE_API_DOCS` documented in the optional variables? (it was added in the refactor)
  - Is `TRUST_PROXY` documented in the optional variables?
  - Are the image tags correct? (`ghcr.io/slvnlrt/ouitransfer-server:latest`, `ghcr.io/slvnlrt/ouitransfer-web:latest`)
  - Fix any discrepancies.

- [ ] **Step 2: Audit `manual-installation.mdx`**

  Read `manual-installation.mdx`. Then verify against CLAUDE.md, the Justfile, and actual package.json scripts:
  - Is Node 24 and pnpm 10.6.0 mentioned?
  - Are the install steps correct for the pnpm monorepo? (`pnpm install` at root)
  - Are the correct commands mentioned? Check against `just --list` (or the Justfile) for setup, db-generate, db-migrate-dev, db-seed, dev commands
  - Is the server start command correct? (`pnpm --filter @ouitransfer/server dev` or `just dev`)
  - Is there a broken clone URL? (The page has `git clone https://github.com/slvnlrt/ouitransfer.git` — missing space, should be separate path)
  - Fix any discrepancies.

- [ ] **Step 3: Verify docs build**

  ```bash
  pnpm --filter @ouitransfer/docs build
  ```

  Expected: build completes with no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add apps/docs/content/docs/v1-beta/quick-start.mdx apps/docs/content/docs/v1-beta/manual-installation.mdx
  git commit -m "docs: verify and update getting started pages"
  ```

---

## Task 7: Update architecture, index, and remaining pages

**Goal:** Update `index.mdx` and `architecture.mdx` to reflect all implemented features. Verify `github-architecture.mdx`, `available-languages.mdx`, and `translation-management.mdx`.

**Files:**
- Modify: `apps/docs/content/docs/v1-beta/index.mdx`
- Modify: `apps/docs/content/docs/v1-beta/architecture.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/github-architecture.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/available-languages.mdx`
- Modify (as needed): `apps/docs/content/docs/v1-beta/translation-management.mdx`

**Authoritative sources:**
- `features/README.md` — Full feature status table (what's Done)
- `features/SESSIONS.md` — Session log for feature details
- `apps/web/messages/` — Directory of locale files (count them for language list)
- `packages/shared/`, `packages/config/` — For github-architecture monorepo diagram
- `CLAUDE.md` — Current architecture overview

**Steps:**

- [ ] **Step 1: Update `index.mdx`**

  Read the current `index.mdx`. It has a "Manage users like a pro" section that already mentions Groups and LDAP. Add:
  - A brief mention of **Activity Log** / Audit Trail in the admin management section
  - A mention of **System Status Bar** as a UI feature for quick status overview

  The tone change is out of scope (the informal "OUITRANSFER Rocks?" style is acceptable for now).

- [ ] **Step 2: Update `architecture.mdx`**

  Read the current `architecture.mdx`. The "How it works" section lists 5 components (Frontend, Backend, Database, File Storage, User Management). Add:
  - **Audit Trail** — comprehensive activity logging with configurable retention

  Also check the "Technologies used" section for any inaccuracies vs. the current stack (Fastify 5, React 19, Next.js 15, Tailwind CSS 4, etc.).

- [ ] **Step 3: Verify `github-architecture.mdx`**

  Read the page. Check if the monorepo structure diagram matches the actual repo:
  - `apps/server/`, `apps/web/`, `apps/docs/`
  - `packages/shared/`, `packages/config/`
  - `infra/`
  Fix if the structure is outdated (e.g., missing packages/ directory, wrong directory names).

- [ ] **Step 4: Verify `available-languages.mdx`**

  Count the locale files in `apps/web/messages/` directory. The CLAUDE.md mentions 23 languages. Verify the page matches:
  ```bash
  Get-ChildItem -LiteralPath "apps/web/messages" -Filter "*.json" | Measure-Object
  ```
  Fix the count and list if needed.

- [ ] **Step 5: Spot-check `translation-management.mdx`**

  Read the page. Verify the contribution process for translations still matches reality (are the i18n keys in the same files? same namespace structure?). Fix if outdated.

- [ ] **Step 6: Verify docs build**

  ```bash
  pnpm --filter @ouitransfer/docs build
  ```

  Expected: build completes with no errors.

- [ ] **Step 7: Commit**

  ```bash
  git add apps/docs/content/docs/v1-beta/index.mdx apps/docs/content/docs/v1-beta/architecture.mdx apps/docs/content/docs/v1-beta/github-architecture.mdx apps/docs/content/docs/v1-beta/available-languages.mdx apps/docs/content/docs/v1-beta/translation-management.mdx
  git commit -m "docs: update architecture/index with audit trail, verify remaining pages"
  ```

---

## Execution Notes

- **Sequential only** — never dispatch two tasks simultaneously (each task may touch overlapping files)
- **Docs build verification** — run `pnpm --filter @ouitransfer/docs build` after each task
- **If a page is accurate** — still commit it in the batch (git add even if unchanged, commit message reflects what was checked)
- **Style reference** — `ldap-configuration.mdx` and `quotas.mdx` are the best style examples for feature pages
- **Callout types** — `info` (tips), `warn` (cautions), `error` (critical issues). No `success` type.
- **Working directory** — always run commands from `D:\Code\Ouitransfer` (repo root)
- **Import style** — use named imports from fumadocs: `import { Callout } from "fumadocs-ui/components/callout"`. Import `Tab, Tabs` only if tabs are used.
