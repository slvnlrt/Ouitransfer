# Documentation Update Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the docs site (`apps/docs`) up to date with all features implemented in workstreams 5.x, 6.x, and 7.x — fix broken links, missing pages, and outdated content.

**Architecture:** 4 independent agents dispatched in parallel by theme. Agents A/B/C each create one new doc page (no file conflicts). Agent D updates all existing pages. Each agent must explore specs, code, and commits to produce accurate, actionable documentation written for system administrators.

**Tech Stack:** Fumadocs (MDX), lucide-react icons, fumadocs-ui components (Callout, Tab/Tabs, Files/Folder/File)

**Audience:** System administrators deploying and managing Ouitransfer. Documentation should be practical, concise, and task-oriented — not developer-facing internals.

---

## Conventions

All new/modified files are in `apps/docs/content/docs/v3-beta/`.

MDX frontmatter format:
```mdx
---
title: Page Title
icon: LucideIconName
---
```

Use fumadocs components where appropriate:
```mdx
import { Callout } from "fumadocs-ui/components/callout";
import { Tab, Tabs } from "fumadocs-ui/components/tabs";

<Callout type="info">Informational note</Callout>
<Callout type="warn">Warning</Callout>
```

Write in **English**, same tone as existing docs (professional, direct, second-person "you").

---

## Agent A: Quotas Documentation

**Creates:** `apps/docs/content/docs/v3-beta/quotas.mdx`

**Research sources (the agent MUST read these before writing):**
- Spec: `features/specs/5.1-quotas.md` (full file)
- Spec: `features/specs/5.4-groups.md` (quota hierarchy section)
- Code: `apps/server/src/modules/quota/service.ts` — `resolveEffectiveLimits()` logic
- Code: `apps/server/src/modules/quota/routes.ts` — endpoint definitions
- Code: `apps/server/src/modules/quota/dto.ts` — request/response shapes
- Prisma schema: `apps/server/prisma/schema.prisma` — `User` model fields `maxFileSizeOverride`, `maxTotalStorageOverride`
- Admin UI: `apps/web/src/app/user-management/` — quota widget in user form
- Settings: check which global config keys (`maxFileSize`, `maxTotalStoragePerUser`) are in the Settings UI

### Steps

- [ ] **Step 1: Read all research sources** listed above to understand the full quota system

- [ ] **Step 2: Create `quotas.mdx`** with these sections:

  **Page structure:**
  ```
  ---
  title: Storage Quotas
  icon: Gauge
  ---

  ## Overview
  - What quotas control (max file size + max total storage per user)
  - Two-level system: global defaults (Settings page) + per-user overrides (User Management)
  - Group-level inheritance (see Groups page)

  ## How Quota Resolution Works
  - Priority chain: user override > group override > global default
  - Special case: admins default to unlimited unless explicitly overridden
  - Semantics: null = inherit, 0 = unlimited, >0 = limit in bytes

  ## Global Defaults
  - Where to configure: Admin > Settings page
  - Two settings: maxFileSize, maxTotalStoragePerUser
  - These apply to all non-admin users without overrides

  ## Per-User Overrides
  - Where to configure: Admin > User Management > Edit User
  - Set explicit limits or "unlimited" for individual users
  - Overrides take priority over group and global settings

  ## What Counts Toward Storage
  - User's own uploaded files
  - Files uploaded by third parties to user's reverse shares
  - Shares (views) do NOT double-count

  ## Blocking Behavior
  - Table: what happens when over quota (uploads blocked, shares allowed, reverse share uploads allowed)

  ## Quota Widget
  - Description of the storage usage indicator visible to users
  - Warning banners when approaching or exceeding limits

  ## API Reference (Admin)
  - GET /admin/users/:id/quota — view effective limits + sources
  - PATCH /admin/users/:id/quota — set per-user overrides
  ```

- [ ] **Step 3: Verify** that all factual claims match the actual code (endpoint paths, field names, behavior)

---

## Agent B: Groups Documentation

**Creates:** `apps/docs/content/docs/v3-beta/groups.mdx`

**Research sources (the agent MUST read these before writing):**
- Spec: `features/specs/5.4-groups.md` (full file)
- Code: `apps/server/src/modules/group/routes.ts` — all 7 endpoints
- Code: `apps/server/src/modules/group/dto.ts` — request/response shapes
- Code: `apps/server/src/modules/group/service.ts` — business logic
- Prisma schema: `apps/server/prisma/schema.prisma` — `Group` model
- Frontend: `apps/web/src/app/groups-management/` — admin UI pages/components
- Frontend: `apps/web/src/app/user-management/` — group assignment in user form

### Steps

- [ ] **Step 1: Read all research sources** listed above

