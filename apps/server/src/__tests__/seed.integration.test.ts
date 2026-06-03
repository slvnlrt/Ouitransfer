/**
 * seed.integration.test.ts
 *
 * Guards the database seeding contract that the container boot relies on
 * (infra/server-start.sh runs `prisma/seed.js` unconditionally on every boot).
 *
 * Three concerns (all runnable in fast PR CI, no Docker):
 *
 * 1. Data integrity (no DB) — the seed data is well-formed: unique config keys,
 *    every entry has the columns `app_configs` requires, unique provider names.
 *    A malformed entry here would make the boot-time seed throw and (with set -e)
 *    abort the container.
 *
 * 2. Packaging — every `../src/...` directory imported by the `prisma/seed.js`
 *    runner is in `package.json` `files`, so `pnpm deploy` ships it into the
 *    image (otherwise the boot seed throws `Cannot find module`).
 *
 * 3. Idempotency + completeness (real SQLite) — seeding a fresh database creates
 *    every config/provider, and running it AGAIN is a no-op (creates nothing,
 *    throws nothing) — the property that lets the boot reseed unconditionally.
 *
 * NOTE: this exercises `seedDatabase` and the packaging, not the runner process
 * itself (dotenv `quiet`, client creation under tsx) — that is covered end-to-end
 * by the image build+boot in the release-validation workflow (e2e.yml).
 *
 * The regression this protects against: a boot path that skips seeding (the
 * `NEEDS_SEEDING` stdout-capture gate, broken by dotenv's banner) left the
 * server with an empty `app_configs` table and a crash loop.
 */

import { execSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { defaultAuthProviders, defaultConfigs, seedDatabase } from "../db/seed-data.js";
import { createPrismaClient } from "../shared/prisma-factory.js";

const SERVER_DIR = resolve(import.meta.dirname!, "..", "..");

// ── 1. Data integrity (no database) ──────────────────────────────────────────

describe("seed data integrity", () => {
  it("has no duplicate config keys", () => {
    const keys = defaultConfigs.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("every config entry has the columns app_configs requires", () => {
    for (const c of defaultConfigs) {
      expect(typeof c.key, `key for ${JSON.stringify(c)}`).toBe("string");
      expect(c.key.length).toBeGreaterThan(0);
      expect(typeof c.value, `value for ${c.key}`).toBe("string");
      expect(typeof c.type, `type for ${c.key}`).toBe("string");
      expect(c.type.length).toBeGreaterThan(0);
      expect(typeof c.group, `group for ${c.key}`).toBe("string");
      expect(c.group.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate auth provider names", () => {
    const names = defaultAuthProviders.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ── 2. Packaging — the boot seed must be shipped to the production image ──────
//
// `prisma/seed.js` runs at container boot via tsx and imports application source
// (`../src/...`). The Docker image is built with `pnpm deploy --prod`, which
// honors package.json `files`: any imported src directory NOT in that allowlist
// is omitted from the image, so the boot seed throws `Cannot find module` and the
// server crash-loops. (This exact gap shipped seed-data under an unlisted dir.)

describe("seed runner is packaged for the production image", () => {
  it("every ../src import in prisma/seed.js is covered by package.json files", () => {
    const pkg = JSON.parse(readFileSync(join(SERVER_DIR, "package.json"), "utf8")) as {
      files?: string[];
    };
    const files = pkg.files ?? [];
    const seedSource = readFileSync(join(SERVER_DIR, "prisma", "seed.js"), "utf8");

    const importedDirs = [...seedSource.matchAll(/from\s+["']\.\.\/src\/([^/"']+)\//g)].map(
      (m) => m[1],
    );

    // Sanity: the runner genuinely depends on src (guards against a silent regex break).
    expect(importedDirs.length).toBeGreaterThan(0);

    for (const dir of new Set(importedDirs)) {
      const covered = files.includes("src") || files.includes(`src/${dir}`);
      expect(
        covered,
        `prisma/seed.js imports ../src/${dir}/ but "src/${dir}" is not in apps/server/package.json "files" — pnpm deploy will omit it and the boot seed will crash`,
      ).toBe(true);
    }
  });
});

// ── 3. Idempotency + completeness (real SQLite, isolated temp DB) ─────────────

describe("seedDatabase is complete and idempotent", () => {
  const dbPath = join(tmpdir(), `ouitransfer-seed-test-${process.pid}-${Date.now()}.db`);
  const dbUrl = `file:${dbPath}`;
  let prisma: ReturnType<typeof createPrismaClient>;

  beforeAll(async () => {
    // Materialise the schema on a throwaway DB (test scaffolding, like
    // prisma-v7.integration.test.ts) so we never touch the dev database.
    execSync("npx prisma db push --accept-data-loss", {
      cwd: SERVER_DIR,
      env: { ...process.env, DATABASE_URL: dbUrl },
      stdio: "pipe",
    });
    prisma = createPrismaClient(dbUrl);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    for (const suffix of ["", "-wal", "-shm"]) {
      const f = `${dbPath}${suffix}`;
      if (existsSync(f)) rmSync(f, { force: true });
    }
  });

  it("seeds every config and provider into an empty database", async () => {
    const result = await seedDatabase(prisma);

    expect(result.configsCreated).toBe(defaultConfigs.length);
    expect(result.providersCreated).toBe(defaultAuthProviders.length);

    expect(await prisma.appConfig.count()).toBe(defaultConfigs.length);
    expect(await prisma.authProvider.count()).toBe(defaultAuthProviders.length);

    // Spot-check keys whose absence previously crashed the server at boot.
    for (const key of ["passwordMinLength", "auditRetentionDays", "autoCleanupEnabled"]) {
      expect(await prisma.appConfig.findUnique({ where: { key } })).not.toBeNull();
    }
  });

  it("is a no-op on re-run (protected mode — creates nothing, throws nothing)", async () => {
    const result = await seedDatabase(prisma);

    expect(result.configsCreated).toBe(0);
    expect(result.providersCreated).toBe(0);
    expect(result.configsSkipped).toBe(defaultConfigs.length);
    expect(result.providersSkipped).toBe(defaultAuthProviders.length);

    // Counts unchanged — no duplicates.
    expect(await prisma.appConfig.count()).toBe(defaultConfigs.length);
    expect(await prisma.authProvider.count()).toBe(defaultAuthProviders.length);
  });
});
