# TD-42 — System Status: Email / Notifications subsystem — Review

**Reviewer:** automated review pass
**Branch:** `claude/project-overview-tasks-9w4n9y`
**Commits reviewed:** `0f14186` (server) · `1b8512b` (web) · `906b693` (21-locale i18n)
**Diff base:** `git diff 8e42c3c..HEAD -- apps/`

## Summary

The implementation faithfully follows the spec. The server derives a coarse
`EmailHealthStatus` (`ok|disabled|degraded|down`) from cheap queue counters plus the
persisted `smtpEnabled` flag (no live SMTP probe), exposes only the enum on the public
`/health` and `/health/status` endpoints, keeps the aggregate `status` DB+storage-only, and
returns the enriched shape (counters + `smtpConfigured` + `lastError`) on the admin-gated
`/admin/email/stats`. The frontend wires a `getEmailStats` query (admin + expanded), bumps the
overall dot to `degraded` (never `unhealthy`, never during loading/error) client-side, shows the
user notifications line only for `degraded`/`down`, and renders the admin email section with
counters, status label, and a last-error tooltip. All 23 locales carry the email block with
genuine translations (verified for ar-SA, he-IL, de-DE, ja-JP, zh-CN, ru-RU). Types are sound
(no `any`; `EmailHealthStatus` shared between `app/types` and `notifications/types`).

The status-derivation edge cases all check out: missing `smtpEnabled` key (NotFoundError) and a
`"false"` value both map to `disabled`; `failed>0 && sentLast24h>0` is `degraded` (not `down`);
`failed>0 && sentLast24h===0` is `down`. Public endpoints provably do not leak counters
(integration tests assert `/health/status` body keys are exactly `["email","status"]`).

### Verification results

| Check | Result |
|-------|--------|
| `pnpm --filter @ouitransfer/shared build` | PASS (exit 0) |
| `pnpm --filter ouitransfer-api type-check` | PASS (exit 0) |
| `pnpm --filter ouitransfer-api test` | 1630 passed / **1 failed** — the single failure is `src/config/__tests__/storage-ensure-bucket.test.ts` ("lifecycle rule rejected"), **unrelated to TD-42** (TD-42 touches no storage config; that file was last modified in an unrelated docs commit). TD-42's own files — `email/__tests__/health.test.ts`, `__tests__/health.test.ts`, `health-status.integration.test.ts`, `notification/__tests__/routes.test.ts` — run **48 passed / 0 failed** in isolation. |
| `pnpm --filter ouitransfer-web type-check` | PASS (exit 0) |
| `pnpm --filter ouitransfer-web lint` (biome) | PASS — 456 files, no issues |
| `pnpm --filter ouitransfer-web test` | PASS — 36 files, 357 tests, 0 failed |
| Locale leaf-key parity (all 23 files vs en-US) | PASS — identical 13-leaf email key set in every locale; `locale-keys.test.ts` enforces full-tree parity incl. orphan detection |

## Findings

### Critical

None.

### Important

None.

### Minor

- [x] **Dead/unused i18n keys `email.smtpConfigured` / `email.smtpDisabled`** —
  `apps/web/messages/*.json` (`dashboard.systemStatus.email.smtpConfigured`,
  `…smtpDisabled`) were added to all 23 locales but are **never referenced** in any component.
  `BarAdminView` renders the SMTP state via the status-enum map (`email.status.disabled` →
  "Not configured", `system-status-bar.tsx:325-330,449-451`), so these two keys are orphan
  translation debt (26 unused strings across locales). The spec (line 60, "Data exposure")
  mentions `smtpConfigured` as an admin-only data field, not necessarily a label, so this looks
  like a leftover from an earlier design.
  **Fix:** remove `smtpConfigured` and `smtpDisabled` from the
  `dashboard.systemStatus.email` block in all 23 message files (the locale-parity test will
  confirm they are removed uniformly). If a distinct SMTP-state label is actually wanted in the
  admin view, instead wire one of them into `BarAdminView` next to the status label — but do not
  leave both keys unreferenced.

- [x] **Decorative status icons in the email section lack `aria-hidden`** —
  `system-status-bar.tsx:291-302` (`emailStatusIcon` helper: `CheckCircle2`/`AlertTriangle`/
  `XCircle`) renders icons with no `aria-hidden="true"`. The adjacent text label already conveys
  the status, so the icon is decorative. Note this exactly mirrors the **pre-existing**
  DB/storage status icons (`system-status-bar.tsx:341,346,351,371,373`), which also omit it — so
  this is consistency debt, not a regression introduced by TD-42. (By contrast the user-view
  icons at lines 271,276 and the last-error icon at 466 correctly set `aria-hidden`.)
  **Fix:** add `aria-hidden="true"` to the three icons returned by `emailStatusIcon`, and ideally
  to the storage/DB `storageDisplay`/DB icons too for full consistency.