- [ ] **Step 2: Create `groups.mdx`** with these sections:

  **Page structure:**
  ```
  ---
  title: Groups
  icon: UsersRound
  ---

  ## Overview
  - What groups are: organizational units for quota inheritance
  - One group per user (or none)
  - Admin-only feature

  ## Creating a Group
  - Navigate to Admin > Groups Management
  - Fields: name (unique), description (optional)
  - Optional: set group-level quota overrides (max file size, max total storage)
  - Quota semantics: null = inherit global, 0 = unlimited, >0 = limit in bytes

  ## Managing Members
  - Assign users to groups from Groups Management (detail view) or User Management (edit user)
  - When a user is assigned to a group: group quota overrides apply (unless user has personal overrides)
  - Users can be in at most one group

  ## Quota Inheritance
  - Resolution chain: user override > group override > global default
  - Example scenarios showing how different configurations resolve
  - Link to Quotas page for full details

  ## Deleting a Group
  - Members are unassigned (not deleted) — they fall back to global quota defaults
  - Confirmation dialog shows how many members will be affected

  ## LDAP Group Mapping
  - Groups can be mapped to AD groups via the `ldapDn` field
  - When LDAP sync runs, users are automatically assigned to mapped groups
  - See LDAP Configuration page for details

  ## API Reference (Admin)
  - Table of all 7 endpoints: CRUD + member add/remove/list
  ```

- [ ] **Step 3: Verify** all endpoint paths, field names, and behavior against actual code

---

## Agent C: LDAP Configuration Documentation

**Creates:** `apps/docs/content/docs/v3-beta/ldap-configuration.mdx`

**Research sources (the agent MUST read these before writing):**
- Spec: `features/specs/5.3-ldap.md` (full file — read all 260 lines)
- Code: `apps/server/src/modules/ldap/routes.ts` — all endpoints
- Code: `apps/server/src/modules/ldap/dto.ts` — config shape
- Code: `apps/server/src/modules/ldap/service.ts` — sync logic
- Code: `apps/server/src/modules/ldap/scheduler.ts` — sync scheduling
- Code: `apps/server/src/utils/encryption.ts` — encryption details
- Prisma schema: `apps/server/prisma/schema.prisma` — `LdapConfig`, `LdapSyncLog` models
- Frontend: `apps/web/src/app/(dashboard)/admin/ldap/` — admin LDAP page
- Env: `apps/server/src/env.ts` — `ENCRYPTION_SECRET` definition

### Steps

- [ ] **Step 1: Read all research sources** listed above — especially the full spec

- [ ] **Step 2: Create `ldap-configuration.mdx`** with these sections:

  **Page structure:**
  ```
  ---
  title: LDAP / Active Directory
  icon: Network
  ---

  ## Overview
  - What LDAP sync does: imports AD users into Ouitransfer
  - Auth model: AD is identity source, authentication stays local (app-specific passwords)
  - Why: credential isolation, works when AD is unreachable, reuses existing auth (bcrypt, JWT, 2FA, lockout)

  ## Prerequisites
  - ENCRYPTION_SECRET env var (min 32 chars) — required for encrypting the LDAP bind password at rest
  - Add to docker-compose.yml server service or .env
  - How to generate: openssl rand -hex 32
  - A read-only AD service account (bind DN + password)
  - Network access from server container to AD (port 636 for LDAPS or 389 for STARTTLS)

  ## Configuration
  - Navigate to Admin > LDAP Configuration
  - Connection settings: server URL, bind DN, bind password, search base
  - TLS settings: LDAPS vs STARTTLS, skip TLS verification (for self-signed certs)
  - Attribute mapping: username (sAMAccountName), email (mail), display name (displayName)
  - Sync group DN: AD group whose members will be imported
  - Sync interval: how often auto-sync runs (default: 6 hours, minimum: 15 minutes)

  ## Testing the Connection
  - Use "Test Connection" button to verify AD connectivity before saving
  - Tests bind credentials and search base access

  ## Group Mapping
  - Map AD groups to Ouitransfer groups for automatic quota assignment
  - How: in Groups Management, each group has an optional "LDAP DN" field
  - During sync, if a user belongs to a mapped AD group, they're assigned to the corresponding app group
  - One group per user — first match wins

  ## Running a Sync
  - Manual: click "Sync Now" on the LDAP admin page
  - Automatic: scheduler runs at the configured interval
  - What happens during sync:
    - New AD users → created in app with random password + welcome email (if SMTP configured)
    - Existing users → name, email, group membership updated from AD
    - Users no longer in sync group → deactivated (not deleted — files/shares preserved)
    - Previously deactivated users who reappear → reactivated
    - Email collisions with existing local accounts → skipped (logged)

  ## Sync Logs
  - View sync history with status (success/partial/error), counts, and details
  - Detail view shows individual skip/error reasons

  ## User Experience
  - LDAP users receive a welcome email with a link to set their app password
  - Users can also use "Forgot Password" to set/reset their app password
  - LDAP badge visible on user profiles in admin view
  - LDAP-managed fields (name, email, group) are overwritten on each sync

  ## Troubleshooting
  - Common issues: bind failed (check credentials), no users found (check search base / sync group DN), TLS errors (check certificates or enable skip TLS verification)
  - Check sync logs for detailed error messages
  - Ensure ENCRYPTION_SECRET is set and consistent across restarts

  ## API Reference (Admin)
  - Table of endpoints: GET/PUT config, POST test, POST sync, GET logs, GET status
  ```

