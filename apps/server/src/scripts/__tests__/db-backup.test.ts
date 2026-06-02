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
