# TD-48 — Adopt Prisma Migrate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `prisma db push` with a proper Prisma Migrate workflow (clean baseline + `migrate deploy` at container boot + WAL-safe backup), so production schema upgrades are safe and non-destructive, and add a CI guard so schema↔migrations drift can never silently return.

**Architecture:** SQLite-only, self-hosted Docker. Migrations are committed code, authored locally with `migrate dev`, applied at boot with `migrate deploy`. Before applying pending migrations, the container takes a consistent (WAL-safe) backup of the SQLite file. A CI `migrate diff --exit-code` step fails the build if `schema.prisma` is changed without a matching migration.

**Tech Stack:** Prisma 7.8 (SQLite, driver adapter better-sqlite3), Node 24, tsx, pnpm 11.5.0, Justfile, GitHub Actions, Docker (Alpine).

**Spec:** `features/specs/td-48-prisma-migrations.md`

---

## Reference facts (verified against the codebase)

- Schema: `apps/server/prisma/schema.prisma` — `datasource db { provider = "sqlite" }` (no `url`; URL comes from `prisma.config.ts`).
- `apps/server/prisma.config.ts` sets `schema`, `migrations.path = "prisma/migrations"`, `migrations.seed = "tsx prisma/seed.js"`, and `datasource.url = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL`.
- `DEFAULT_DATABASE_URL = "file:./prisma/ouitransfer.db"` (`apps/server/src/shared/prisma-constants.ts`).
- Stale migrations end at `20260520083415_add_ldap_support`; `migration_lock.toml` has `provider = "sqlite"`.
- Container boot: `infra/server-start.sh` exports `DATABASE_URL="file:/app/server/prisma/ouitransfer.db"`, defines `PRISMA_CLI="node_modules/prisma/build/index.js"` and `TSX="node node_modules/tsx/dist/cli.mjs"`, cwd `/app/ouitransfer-app`. Currently runs `db push` in both first-run and existing-DB branches (lines 63–78).
- Seed gate: `infra/check-missing.js check-seeding` prints `true` when `appConfig`/`user`/`authProvider` counts are 0 or configs/providers are missing (so a fresh DB always seeds).
- Image: `pnpm deploy` output at `/app/ouitransfer-app/`; `package.json` `files[]` ships `prisma`, `prisma.config.ts`, `src/scripts`, `src/shared`. `prisma`, `tsx`, `better-sqlite3` are runtime deps. `.dockerignore` excludes `apps/server/prisma/*.db` but **not** `prisma/migrations/`.
- Tests: co-located `__tests__/` dirs, `*.test.ts`, Vitest. Run with `pnpm --filter ouitransfer-api test`.
- CI: `.github/workflows/ci.yml` single `ci` job; add the drift step after `pnpm install`.

---

## Task 1: Reset migrations to a single clean baseline

**Files:**
- Delete: `apps/server/prisma/migrations/20260428082804_init/` … `20260520083415_add_ldap_support/` (all 6 migration dirs; keep the folder)
- Create: `apps/server/prisma/migrations/<timestamp>_init/migration.sql` + keep `apps/server/prisma/migrations/migration_lock.toml`
- Local only (not committed): `apps/server/prisma/ouitransfer.db`

- [ ] **Step 1: Remove the stale migration directories**

```powershell
Remove-Item -Recurse -Force apps/server/prisma/migrations/20260428082804_init, `
  apps/server/prisma/migrations/20260511183339_add_token_version_and_login_attempts, `
  apps/server/prisma/migrations/20260511184719_add_refresh_token_and_audit_log, `
  apps/server/prisma/migrations/20260518081530_add_user_quota_overrides, `
  apps/server/prisma/migrations/20260518213513_add_groups, `
  apps/server/prisma/migrations/20260520083415_add_ldap_support