- [ ] **Step 3: Verify** all configuration fields, endpoint paths, and behaviors against actual code

---

## Agent D: Existing Pages Updates

**Modifies (in this order):**
1. `apps/docs/content/docs/v3-beta/meta.json` — sidebar navigation
2. `apps/docs/content/docs/v3-beta/index.mdx` — welcome page
3. `apps/docs/content/docs/v3-beta/quick-start.mdx` — env vars + broken links
4. `apps/docs/content/docs/v3-beta/architecture.mdx` — features + security table
5. `apps/docs/content/docs/v3-beta/api.mdx` — API capabilities
6. `apps/docs/content/docs/v3-beta/github-architecture.mdx` — feature list
7. `apps/docs/content/docs/v3-beta/manual-installation.mdx` — env vars
8. `D:\Code\Ouitransfer\.env.example` — add ENCRYPTION_SECRET

**Research sources:**
- Current content of all files listed above (read each before modifying)
- Env schema: `apps/server/src/env.ts` — complete variable list
- Root `.env.example` — current documented variables

### Steps

- [ ] **Step 1: Read all files** that will be modified

- [ ] **Step 2: Update `meta.json`** — sidebar navigation

  Changes:
  - Remove the dead `"installation"` entry (no file exists for it)
  - Add new pages in the Configuration section, after `oidc-authentication`:
    - `"quotas"`
    - `"groups"`
    - `"ldap-configuration"`

  The result should look like:
  ```json
  {
    "pages": [
      "---Introduction---",
      "index",
      "quick-start",
      "manual-installation",
      "screenshots",
      "s3-providers",
      "---Configuration---",
      "configuring-smtp",
      "available-languages",
      "uid-gid-configuration",
      "reverse-proxy-configuration",
      "password-reset-without-smtp",
      "oidc-authentication",
      "quotas",
      "groups",
      "ldap-configuration",
      "---Developers---",
      ...
    ]
  }
  ```

- [ ] **Step 3: Update `index.mdx`** — welcome page

  In the "Manage users like a pro" section (lines 41-47), add mentions of groups and LDAP after the existing bullet points:
  ```
  - Organize users into **groups** with per-group storage quota policies.
  - Sync users from **Active Directory** via LDAP — automatic onboarding and group mapping.
  ```

  Do NOT change the "No limits" section — it's about no artificial limits vs commercial solutions, not about quotas.

- [ ] **Step 4: Update `quick-start.mdx`** — env vars + broken links

  4a. In the configuration table (lines 294-316), add after `SECURE_SITE`:
  ```
  | `TRUST_PROXY` | `loopback` | Trusted proxy setting for Fastify (`loopback`, comma-separated IPs, or `true` for all proxies) |
  | `ENCRYPTION_SECRET` | - | AES-256-GCM key for encrypting sensitive data at rest (e.g., LDAP bind password). Required if using LDAP. Generate with: `openssl rand -hex 32` |
  | `ENABLE_API_DOCS` | `false` (prod) | Set `true` to enable Scalar/Swagger API documentation at `/docs` and `/swagger` in production |
  ```

  4b. Also add `ENCRYPTION_SECRET` as a commented-out optional in both Docker Compose YAML blocks (Named Volumes and Bind Mounts), in the server service environment section, after CORS_ORIGINS:
  ```yaml
  # ENCRYPTION_SECRET: ""       # Required for LDAP — generate with: openssl rand -hex 32
  ```

  4c. Fix broken links in "What's Next?" section (lines 464-466):
  - Remove the line: `- **[Download Memory Management](/docs/v3-beta/download-memory-management)** - ...` (page does not exist)
  - Fix: `- **[S3 Storage](/docs/v3-beta/s3-configuration)**` → `- **[S3 Storage Providers](/docs/v3-beta/s3-providers)** - Configure external S3 storage providers (AWS, Backblaze, etc.)`
  - Add new links:
    ```
    - **[Storage Quotas](/docs/v3-beta/quotas)** - Configure per-user and per-group storage limits
    - **[Groups](/docs/v3-beta/groups)** - Organize users into groups with quota policies
    - **[LDAP / Active Directory](/docs/v3-beta/ldap-configuration)** - Sync users from Active Directory
    ```

