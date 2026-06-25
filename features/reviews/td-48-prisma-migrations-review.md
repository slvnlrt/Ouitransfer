# TD-48 — Adopt Prisma Migrate — Final Review

**Scope:** whole-feature review of diff `69d3bdd..13f8816` (single final review, per decision).
**Reviewer verdict:** 0 Critical, 0 Important, 4 Minor — *"Ship it."*
**Fixes commit:** `53fbe0d` — `fix(monorepo): address TD-48 final review findings`.

The implementation was independently re-verified: clean baseline (`20260602091201_init`, all 26 tables incl. `_ShareFiles`/`_ShareFolders` join tables, CREATE-only, zero drift), WAL-safe backup logic, the three boot paths, turbo no-op for web/docs, the CI drift guard, knip, and the `db-backup` tests.

## Findings

- [x] **#1 (Minor) — `infra/SCRIPTS.md:20` documented the stale workflow.** The row said *"DB setup via `prisma db push`"*; the Task 6 scrub only covered `apps/docs/**`.
  **Resolution:** updated to *"DB setup via `prisma migrate deploy` + WAL-safe pre-migrate backup, privilege drop"*.

- [x] **#2 (Minor, optional) — `prisma-v7.integration.test.ts:39` uses `npx prisma db push` in `beforeAll`.** Reviewer suggested `migrate deploy` to exercise the production path.
  **Resolution:** evaluated and **kept `db push` by design** — it is pure *test scaffolding* to materialise the schema on whatever DB the test targets, independent of migration history. `migrate deploy` is intentionally avoided here because it raises **P3005** on a non-empty DB that has no `_prisma_migrations` table (reproduced: switching broke the suite). Added a comment clarifying this is test scaffolding, not the dev/prod workflow.

- [x] **#3 (Minor) — `db-backup.ts` timestamp collision (theoretical).** Millisecond-resolution stamp; two backups in the same ms would overwrite.
  **Resolution:** **no change, justified** — the boot path creates exactly one backup per invocation, so two same-millisecond backups cannot occur.

- [x] **#4 (Minor) — WAL test did not exercise un-checkpointed `-wal` frames.** `makeDb()` closed the connection (checkpointing) before backup, so the test validated `.backup()` but not the dirty-WAL scenario the script guards against.
  **Resolution:** added a deterministic test that keeps a writer open with `wal_autocheckpoint = 0`, commits rows that stay in the `-wal` sidecar, asserts the `-wal` file exists, then verifies the backup captures all rows. `db-backup.test.ts` now has 6 passing tests.

## Operational note (not a defect)

A DB created by the old `db push` (tables present, no `_prisma_migrations`) makes the boot `migrate deploy` fail with P3005. This is the accepted clean-slate edge case (spec §E / plan Risks): no production exists, so the first real deploy creates the DB fresh. The one-time escape hatch `prisma migrate resolve --applied 20260602091201_init` is documented in the plan only — deliberately not in the runtime boot path.

## Post-fix verification

- `prisma-v7.integration.test.ts` + `db-backup.test.ts`: 9 tests pass.
- Biome: clean on changed files. Type-check: 0 errors.
- Full T7 verification (pre-fix) was already green: 80 server test files / 1168 tests, biome clean, knip clean, drift check exit 0.
