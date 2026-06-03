# Bug Report

> Bugs discovered during testing and development.
> **Voir aussi :** [`TECHNICAL-DEBT.md`](TECHNICAL-DEBT.md) — dettes techniques · [`SECURITY.md`](SECURITY.md) — findings sécurité
>
> All resolved bugs are archived:
> - B-1 through B-20: `features/archive/BUGS-2026-05.md`
> - B-21 through B-25: `features/archive/BUGS-2026-05-31.md`

## Open

_None._

## Resolved (recent)

### B-26: TOCTOU race condition on invite token single-use enforcement — RESOLVED

- **Severity**: Medium
- **File**: `apps/server/src/modules/invite/service.ts`
- **Description**: `validateInviteToken` checked `usedAt` is null, then the `$transaction` did an unconditional `inviteToken.update({ data: { usedAt } })`. Two concurrent requests with the same valid token could both pass validation and both create users before either set `usedAt` — the single-use guarantee was not enforced atomically.
- **Fix**: Token consumption is now atomic inside the transaction via `updateMany({ where: { token, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: new Date() } })`; if `count === 0` the request re-reads the row and throws the precise structured error (`INVITE_TOKEN_USED` / `INVITE_TOKEN_EXPIRED` / `NOT_FOUND`) without creating a user. A fast-fail pre-flight check (before the bcrypt hash) is retained for friendly errors. Extracted pure `evaluateInviteToken()` (shared with the GET validate route) + `invalidInviteTokenError()`. Added 3 lost-race `app.inject` integration tests asserting no user is created when the claim matches 0 rows.
- **Status**: Resolved (branch `claude/project-onboarding-debt-oJkhn`)

### B-27: Container boot skips DB seeding → empty config → crash loop — RESOLVED

- **Severity**: Critical (server unbootable on a fresh volume)
- **Files**: `infra/server-start.sh`, `Dockerfile`, `knip.json`; deleted `infra/check-missing.js` / `infra/configs.json` / `infra/providers.json`; `apps/server/prisma/seed.js` (thin runner) + new `apps/server/src/db/seed-data.ts` (extracted, added to `package.json` `files`) + `apps/server/src/__tests__/seed.integration.test.ts`
- **Introduced by**: TD-48 (`abeff4c`) — reworked the boot to route ALL seeding through a `NEEDS_SEEDING` gate, removing the previous unconditional fresh-DB seed.
- **Description**: `server-start.sh` seeded only when `NEEDS_SEEDING=$(... check-missing.js check-seeding 2>/dev/null || echo "true")` equalled `"true"`. `check-missing.js` calls `dotenv.config()`, and dotenv v17 prints a banner to **stdout**, so the capture became `"<banner>\ntrue"` and the exact `= "true"` match failed → seed skipped → `app_configs` empty → server crash-loops on the first missing config key (`passwordMinLength`, `auditRetentionDays`, `autoCleanupEnabled`, …). Caught by the release-validation gate (`e2e.yml`) only at tag time, so it sat undetected on `main` between releases. Two latent issues compounded it: the seed/check scripts importing `../src/...` (only resolvable via tsx + shipped `src/`), and `infra/configs.json` (the check's hand-maintained key checklist) having silently drifted 26 keys behind `seed.js`.
- **Fix**: Seeding is idempotent ("protected mode"), so `server-start.sh` now runs it **unconditionally** on every boot (backfills new keys, self-heals partial seeds, fails loudly instead of silently). Removed the `check-missing.js` gate + the hand-maintained `configs.json`/`providers.json` checklists entirely. Extracted seed data/logic into `src/db/seed-data.ts` (typed, side-effect-free) with `prisma/seed.js` a thin `dotenv({ quiet: true })` runner. Added `seed.integration.test.ts` (completeness + idempotency) so the boot contract is covered in fast PR CI.
- **Status**: Resolved (branch `claude/fix-docker-seed-boot`)