- [ ] **Step 5: Update `architecture.mdx`** — security table + features

  5a. In the "Security configuration" section (lines 142-156), add `ENCRYPTION_SECRET` to the security table:
  ```
  | `ENCRYPTION_SECRET` | Optional (min 32 chars) — AES-256-GCM key for encrypting sensitive data (LDAP bind password). Required if LDAP is enabled |
  ```

  5b. In the "How it works" section (lines 74-79), add a line after item 4:
  ```
  5. **User Management** — Groups, per-user quotas, LDAP/AD synchronization, and role-based access control
  ```

- [ ] **Step 6: Update `api.mdx`** — API capabilities

  In the "API capabilities" section (lines 112-146), add three new subsections after "System integration":

  ```markdown
  ### Quota management

  - **View quotas** - Retrieve effective limits for any user with source tracking
  - **Set overrides** - Configure per-user storage limits (admin only)

  ### Group management

  - **CRUD operations** - Create, read, update, and delete groups (admin only)
  - **Member management** - Add and remove users from groups
  - **Quota inheritance** - Groups propagate quota settings to their members

  ### LDAP / Active Directory

  - **Configuration** - Set up and manage LDAP connection settings (admin only)
  - **Connection testing** - Verify AD connectivity before enabling sync
  - **Sync operations** - Trigger manual sync or configure automatic scheduling
  - **Sync logs** - View sync history with detailed status and error reporting
  ```

  Also add to the "User operations" subsection:
  ```
  - **Two-factor authentication** - Enable/disable TOTP 2FA, manage backup codes
  ```

- [ ] **Step 7: Update `github-architecture.mdx`** — feature list

  In "Key features" section, update:

  7a. In "User system" (lines 153-161), add:
  ```
  - Two-factor authentication (TOTP, RFC 6238) with backup codes
  - Account lockout after repeated failed login attempts (brute-force protection)
  - LDAP / Active Directory synchronization (user import, group mapping, scheduled sync)
  ```

  7b. In "Storage system" (lines 163-171), replace the vague "Usage tracking and quotas (per user or global)" with:
  ```
  - Storage quotas with 3-level resolution: per-user override > group override > global default
  - Admin can set per-user and per-group quota overrides
  ```

  7c. Add a new "Groups" subsection after "User system":
  ```
  ### Groups

  OUITRANSFER. supports organizational groups for user management and quota inheritance.
  Groups are admin-managed and can be mapped to AD groups for automatic LDAP assignment.

  - One group per user, optional
  - Per-group quota overrides (max file size, max total storage)
  - LDAP DN mapping for Active Directory integration
  - Admin CRUD + member management via dedicated UI and API
  ```

- [ ] **Step 8: Update `manual-installation.mdx`** — env vars

  In "Other Important Settings" section (lines 125-135), add:
  ```bash
  # Encryption key for sensitive data at rest (required for LDAP)
  # ENCRYPTION_SECRET=<output of openssl rand -hex 32>

  # Trust proxy setting (required behind reverse proxy)
  # TRUST_PROXY=loopback

  # Enable API documentation in production (Scalar + Swagger)
  # ENABLE_API_DOCS=true
  ```

- [ ] **Step 9: Update `.env.example`** — add ENCRYPTION_SECRET

  In the Security section (after COOKIE_SECRET, before SECURE_SITE), add:
  ```bash
  # Encryption key for sensitive data at rest (e.g., LDAP bind password)
  # Required if using LDAP integration. Generate with: openssl rand -hex 32
  # ENCRYPTION_SECRET=
  ```

- [ ] **Step 10: Verify** all changes: no broken MDX syntax, no broken internal links, all file paths correct

---

## Execution Strategy

**Dispatch 4 agents in parallel:**

| Agent | Theme | Files | Estimated Size |
|-------|-------|-------|---------------|
| A | Quotas | Creates `quotas.mdx` | ~120 lines |
| B | Groups | Creates `groups.mdx` | ~130 lines |
| C | LDAP | Creates `ldap-configuration.mdx` | ~200 lines |
| D | Existing pages | Edits 8 files | ~40 edits across files |

**No file conflicts:** Agents A/B/C each create one new file. Agent D only modifies existing files. No overlap.

**Each agent must:**
1. Read ALL listed research sources before writing
2. Cross-reference facts against actual code (endpoint paths, field names, env vars)
3. Match existing documentation tone and formatting
4. Use fumadocs MDX components where appropriate (Callout, Tabs)
5. Commit their changes with message: `docs: add/update [topic] documentation`

**Verification after all agents complete:**
1. Run `pnpm --filter ouitransfer-docs build` to verify no MDX/build errors
2. Spot-check that all new internal links resolve (quotas, groups, ldap-configuration)
3. Verify meta.json matches actual files on disk
