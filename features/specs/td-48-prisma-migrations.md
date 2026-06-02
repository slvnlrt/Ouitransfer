# TD-48 — Adopt Prisma Migrate (SQLite, self-hosted)

## Overview

The project ships database schema changes via `prisma db push` both in local dev
(`just db-dev-init`) and at container boot (`infra/server-start.sh:66,71`). The
`apps/server/prisma/migrations/` folder is frozen at `20260520083415_add_ldap_support`
(20 May 2026) while `schema.prisma` has gained many columns/models since
(`reverse_shares.notifyOnUpload`, `bypassUploadCooldown`, `backgroundImageId`,
`notifiedForExpiring/Expired`, `background_images`, `email_jobs`,
`notification_preferences`, `share_visits`, …).

This is **TD-48**. It is harmless today (no production, `db push` works in dev) but is a
production hazard: `db push` diffs the live schema against the database and applies the
delta — it can **drop columns/tables and lose data** without warning, and it cannot perform
data migrations (e.g. backfilling a new `NOT NULL` column). For a self-hosted product that
will ship schema changes across versions to installs holding real user data, this is the
wrong tool.

**Decision:** adopt the canonical Prisma production workflow — migrations as code, authored
with `migrate dev`, applied with `migrate deploy` at container boot.

## Locked Decisions

These were resolved during brainstorming and are not open questions:

1. **Database engine:** SQLite only, permanently. No multi-provider strategy needed — native
   Prisma SQLite migrations.
2. **Strategy:** Approach A — clean baseline + `migrate deploy` at boot, with an automatic
   WAL-safe SQLite backup before applying pending migrations.
3. **Dev workflow:** `migrate dev` everywhere. Local dev creates its DB from migrations
   (`migrate deploy`) and authors new migrations with `migrate dev`. No `db push` in the
   committed workflow (dev = prod).

## Background — the state-of-the-art Prisma pattern

- **Migrations are code:** versioned SQL files in git, reviewed in PRs.
- **`prisma migrate dev`** (development): edit `schema.prisma` → Prisma generates the SQL
  migration, applies it to the local DB, and the file is committed with the code change.
- **`prisma migrate deploy`** (deploy/boot): applies **only pending migrations**. Never
  resets, never prompts, never loses data silently. Idempotent.

For a self-hosted app delivered as a Docker image, the winning combination is **migrations
committed into the image + `migrate deploy` at container boot**. The user runs
`docker compose pull && up -d`; the container applies pending migrations; their data
survives. Zero manual intervention.

## Design

### A. Clean baseline

- Delete the 6 stale migrations under `apps/server/prisma/migrations/`.
- Generate **one baseline migration** from the current schema: `prisma migrate dev --name init`.
  It encodes the entire current schema (all post-20-May additions listed above).
- Verify zero drift after generation (see section D).

Justified by clean-slate (no production to preserve). The baseline reset is a **one-time**
event; from this point forward, migrations are incremental.

### B. Container boot (`infra/server-start.sh`)

The script currently has two branches (first-run vs existing), both running `db push`. Unify
into a **single path**:

1. **WAL-safe backup** — only when migrations are actually pending: checkpoint WAL
   (`PRAGMA wal_checkpoint(TRUNCATE)`) then copy `ouitransfer.db` →
   `ouitransfer.db.pre-migrate-<timestamp>.bak`, retaining the last 3 backups.
2. **`prisma migrate deploy`** — creates the SQLite file on first run, applies pending
   migrations on subsequent runs. Idempotent, non-interactive, never destructive.
3. **Conditional seed** — unchanged (`check-missing.js` → `seed.js` when needed).

Because `migrate deploy` creates the database file when absent, the first-run/existing
distinction disappears — one code path for both.

### C. Dev workflow (`Justfile`, `apps/server/package.json`)

- `db-dev-init`: `prisma db push` → **`prisma migrate deploy`** (+ seed). Local DB is born
  from migrations.
- `db-migrate-dev` (`prisma migrate dev`): becomes **THE** way to change the schema — edit
  `schema.prisma`, generate the migration, commit it with the code.
- `db:migrate` (`prisma migrate deploy`) and `db-migrate`: unchanged, already correct.
- No `db push` reference remains in the committed workflow.

### D. Anti-recurrence guard (the key control)

So TD-48 can **never silently return**, add a CI check that detects schema↔migrations drift:

```
prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --exit-code
```

Exit code ≠ 0 if anyone edits `schema.prisma` without generating the matching migration → CI
fails. This is what makes the system robust over time. Integrated into
`.github/workflows/ci.yml`.

### E. Existing dev databases (one-time)

Local `ouitransfer.db` files created by the old `db push` have no `_prisma_migrations` table,
so `migrate deploy` would fail (baseline `init` would try to create already-existing tables).
Under clean-slate (no prod): developers **delete their local DB** and run `just db-dev-init`
to recreate fresh. Documented as a one-time step. (`migrate resolve --applied` baselining was
considered and rejected — recreating is simpler in dev.)

### F. Docs & conventions

- **CLAUDE.md:** the rule *"No incremental migrations — Prisma schema can be reset/recreated
  from scratch"* changes. The baseline reset is a one-time event (now); thereafter migrations
  are incremental and committed. Reword the "No Production, No Legacy" guidance accordingly.
- **TECHNICAL-DEBT.md:** mark TD-48 resolved.
- **SESSIONS.md:** log the change.
- Update Fumadocs (`apps/docs`) if it references `db push`.

## Risks & edge cases

- **WAL backup correctness (TD-46 enables WAL):** a naive `cp` of the `.db` file can miss
  un-checkpointed data in the `-wal` file → inconsistent backup. **Fix:** checkpoint
  (`PRAGMA wal_checkpoint(TRUNCATE)`) before copying, or copy `.db` + `-wal` + `-shm`
  together. Exact mechanism decided in the plan.
- **SQLite limited `ALTER TABLE`:** Prisma emits "rebuild table" migrations for some changes.
  Normal and handled by Prisma.
- **Driver adapter (better-sqlite3):** runtime-only; the migrate engine connects directly via
  the datasource URL in `prisma.config.ts` (already configured:
  `url: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL`). Compatible with Prisma 7. ✓
- **Docker image contents:** `prisma` is a runtime dependency and `prisma/` (including
  `migrations/`) is in `package.json` `files[]` → migrations are embedded in the image. ✓
- **Backup disk usage:** bounded by the 3-backup retention policy.

## Acceptance criteria

- `prisma migrate diff` reports **no drift** between `schema.prisma` and `migrations/` after
  the baseline.
- Fresh container boot (no DB): creates the database from migrations + seeds successfully.
- Container boot with existing DB: takes a WAL-safe backup (when migrations pending) and
  `migrate deploy` is a safe no-op when none pending.
- CI drift guard fails when `schema.prisma` is edited without a matching migration.
- E2E workflow (`e2e.yml`, real Docker boot) passes — covers the production path.
- Full server test suite green; biome / type-check / knip clean.

## Deliverables

- `features/specs/td-48-prisma-migrations.md` (this file).
- `features/plans/td-48-prisma-migrations.md` (implementation plan — next step).
