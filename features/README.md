# Features — Active Development

This directory tracks all feature development for Ouitransfer (post-refactor phase).

## Workstreams

### 5.x — New Features

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 5.1 | [Per-User Storage Quotas](specs/5.1-quotas.md) | Done | — |
| 5.4 | [Groups](specs/5.4-groups.md) | Done | 5.1 |
| 5.2 | [Automatic Cleanup of Expired Content](specs/5.2-cleanup.md) | Done — Phase A + A.1 + B (lifecycle, manual pause, quota overage policy) | — |
| 5.3 | [LDAP / Active Directory Sync](specs/5.3-ldap.md) | Done | 5.4 |

### 6.x — UI Overhaul

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 6.1 | [UI Code Audit](specs/6.1-ui-audit.md) | Done | — |
| 6.2 | [UI Code Quality Fixes](specs/6.2-ui-fixes.md) | Done | 6.1 |
| 6.3 | [Visual Redesign](specs/6.3-visual-redesign.md) | Done | 6.2 |

### 7.x — Error Handling & Polish

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 7.1 | [Error Handling & Dashboard Redesign](specs/7.1-error-handling-dashboard.md) | Done | — |

### 9.x — UX & Workflow

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 9.1 | [Quickshare](specs/9.1-quickshare.md) | Done | — |

### 10.x — UI Components & Layout

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 10.1 | System Status Bar | Done | — |
| 10.2 | [Email/Notifications subsystem status (TD-42)](specs/td-42-system-status-email.md) | Done | 10.1, 8.2 |

### 8.x — Auditing, Email & Tracking

| # | Feature | Status | Depends on |
|---|---------|--------|------------|
| 8.1 | [Audit Trail / Activity Log](specs/8.1-auditing.md) | Done | — |
| 8.2 | [Email Notifications](specs/8.2-email-notifications.md) | Done | — |
| 8.3 | [Download Tracking](specs/8.3-download-tracking.md) | Done — lots A (download badge), B (manual reminders), C (cookie→recipient linkage), D (reverse upload tracking), F (audit enrich + RGPD notice) shipped; E dropped | 8.1, 8.2 |

### Status Legend

| Status | Meaning |
|--------|---------|
| Not started | Nothing done yet |
| Spec | Open questions resolved, spec finalized |
| Planning | Implementation plan written |
| In progress | Implementation underway |
| In review | Review done, corrections in progress |
| Done | All findings fixed, validated |

## Implementation Order

### Features (5.x)

```
5.1 Quotas  →  5.4 Groups  →  5.3 LDAP/AD sync

5.2 Auto-cleanup — Done (Phase A + A.1 + B, independent)
```

### UI (6.x)

```
6.1 Audit  →  6.2 Fixes  →  6.3 Visual Redesign
```

The 6.x track is independent from 5.x — both can run in parallel.

## Workflow

```
1. Spec        → specs/X.Y-name.md     (design, open questions → decisions)
2. Plan        → plans/X.Y-name.md     (tasks, batches, order)
3. Implement   → subagents, commits
4. Review      → reviews/X.Y-name.md   (findings with checkboxes)
5. Fix ALL     → address every finding, check them off in review file
6. Done        → update status table above
```

Key rules:
- The **review file IS the post-review TODO** — no separate file. Each finding is a checkbox.
- A feature is **not Done until every checkbox in the review is checked**.
- Findings are rated Critical / Important / Minor — ALL must be fixed, none are optional.

## Naming Convention

Same base name across directories — the folder gives context:
```
specs/5.1-quotas.md       ← what to build (design + decisions)
plans/5.1-quotas.md       ← how to build it (tasks, batches)
reviews/5.1-quotas.md     ← review findings (checklist)
```

## Directory Structure

```
features/
  README.md         ← this file — orientation and status
  SESSIONS.md       ← session log (date + bullet points)
  specs/            ← one file per feature (requirements + decisions)
  plans/            ← implementation plans (tasks, batches, order)
  reviews/          ← review findings (checkboxes = post-review TODO)
```

## Current Focus

**Completed:** 5.1 Quotas, 5.2 Auto-cleanup (Phase A + A.1 + B), 5.4 Groups, 5.3 LDAP, 6.1-6.3 UI Overhaul, 7.1 Error Handling, 9.1 Quickshare, 10.1 System Status Bar, 8.1 Audit Trail, 8.2 Email Notifications, 8.3 Download Tracking.
All resolved: B-1 through B-25, TD-1 through TD-5, TD-6 through TD-19, TD-21, TD-24, TD-25, TD-28, TD-29, TD-31, TD-32, TD-33, TD-35, TD-37, TD-41, TD-43, TD-45, TD-46, TD-48, TD-49, TD-52. TD-10 also resolved.

**Test counts:** 103 server test files (1631 tests) + 36 web test files (359 tests) + 2 shared (14 tests) = **2004 total**.

**Open bugs:** _none_ (B-26 resolved)
**Open tech debt:** TD-20, TD-27 — see `TECHNICAL-DEBT.md` (TD-5, TD-10, TD-28, TD-30, TD-32, TD-33, TD-36, TD-38, TD-40, TD-42, TD-43, TD-50, TD-51, TD-52 resolved/closed)
**Next features:** _none queued_ — TD-42 (System Status Email/Notifications subsystem) shipped: review clean (0 Critical / 0 Important / 3 Minor, all fixed) — `features/reviews/td-42-system-status-email.md`.