```

Keep `migration_lock.toml` (it already declares `provider = "sqlite"`).

- [ ] **Step 2: Delete the local dev database so `migrate dev` starts clean**

```powershell
Remove-Item -Force apps/server/prisma/ouitransfer.db -ErrorAction SilentlyContinue
Remove-Item -Force apps/server/prisma/ouitransfer.db-wal, apps/server/prisma/ouitransfer.db-shm -ErrorAction SilentlyContinue
```

- [ ] **Step 3: Generate the baseline migration from the current schema**

Run:
```
pnpm --filter=ouitransfer-api exec prisma migrate dev --name init
```
Expected: Prisma creates `prisma/migrations/<timestamp>_init/migration.sql` containing the FULL current schema (all models including `User`, `Share`, `ReverseShare` with `notifyOnUpload`/`bypassUploadCooldown`, `BackgroundImage`, `EmailJob`, `NotificationPreference`, `ShareVisit`, `AuditLog`, `Group`, LDAP config, etc.), applies it to a fresh `ouitransfer.db`, and runs the seed (`tsx prisma/seed.js`) automatically. Output ends with "Your database is now in sync with your schema."

- [ ] **Step 4: Verify zero drift between schema and migrations**

Run:
```
pnpm --filter=ouitransfer-api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
```
Expected: exit code `0` and output "No difference detected." (If exit code is `2`, the baseline is incomplete — re-run Step 3 after deleting the generated migration.)

- [ ] **Step 5: Sanity-check the generated SQL is a single CREATE-only baseline**

Run:
```
Get-ChildItem apps/server/prisma/migrations -Directory
Select-String -Path apps/server/prisma/migrations/*/migration.sql -Pattern '^CREATE TABLE' | Measure-Object
```
Expected: exactly one migration directory (plus `migration_lock.toml`); the migration contains only `CREATE TABLE`/`CREATE INDEX`/`CREATE UNIQUE INDEX` statements (no `ALTER`/`DROP`).

- [ ] **Step 6: Commit**

```powershell
git add apps/server/prisma/migrations
git commit -m "refactor(server): reset Prisma migrations to a clean baseline (TD-48)"
```

---

## Task 2: WAL-safe SQLite backup script (TDD)

**Files:**
- Create: `apps/server/src/scripts/db-backup.ts`
- Test: `apps/server/src/scripts/__tests__/db-backup.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/server/src/scripts/__tests__/db-backup.test.ts`:

```ts
import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { backupDatabase, pruneBackups, resolveDbPath } from "../db-backup.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ouitransfer-backup-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeDb(path: string, rows: number): void {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  const insert = db.prepare("INSERT INTO t (id) VALUES (?)");
  for (let i = 1; i <= rows; i++) insert.run(i);
  db.close();
}

describe("resolveDbPath", () => {
  it("strips the file: prefix and returns an absolute path", () => {
    expect(resolveDbPath("file:/app/server/prisma/ouitransfer.db", undefined)).toBe(
      "/app/server/prisma/ouitransfer.db",
    );
  });

  it("falls back to DATABASE_URL when no argument is given", () => {
    expect(resolveDbPath(undefined, "file:/data/db.sqlite")).toBe("/data/db.sqlite");
  });

  it("throws when neither argument nor env is provided", () => {
    expect(() => resolveDbPath(undefined, undefined)).toThrow(/No database path/);
  });
});

describe("backupDatabase", () => {
  it("creates a consistent backup containing all committed rows", async () => {
    const dbPath = join(dir, "ouitransfer.db");
    makeDb(dbPath, 3);

    const { backupPath } = await backupDatabase(dbPath);

    expect(existsSync(backupPath)).toBe(true);
    expect(backupPath).toContain(".pre-migrate-");
    const restored = new Database(backupPath, { readonly: true });
    const count = restored.prepare("SELECT count(*) AS n FROM t").get() as { n: number };
    restored.close();
    expect(count.n).toBe(3);
  });
});

describe("pruneBackups", () => {
  it("keeps only the newest N backups and deletes the rest", () => {
    const dbPath = join(dir, "ouitransfer.db");
    makeDb(dbPath, 1);
    // Create 5 fake backups with increasing mtimes.
    for (let i = 0; i < 5; i++) {
      const f = join(dir, `ouitransfer.db.pre-migrate-2026-06-0${i + 1}T00-00-00-000Z.bak`);
      writeFileSync(f, "x");
      const t = new Date(2026, 5, i + 1).getTime() / 1000;
      utimesSync(f, t, t);
    }

    const pruned = pruneBackups(dbPath, 3);

    expect(pruned).toHaveLength(2);
    const remaining = readdirSync(dir).filter((f) => f.includes(".pre-migrate-"));
    expect(remaining).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter ouitransfer-api exec vitest run src/scripts/__tests__/db-backup.test.ts`
Expected: FAIL — cannot resolve `../db-backup.js` (module does not exist yet).

- [ ] **Step 3: Implement the backup script**

Create `apps/server/src/scripts/db-backup.ts`:

```ts
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const BACKUP_SUFFIX = ".pre-migrate-";
const BACKUP_EXT = ".bak";
const DEFAULT_RETAIN = 3;

export interface BackupResult {
  backupPath: string;
  pruned: string[];
}

/** Resolve the SQLite file path from a CLI argument or DATABASE_URL (strips the `file:` prefix). */
export function resolveDbPath(arg: string | undefined, databaseUrl: string | undefined): string {
  const raw = arg ?? databaseUrl;
  if (!raw) {
    throw new Error("No database path: pass a path argument or set DATABASE_URL");
  }
  const stripped = raw.replace(/^file:/, "");
  return isAbsolute(stripped) ? stripped : resolve(process.cwd(), stripped);
}

