# Documentation Update — 2026-05-24

**Status:** Planning  
**Type:** Documentation  
**Scope:** Complete audit and update of `apps/docs` Fumadocs documentation

## Summary

The Fumadocs documentation (`apps/docs/content/docs/v1-beta/`) was largely written before the major refactoring phases (0–9) and the subsequent feature development phase (5.x–10.x). A full audit is needed to bring every page up to date with the actual codebase, add pages for features that were implemented but never documented, and remove or correct anything that no longer reflects reality.

## What Changed Since Docs Were Last Updated

Based on `features/README.md`, `features/SESSIONS.md`, and `features/specs/`:

### Fully implemented features without doc pages
- **8.1 Audit Trail / Activity Log** — Admin page at `/admin/audit`, 67 audit actions, filters, CSV/JSON export, configurable retention (`auditRetentionDays`)
- **10.1 System Status Bar** — Collapsible glassmorphism bar showing storage/share/file metrics

### Completed features with existing pages (need verification)
- **5.1 Quotas** — Page exists (`quotas.mdx`). Implemented and Done.
- **5.4 Groups** — Page exists (`groups.mdx`). Implemented and Done. Note: `ldapDn` warning still accurate (not exposed in UI/API).
- **5.3 LDAP/AD** — Page exists (`ldap-configuration.mdx`). Implemented and Done.
- **9.1 Quickshare** — Page exists (`quick-share.mdx`). Implemented and Done.

### Infrastructure / architecture changes
- Refactoring phases 0–9: ESM migration, Fastify 5, pnpm workspace, Turborepo, packages/shared, packages/config
- New env vars: `CSRF_SECRET`, `COOKIE_SECRET`, `ENCRYPTION_SECRET`, `ENABLE_API_DOCS`, `TRUST_PROXY`, `AUDIT_RETENTION_DAYS` (this is an app config, not env var)
- Test counts updated to 825 total
- 3-container Docker architecture (storage + server + web) — already documented

### UI overhaul (6.x)
- Complete visual redesign with indigo palette — screenshots are stale (deferred, not in scope)

## Decisions

1. **Screenshots** — Deferred. Leave `screenshots.mdx` as-is for now; new screenshots require manual capture after the redesign.

2. **System Status Bar** — No dedicated page needed. It's a UI element, not a configurable feature. Mention it briefly in `index.mdx`.

3. **Activity Log page** — Create `activity-log.mdx` with: feature overview, UI description, retention config, API reference for admin endpoints.

4. **API page** — Full endpoint audit: read every `routes.ts` file in `apps/server/src/modules/`, compare to `api.mdx`, add all missing endpoints.

5. **Verification approach** — Per-theme agents that read both the doc page AND the authoritative code/specs. Not doc-only reads.

6. **ldapDn warning** — Keep the warning in `groups.mdx` and `ldap-configuration.mdx` as `ldapDn` is confirmed not exposed in the web UI.

7. **OIDC pages** — Verify after auth refactor. Check if SSO flows still work the same way after the auth-providers module refactor.

8. **meta.json** — Add `activity-log` entry to sidebar under `---Usage---` or `---Configuration---` section.

## Scope

### Pages to CREATE
| File | Feature | Source of truth |
|------|---------|----------------|
| `activity-log.mdx` | 8.1 Audit Trail | `features/specs/8.1-auditing.md`, server audit routes |

### Pages to UPDATE (confirmed outdated or unverified)
| File | Known issues | Verification needed |
|------|-------------|---------------------|
| `index.mdx` | Missing mention of Activity Log, System Status Bar | Feature list vs. implemented features |
| `architecture.mdx` | Missing Audit Trail in feature list | Current codebase state |
| `api.mdx` | Partial — many endpoints missing | All `modules/*/routes.ts` files |
| `meta.json` | Missing `activity-log` entry | Add to sidebar |
| `quick-start.mdx` | Verify env vars, check for new options | `.env.docker.example`, Docker Compose |
| `manual-installation.mdx` | Possibly outdated (pnpm workspace, just recipes) | CLAUDE.md, actual install steps |
| `groups.mdx` | Verify accuracy | `features/specs/5.4-groups.md`, server routes |
| `ldap-configuration.mdx` | Verify accuracy | `features/specs/5.3-ldap.md`, server routes |
| `quotas.mdx` | Verify accuracy | `features/specs/5.1-quotas.md`, server routes |
| `quick-share.mdx` | Verify accuracy | `features/specs/9.1-quickshare.md`, UI code |
| `oidc-authentication/*.mdx` | Auth system refactored | `apps/server/src/modules/auth-providers/` |
| `configuring-smtp.mdx` | Spot-check | Server SMTP config |
| `s3-providers.mdx` | Spot-check | Server S3 config, env vars |
| `uid-gid-configuration.mdx` | Spot-check | Docker Compose, server code |
| `reverse-proxy-configuration.mdx` | Spot-check | `TRUST_PROXY` env var added |
| `password-reset-without-smtp.mdx` | Spot-check | Auth routes |
| `github-architecture.mdx` | Verify monorepo structure | Current repo layout |
| `available-languages.mdx` | Verify language count (23 languages) | `apps/web/messages/` |
| `translation-management.mdx` | Spot-check | Current i18n setup |

### Pages NOT in scope
- `screenshots.mdx` — Deferred (need new screenshots after redesign)
- `contribute.mdx`, `open-an-issue.mdx` — Static, unlikely to have changed
- `gh-star.mdx`, `gh-sponsor.mdx` — Static

## Agent Structure

### Step 1: Missing page detection agent
Reads `features/README.md`, all `features/specs/*.md`, `features/SESSIONS.md`, and `meta.json`.
Produces: definitive list of implemented features with no doc page.

### Step 2: Per-theme verification agents (sequential)
Each agent reads the doc page(s) + the code/specs to produce a correction list.

| Agent | Doc pages | Code/spec sources |
|-------|-----------|-------------------|
| API audit | `api.mdx` | All `apps/server/src/modules/*/routes.ts` |
| Features | `quotas.mdx`, `groups.mdx`, `ldap-configuration.mdx`, `quick-share.mdx` | Specs 5.1, 5.4, 5.3, 9.1 + server modules |
| Auth/OIDC | `oidc-authentication/*.mdx` (11 files) | `apps/server/src/modules/auth-providers/`, auth module |
| Configuration | `configuring-smtp.mdx`, `s3-providers.mdx`, `uid-gid-configuration.mdx`, `reverse-proxy-configuration.mdx`, `password-reset-without-smtp.mdx` | Server env vars, `infra/`, docker-compose |
| Getting started | `quick-start.mdx`, `manual-installation.mdx` | `.env.docker.example`, `infra/docker-compose.yml`, `Justfile` |
| Architecture & index | `index.mdx`, `architecture.mdx`, `github-architecture.mdx`, `available-languages.mdx`, `translation-management.mdx` | Current codebase state, features Done list |

### Step 3: Implementation agents (sequential, per theme)
Apply corrections from Step 2 + create new pages from Step 1.

## Success Criteria

- Every documented feature matches what's actually in the codebase
- All implemented features have at least one doc page (or are mentioned where appropriate)
- API page covers all admin and public endpoints with accurate method/path/description
- No outdated env vars, no wrong instructions, no references to removed features
- `meta.json` sidebar reflects all pages
- Screenshots page untouched (deferred)
