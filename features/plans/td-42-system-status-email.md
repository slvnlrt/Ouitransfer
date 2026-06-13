# TD-42 — Implementation Plan

Spec: `features/specs/td-42-system-status-email.md`

## Batches (sequential — one agent at a time)

### Batch 1 — Server
- New `apps/server/src/modules/email/health.ts` — `evaluateEmailHealth()` + `EmailHealthStatus` /
  `EmailHealth` types.
- `health/routes.ts` — add `email` enum to `/health` (`checks.email`) + `/health/status`; aggregate
  unchanged.
- `notification/routes.ts` — enrich `GET /admin/email/stats` response (status, smtpConfigured,
  lastError) via `evaluateEmailHealth()`.
- Tests: new `email/__tests__/health.test.ts` (4 states + lastError); update `__tests__/health.test.ts`
  + `health-status.integration.test.ts` for the `email` field; update notification routes test for the
  enriched stats shape.
- Verify: `pnpm --filter @ouitransfer/server type-check` + `test`.

### Batch 2 — Frontend (types, hook, component, en/fr i18n, web tests)
- `app/types.ts`: `EmailHealthStatus`, `CheckHealth200.checks.email`, `HealthStatus200.email`.
- `notifications/types.ts`: extend `EmailStats` (status, smtpConfigured, lastError).
- `use-system-status.ts`: `getEmailStats` query (admin+expanded) + expose email status/stats/errors.
- `system-status-bar.tsx`: BarUserView line (degraded/down only); BarAdminView "Email/Notifications"
  section; overall-dot bump.
- i18n `dashboard.systemStatus.email.*` in **en-US.json + fr-FR.json**.
- Web tests for the two views + dot bump.
- Verify: `pnpm --filter web type-check` + `lint` + `test`.

### Batch 3 — i18n the other 21 locales (mechanical)
- Add the `dashboard.systemStatus.email.*` keys, fully translated, to the 21 remaining locale files.
- Verify: locale-parity test green; `pnpm --filter web test`.

### Review
- Reviewer agent → `features/reviews/td-42-system-status-email.md`. Fix all findings.

### Done
- Update `features/README.md` (TD-42 resolved) + `TECHNICAL-DEBT.md` + `SESSIONS.md`.
