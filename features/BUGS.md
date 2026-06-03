# Bug Report

> Bugs discovered during testing and development.
> **Voir aussi :** [`TECHNICAL-DEBT.md`](TECHNICAL-DEBT.md) — dettes techniques · [`SECURITY.md`](SECURITY.md) — findings sécurité
>
> All resolved bugs are archived:
> - B-1 through B-20: `features/archive/BUGS-2026-05.md`
> - B-21 through B-25: `features/archive/BUGS-2026-05-31.md`

## Open

### B-26: TOCTOU race condition on invite token single-use enforcement

- **Severity**: Medium
- **File**: `apps/server/src/modules/invite/service.ts:59-115`
- **Description**: `validateInviteToken` checks `usedAt` is null, then the `$transaction` does an unconditional `inviteToken.update({ data: { usedAt } })`. Two concurrent requests with the same valid token can both pass validation and both create users before either sets `usedAt` — the single-use guarantee is not enforced atomically.
- **Fix**: Make token consumption atomic: use `updateMany({ where: { token, usedAt: null }, data: { usedAt: new Date() } })` and throw `INVITE_TOKEN_USED` if `count === 0`. Only proceed with user creation after the token is successfully claimed.
- **Priority**: Low (requires intentional concurrent exploitation; invite tokens are short-lived and typically used once interactively)

### B-27: Container boot skips DB seeding → empty config → crash loop — RESOLVED

- **Severity**: Critical (server unbootable on a fresh volume)
- **Files**: `infra/server-start.sh`, `infra/check-missing.js` (deleted), `apps/server/prisma/seed.js`
- **Introduced by**: TD-48 (`abeff4c`) — reworked the boot to route ALL seeding through a `NEEDS_SEEDING` gate, removing the previous unconditional fresh-DB seed.
- **Description**: `server-start.sh` seeded only when `NEEDS_SEEDING=$(... check-missing.js check-seeding 2>/dev/null || echo "true")` equalled `"true"`. `check-missing.js` calls `dotenv.config()`, and dotenv v17 prints a banner to **stdout**, so the capture became `"<banner>\ntrue"` and the exact `= "true"` match failed → seed skipped → `app_configs` empty → server crash-loops on the first missing config key (`passwordMinLength`, `auditRetentionDays`, `autoCleanupEnabled`, …). Caught by the release-validation gate (`e2e.yml`) only at tag time, so it sat undetected on `main` between releases. Two latent issues compounded it: the seed/check scripts importing `../src/...` (only resolvable via tsx + shipped `src/`), and `infra/configs.json` (the check's hand-maintained key checklist) having silently drifted 26 keys behind `seed.js`.
- **Fix**: Seeding is idempotent ("protected mode"), so `server-start.sh` now runs it **unconditionally** on every boot (backfills new keys, self-heals partial seeds, fails loudly instead of silently). Removed the `check-missing.js` gate + the hand-maintained `configs.json`/`providers.json` checklists entirely. Extracted seed data/logic into `src/db/seed-data.ts` (typed, side-effect-free) with `prisma/seed.js` a thin `dotenv({ quiet: true })` runner. Added `seed.integration.test.ts` (completeness + idempotency) so the boot contract is covered in fast PR CI.
- **Status**: Resolved (branch `claude/fix-docker-seed-boot`)
