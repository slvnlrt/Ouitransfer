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
    // SAST false positive: `f` is a real directory entry (no traversal), `dir`
    // derives from an operator-supplied CLI arg / DATABASE_URL, not request input.
    .map((f) => join(dir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  const stale = backups.slice(retain);
  for (const f of stale) unlinkSync(f);
  return stale;
}

/** Create a consistent (WAL-safe) backup of the SQLite database, then prune old backups. */
export async function backupDatabase(
  dbPath: string,
  retain = DEFAULT_RETAIN,
): Promise<BackupResult> {
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