/** Delete the oldest backups, keeping the `retain` most recent. Returns the deleted paths. */
export function pruneBackups(dbPath: string, retain = DEFAULT_RETAIN): string[] {
  const dir = dirname(dbPath);
  const prefix = `${basename(dbPath)}${BACKUP_SUFFIX}`;
  const backups = readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith(BACKUP_EXT))
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const stale = backups.slice(retain);
  for (const f of stale) unlinkSync(f);
  return stale;
}

/** Create a consistent (WAL-safe) backup of the SQLite database, then prune old backups. */
export async function backupDatabase(dbPath: string, retain = DEFAULT_RETAIN): Promise<BackupResult> {
  if (!existsSync(dbPath)) {
    throw new Error(`Database file not found: ${dbPath}`);
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}${BACKUP_SUFFIX}${stamp}${BACKUP_EXT}`;
  const db = new Database(dbPath);
  try {
    // Fold any pending WAL frames into the main file, then take an online backup
    // (the backup API reads a consistent snapshot even under concurrent writes).
    db.pragma("wal_checkpoint(TRUNCATE)");
    await db.backup(backupPath);
  } finally {
    db.close();
  }
  const pruned = pruneBackups(dbPath, retain);
  return { backupPath, pruned };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dbFlagIndex = args.indexOf("--db");
  const dbArg = dbFlagIndex >= 0 ? args[dbFlagIndex + 1] : undefined;
  const dbPath = resolveDbPath(dbArg, process.env.DATABASE_URL);
  if (!existsSync(dbPath)) {
    console.log(`No database at ${dbPath} — nothing to back up.`);
    return;
  }
  const { backupPath, pruned } = await backupDatabase(dbPath);
  console.log(`Backup created: ${backupPath}`);
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} old backup(s).`);
  }
}

// Run only when invoked directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error("Database backup failed:", err);
    process.exit(1);
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter ouitransfer-api exec vitest run src/scripts/__tests__/db-backup.test.ts`
Expected: PASS (5 tests across 3 describes).

- [ ] **Step 5: Lint & type-check the new files**

Run: `pnpm --filter ouitransfer-api exec biome check src/scripts/db-backup.ts src/scripts/__tests__/db-backup.test.ts` then `pnpm --filter ouitransfer-api type-check`
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add apps/server/src/scripts/db-backup.ts apps/server/src/scripts/__tests__/db-backup.test.ts
git commit -m "feat(server): add WAL-safe SQLite backup script (TD-48)"
```

---

## Task 3: Rewire container boot to migrate deploy + backup + seed

**Files:**
- Modify: `infra/server-start.sh:63-78` (the "Database setup" block)

- [ ] **Step 1: Replace the database-setup block**

