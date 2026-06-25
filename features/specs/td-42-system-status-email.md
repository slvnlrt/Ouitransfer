# TD-42 — System Status: Email / Notifications subsystem

**Status:** Spec
**Type:** Technical debt → small feature (Low severity)
**Depends on:** 10.1 System Status Bar, 8.2 Email Notifications

## Problem

The Dashboard System Status surfaces DB, Storage, disk usage and platform metrics, but says
nothing about the **email / notifications** subsystem. An admin cannot tell at a glance whether
SMTP is configured/working or how many messages are queued/failing. Email-queue counters already
exist server-side (`GET /admin/email/stats`).

## Goal

Surface the health of the email/notifications subsystem in the System Status bar, with the two
audience tiers already used everywhere else:

- **User view** — coarse only: show **nothing** when fine, a short **"Notifications disrupted"**
  (perturbation) or **"Notifications offline"** (H-S) line when there is a problem. No counters,
  no SMTP details.
- **Admin view** — full detail: SMTP configured/disabled state, queue counters (pending / failed /
  sent 24h), and the last send error.

## Health model (decisions)

The subsystem status is **derived from queue counters + SMTP config only** — **no live SMTP probe**.
Rationale: `/health` and `/health/status` are public/unauthenticated; a live `transporter.verify()`
on every poll would add network cost and an amplification/availability-leak vector. Queue counters
are cheap DB counts and are the signal TD-42 itself points to.

`EmailHealthStatus = "ok" | "disabled" | "degraded" | "down"`

| Status | Condition | User | Admin |
|--------|-----------|------|-------|
| `disabled` | `smtpEnabled !== "true"` | (nothing — admin choice, not a fault) | "Not configured" |
| `ok` | enabled, `failed === 0` | (nothing) | green counters |
| `degraded` | enabled, `failed > 0` (and some sent) | "Notifications disrupted" | full detail |
| `down` | enabled, `failed > 0` **and** `sentLast24h === 0` | "Notifications offline" | full detail |

Where:
- `failed` = `count(EmailJob status="failed")` (jobs that exhausted all retries within retention).
- `sentLast24h` = `count(EmailJob status="sent", sentAt >= now-24h)`.

### Decision: email status does **not** change the server `status` aggregate

The `/health` and `/health/status` aggregate (`healthy|degraded|unhealthy`) stays based on DB +
storage only. The core product (upload/download) works even when email is down; conflating them
would make ops monitoring page on a non-critical subsystem.

The **UI** still makes the user notice: the System Status dot is bumped to at least `degraded`
(amber, never `unhealthy`) **client-side** when email is `degraded`/`down`. Server semantics stay
clean for ops.

## Data exposure (sensitivity)

- **Public** (`/health`, `/health/status`): only the coarse `email` status enum
  (`ok|disabled|degraded|down`). Consistent with the already-public `db`/`storage` ok/error.
  No counters, no error text.
- **Admin-only** (`/admin/email/stats`): counters + `smtpConfigured` + `lastError` (detail).

## Server changes

1. **`apps/server/src/modules/email/health.ts`** (new)
   - `evaluateEmailHealth(): Promise<EmailHealth>` where
     `EmailHealth = { status: EmailHealthStatus; smtpConfigured: boolean;
       queue: { pending; failed; sentLast24h; digestPending }; lastError: string | null }`.
   - Reads `smtpEnabled` via `getConfigValue` (missing key / not "true" ⇒ `smtpConfigured=false`,
     status `disabled`). Counts the queue (reuse existing count logic). `lastError` = most recent
     `EmailJob.lastError` that is non-null (`orderBy createdAt desc`).
2. **`health/routes.ts`** — import `evaluateEmailHealth`; add `email: EmailHealthStatus` to
   `/health` `checks` and to `/health/status`. Aggregate `status` unchanged. Email status uses only
   the enum.
3. **`notification/routes.ts`** `GET /admin/email/stats` — return
   `{ pending, sentLast24h, failed, digestPending, status, smtpConfigured, lastError }`, sourced from
   `evaluateEmailHealth()` (single source of truth).

## Frontend changes

4. **Types** — `app/types.ts`: add `email: EmailHealthStatus` to `CheckHealth200.checks` and
   `HealthStatus200`; export `EmailHealthStatus`. `notifications/types.ts`: extend `EmailStats` with
   `status`, `smtpConfigured`, `lastError`.
5. **`use-system-status.ts`** — add a `getEmailStats()` query (admin + expanded, like `adminStats`):
   `emailStats`, `emailStatsLoading`, `emailStatsError`. Surface email status from health for both
   tiers.
6. **`system-status-bar.tsx`**
   - **BarUserView**: a "Notifications" line rendered only when email ∈ {`degraded`,`down`}
     (amber/red icon + short label).
   - **BarAdminView**: an "Email / Notifications" section — SMTP state, counters
     (pending / failed / sent 24h), last error (tooltip when present), status label.
   - Overall dot derived client-side: bump to `degraded` if email `degraded`/`down`.
7. **i18n** — new keys under `dashboard.systemStatus.email.*` in **all 23 locales** (fully
   translated — do not reopen TD-36 with English placeholders).

## Tests

- `evaluateEmailHealth` unit: the 4 states (disabled / ok / degraded / down) + lastError selection.
- `health.test.ts`: `/health` and `/health/status` now include `email`.
- `notification/__tests__/routes.test.ts`: `/admin/email/stats` returns the enriched shape.
- Web: BarUserView shows the line only when degraded/down; BarAdminView renders the email section;
  overall-dot bump.

## Out of scope

- Live SMTP connectivity probe / "test connection" button (the existing `POST /admin/email/test`
  already covers manual verification).
- Surfacing `digestPending` in the user view.