- [x] **`tabular-nums` on the last-error string** — `system-status-bar.tsx:471` applies
  `tabular-nums` to the `lastError` value span. `lastError` is free-form error text (e.g. "SMTP
  535 auth failed"), not numeric data, so monospaced-digit alignment is meaningless here and can
  look slightly off. Harmless but inconsistent with intent.
  **Fix:** drop `tabular-nums` from that span (keep `truncate max-w-[200px]` and the `title`
  tooltip).

### Coverage notes (not defects — optional hardening)

- [x] **No explicit test that the dot-bump is suppressed during loading/error** — the bump is
  correctly gated by `if (!isLoading && !hasError)` (`system-status-bar.tsx:606`) and only fires
  when `overallStatus === "healthy"` (line 618), and there is a test asserting it never reaches
  `unhealthy`. There is no test exercising the loading/error suppression path, nor the
  "core already degraded/unhealthy + email down stays as-is" path. These are structurally safe,
  but a short test for each would lock the behaviour in.
  **Fix (optional):** add two cases to the "overall dot bump" describe block — (a) email `down`
  while `healthLoading: true` keeps the loading skeleton / does not render `status.degraded`;
  (b) admin core `unhealthy` + email `down` still shows `status.unhealthy` (no downgrade).

## Spec-conformance checklist (all verified PASS)

- [x] `evaluateEmailHealth` status derivation for all 4 states + both `disabled` paths
  (missing key / `"false"`) — `email/health.ts:35-73`, unit-tested.
- [x] `lastError` = most recent non-null `EmailJob.lastError`, `orderBy createdAt desc` —
  `health.ts:57-62`, query asserted in test.
- [x] `/health` and `/health/status` expose ONLY the `email` enum (no counters/lastError leak) —
  `health/routes.ts:9,72,118,131`; integration tests assert exact key sets.
- [x] Aggregate `status` excludes email server-side (DB+storage only) — `health/routes.ts:87-89,
  123-129`.
- [x] `/admin/email/stats` returns enriched shape and is admin-gated (`adminPreValidation`) —
  `notification/routes.ts:325-360`; "rejected for non-admin" test at routes.test.ts:688.
- [x] Dot bump: only `healthy → degraded`, never `unhealthy`, not during loading/error; admin
  reads `healthData.checks.email`, user reads `healthStatus.email` —
  `system-status-bar.tsx:606-621,652`.
- [x] BarUserView notifications line only for `degraded`/`down`; renders with no quota/metrics —
  `system-status-bar.tsx:215-217,267-284`; tested.
- [x] BarAdminView: counters, status icon/label, lastError tooltip, `emailStatsError` handling —
  `system-status-bar.tsx:441-477`; tested.
- [x] `getEmailStats` query enabled only for admin+expanded; in `refresh()` and `isRefreshing`;
  error parsed — `use-system-status.ts:100-108,129-151`.
- [x] Type soundness: no `any`; `EmailHealthStatus` reused across `app/types` ↔
  `notifications/types` — `app/types.ts:20`, `notifications/types.ts:4`.
- [x] RTL-safe: uses logical `me-1` (margin-end), not physical `mr` —
  `system-status-bar.tsx:470`.
- [x] i18n: all 23 locales have the email block, genuinely translated (incl. RTL ar-SA/he-IL);
  parity test covers it.
- [x] Hygiene: clean commit messages, no `console`/`debugger`/`.only`/`.skip`/TODO artifacts in
  source.

## Recommendation

Approve after the three Minor findings are addressed (the unused-i18n-key removal being the most
worthwhile, as it is genuine debt that the parity test will otherwise lock in). No Critical or
Important issues. The one failing server test is pre-existing and unrelated to this feature.

## Resolution

All three Minor findings fixed in `fix(web): address TD-42 review findings` plus the optional
coverage-hardening tests:
- Removed `email.smtpConfigured` / `email.smtpDisabled` from all 23 locale files (parity test green).
- Added `aria-hidden="true"` to the `emailStatusIcon` icons and the pre-existing DB/storage status icons.
- Dropped `tabular-nums` from the free-form `lastError` span.
- Added two dot-bump tests (loading suppression; unhealthy core not downgraded) — 62/62 in the suite.