In `infra/server-start.sh`, replace the entire block from `# Database setup` through the closing `fi` of the first-run/else (current lines 63–78) with:

```sh
# Database setup — apply migrations (creates the DB on first run, applies pending migrations otherwise)
DB_FILE="/app/server/prisma/ouitransfer.db"

# Safety net: before applying pending migrations to an EXISTING database, take a
# WAL-safe backup. migrate status exits non-zero when migrations are pending.
if [ -f "$DB_FILE" ]; then
    if run_as_user node "$PRISMA_CLI" migrate status --schema=./prisma/schema.prisma >/dev/null 2>&1; then
        echo "Database schema is up to date."
    else
        echo "Pending migrations detected — backing up database first..."
        run_as_user $TSX ./src/scripts/db-backup.ts
    fi
fi

echo "Applying database migrations..."
run_as_user node "$PRISMA_CLI" migrate deploy --schema=./prisma/schema.prisma

# Seed when required: fresh DB, or missing config/provider/admin rows.
NEEDS_SEEDING=$(run_as_user $TSX ./prisma/check-missing.js check-seeding 2>/dev/null || echo "true")
if [ "$NEEDS_SEEDING" = "true" ]; then
    echo "Seeding database..."
    run_as_user $TSX ./prisma/seed.js
fi
echo "Database setup complete."
```

- [ ] **Step 2: Verify the script has no syntax errors**

Run: `sh -n infra/server-start.sh` (if `sh` is unavailable on Windows, run via WSL/Git Bash, or skip and rely on Step 3 + E2E).
Expected: no output (valid POSIX shell).

- [ ] **Step 3: Smoke-test `migrate deploy` end-to-end against a throwaway DB**

This verifies the exact command the container runs creates a DB from the baseline.
```powershell
$env:DATABASE_URL = "file:./prisma/smoke-test.db"
pnpm --filter=ouitransfer-api exec prisma migrate deploy
```
Expected: output lists the `<timestamp>_init` migration as applied and "All migrations have been successfully applied." Then clean up:
```powershell
Remove-Item -Force apps/server/prisma/smoke-test.db* -ErrorAction SilentlyContinue
Remove-Item Env:\DATABASE_URL
```

- [ ] **Step 4: Confirm migrations ship into the image build context**

Run: `git check-ignore apps/server/prisma/migrations/migration_lock.toml; echo "exit=$LASTEXITCODE"`
Expected: no path printed and `exit=1` (i.e., NOT ignored). Cross-check `.dockerignore` does not list `prisma/migrations`.

- [ ] **Step 5: Commit**

```powershell
git add infra/server-start.sh
git commit -m "feat(infra): apply Prisma migrations at boot with WAL-safe backup (TD-48)"
```

---

## Task 4: Switch local dev init to migrate deploy

**Files:**
- Modify: `Justfile` (`db-dev-init` recipe, lines 118–122)

- [ ] **Step 1: Update the `db-dev-init` recipe**

In `Justfile`, change the body of `db-dev-init` from:
```
db-dev-init:
    pnpm --filter=ouitransfer-api exec prisma db push
    pnpm --filter=ouitransfer-api run db:seed
```
to:
```
db-dev-init:
    pnpm --filter=ouitransfer-api exec prisma migrate deploy
    pnpm --filter=ouitransfer-api run db:seed
```

Leave `db-migrate-dev` (`prisma migrate dev`), `db-migrate` (`prisma migrate deploy` via `db:migrate`), and `db-reset` (`prisma migrate reset`) unchanged — they are already correct and become the canonical schema-change / reset commands.

- [ ] **Step 2: Verify a clean dev DB can be created from migrations**

```powershell
Remove-Item -Force apps/server/prisma/ouitransfer.db* -ErrorAction SilentlyContinue
just db-dev-init
```
Expected: `migrate deploy` applies `<timestamp>_init`, then the seed runs successfully; `apps/server/prisma/ouitransfer.db` exists.

- [ ] **Step 3: Commit**

```powershell
git add Justfile
git commit -m "chore(dev): create local DB from migrations instead of db push (TD-48)"
```

---

## Task 5: Add the CI drift guard

**Files:**
- Modify: `.github/workflows/ci.yml` (add a step after `pnpm install --frozen-lockfile`, before/around the lint-test step)

- [ ] **Step 1: Add the migration drift-check step**

In `.github/workflows/ci.yml`, immediately after the `- run: pnpm install --frozen-lockfile` step (line 27), insert:

```yaml
      - name: Prisma migration drift check
        # Fails if schema.prisma was changed without a matching migration (TD-48 guard).
        run: >-
          pnpm --filter ouitransfer-api exec prisma migrate diff
          --from-migrations prisma/migrations
          --to-schema prisma/schema.prisma
          --exit-code
```

- [ ] **Step 2: Verify the exact command passes locally on a clean baseline**

Run:
```
pnpm --filter ouitransfer-api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
```
Expected: exit `0`, "No difference detected."

- [ ] **Step 3: Verify the guard actually catches drift (negative test)**

Temporarily append a scratch model to the schema, run the check, then revert. NOTE: the model MUST use valid multi-line PSL syntax (a one-line `model X { ... }` raises a P1012 parse error, not a clean diff) and a name that does not start with `_`:
```powershell
Add-Content apps/server/prisma/schema.prisma "`nmodel DriftProbe {`n  id String @id`n}"
pnpm --filter ouitransfer-api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code
# Expected: diff prints "[+] Added tables" and the command exits NON-ZERO — the guard works.
rtk git checkout -- apps/server/prisma/schema.prisma
```
Expected: `prisma migrate diff` detects the added table and exits `2`; because the command runs through `pnpm --filter ... exec`, pnpm remaps that to its own non-zero exit (`1`, `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). Either way the CI step fails on drift (non-zero) and passes only on a clean schema (exit `0`). Then the schema is restored.

- [ ] **Step 4: Commit**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: fail on Prisma schema/migrations drift (TD-48)"
```

---

## Task 6: Update docs, conventions, and tracking

**Files:**
- Modify: `CLAUDE.md` (the "No Production, No Legacy" bullet about migrations)
- Modify: `features/TECHNICAL-DEBT.md` (mark TD-48 resolved)
- Modify: `features/SESSIONS.md` (add session entry)
- Modify: `features/README.md` (status table, if TD-48 is listed)
- Check: `apps/docs/**` for `db push` references

- [ ] **Step 1: Update CLAUDE.md migration guidance**

In `CLAUDE.md`, under "Important: No Production, No Legacy", replace the bullet:
```
- **No incremental migrations** — Prisma schema can be reset/recreated from scratch
```
with:
```
- **Migrations are the workflow** — schema changes go through `prisma migrate dev` (authored, committed); the container applies them at boot via `prisma migrate deploy`. The migration history was reset to a single clean baseline (TD-48); from there it is incremental. Resetting the local dev DB is still free (no prod data).
```

- [ ] **Step 2: Mark TD-48 resolved in TECHNICAL-DEBT.md**

In `features/TECHNICAL-DEBT.md`, update the TD-48 entry (starts line 793): change the heading status and append a resolution note describing the baseline reset, `migrate deploy` at boot, WAL-safe backup (`apps/server/src/scripts/db-backup.ts`), and the CI drift guard. Follow the resolution-note style used by other closed TD entries in the file.

- [ ] **Step 3: Add a SESSIONS.md entry**

In `features/SESSIONS.md`, add a dated entry summarizing TD-48: adopted Prisma Migrate (clean baseline), boot now runs `migrate deploy` with a WAL-safe pre-migrate backup, dev uses `migrate dev`/`migrate deploy`, CI drift guard added.

- [ ] **Step 4: Update the features/README.md status table**

If `features/README.md` tracks TD items, mark TD-48 Done. (If it does not list TD items, skip.)

- [ ] **Step 5: Scrub docs for stale `db push` references**

Run: `Select-String -Path apps/docs/**/*.{md,mdx} -Pattern 'db push','db:push','prisma db push' -List`
For each hit that documents the dev/prod workflow, update it to the migrate workflow (`just db-migrate-dev` to change schema, `just db-dev-init` to create a local DB). If there are no hits, note "none found".

- [ ] **Step 6: Commit**

```powershell
git add CLAUDE.md features/TECHNICAL-DEBT.md features/SESSIONS.md features/README.md
git commit -m "docs: record TD-48 Prisma Migrate adoption"
```
(Add any `apps/docs` files changed in Step 5 to this commit.)

---

## Task 7: Final full verification

**Files:** none (verification only)

- [ ] **Step 1: Full server test suite**

Run: `pnpm --filter ouitransfer-api test`
Expected: all suites pass, including the new `db-backup.test.ts`.

- [ ] **Step 2: Lint, type-check, dead-code**

Run: `pnpm --filter ouitransfer-api exec biome check .` then `pnpm --filter ouitransfer-api type-check` then `pnpm knip`
Expected: clean. (Knip must not report `db-backup.ts` as unused — it is referenced by `infra/server-start.sh`; if knip flags it, add an entry to the knip ignore config for server scripts consistent with how `cleanup-orphan-files.ts` is handled.)

- [ ] **Step 3: Final drift check**

Run: `pnpm --filter ouitransfer-api exec prisma migrate diff --from-migrations prisma/migrations --to-schema prisma/schema.prisma --exit-code`
Expected: exit `0`.

- [ ] **Step 4: Confirm no `db push` remains in the committed workflow**

Run: `Select-String -Path Justfile,infra/server-start.sh,apps/server/package.json -Pattern 'db push','db:push'`
Expected: no matches.

---

## Task 8: Prisma client generation guard (root-cause fix, added during execution)

**Context:** During implementation, `type-check` failed because the gitignored Prisma client (`apps/server/src/generated/prisma`) had drifted from the schema (missing `bypassUploadCooldown`/`notifyOnUpload`). Root cause: the client is regenerated only by the `postinstall` hook (`pnpm install`); nothing in the turbo inner loop (`type-check`/`build`/`test`) regenerates it, so a schema change without a reinstall silently breaks (or stales) type-check. This guards the whole class of stale-client bugs.

**Files:**
- Modify: `apps/server/package.json` (add `db:generate` script)
- Modify: `turbo.json` (add `db:generate` task; make `type-check`/`build`/`test` depend on it)

- [x] **Step 1:** Add `"db:generate": "prisma generate"` to `apps/server/package.json` scripts.
- [x] **Step 2:** Add turbo task `db:generate` with `inputs: ["prisma/schema.prisma", "prisma.config.ts"]` and `outputs: ["src/generated/**"]`.
- [x] **Step 3:** Add `"db:generate"` to `dependsOn` of `build`, `test`, and `type-check`.
- [x] **Step 4 (verify):** Delete `apps/server/src/generated`, run `pnpm exec turbo run type-check --filter=ouitransfer-api` → turbo runs `db:generate` (regenerates client) then `type-check` passes (2 tasks successful).
- [x] **Step 5:** Commit `fix(monorepo): regenerate Prisma client in turbo pipeline before type-check/build/test (TD-48)` (`58f2da4`).

---

## Risks & notes for the implementer

- **Baseline assumes no pre-existing `db push` production database.** There is no production and no users (per CLAUDE.md), so the first real deployment creates the DB fresh via `migrate deploy`. If a pre-release `db push` database ever needs adopting, baseline it once with `prisma migrate resolve --applied <timestamp>_init` before `migrate deploy` — do not add this to the boot path.
- **`migrate status` exit semantics:** non-zero on pending migrations (desired → triggers backup) and also on errors (harmless → a conservative extra backup). The `[ -f "$DB_FILE" ]` guard prevents a spurious backup on first run.
- **WAL safety:** `db-backup.ts` checkpoints (`wal_checkpoint(TRUNCATE)`) then uses better-sqlite3's online `.backup()` — consistent even with `-wal`/`-shm` present.
- **Driver adapter vs migrate engine:** the runtime client uses the better-sqlite3 adapter; the migrate CLI connects via the URL from `prisma.config.ts`. Both resolve to the same file. No conflict.
- **Do not `git add -A`** (repo has a reserved-name gotcha) — stage files explicitly as shown.
```
