/**
 * repository.integration.test.ts
 *
 * REAL-DATABASE integration tests for the safety-critical quota smart-deletion
 * predicates (5.2 Phase B B2): `QuotaRepository.findOrphanFiles` and
 * `QuotaRepository.findInactiveShareFiles`, plus `QuotaService.pickDeletionCandidates`
 * driven WITHOUT mocking the repository.
 *
 * Unlike the service-layer unit tests (which mock the repo and therefore only
 * prove the picker reads its inputs correctly), this file exercises the actual
 * Prisma `where` clauses against a real SQLite database. It proves the
 * never-delete-active-share invariant at the QUERY level: a file referenced by
 * any active (recently-used) share — directly or via a shared folder — is NEVER
 * returned for deletion, even when other shares referencing it are inactive.
 *
 * Schema bootstrap mirrors `src/__tests__/prisma-v7.integration.test.ts`: a
 * file-level `beforeAll` runs `prisma db push --accept-data-loss` against the
 * DB the shared client points at, so the schema exists locally AND in CI. This
 * file does NOT mock `../../../shared/prisma.js` — the repository and the test
 * seed go through the same real client.
 *
 * Determinism: all timestamps (`createdAt`, `updatedAt`, `lastDownloadedAt`) are
 * set explicitly and the `inactiveBefore` cutoff is computed from a fixed `now`.
 * Every test seeds under a unique `userId` and tears down afterwards, so runs
 * are isolated from each other and from the dev DB's existing rows.
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// NOTE: `../../../shared/prisma.js` is intentionally NOT mocked — the repository
// queries and the test seed both go through the REAL SQLite client. We only mock
// the leaf modules that `service.js` imports transitively for the *notify* path
// (email/config/logger), which pull in `env.ts` (requires JWT/CSRF/COOKIE
// secrets at module load). The deletion-candidate query path never calls them,
// so stubbing them keeps the import graph loadable without faking the DB.
vi.mock("../../config/service.js", () => ({ getConfigValue: vi.fn() }));
vi.mock("../../email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue({ enqueued: true }),
    sendToAdmins: vi.fn().mockResolvedValue({ enqueued: true }),
  },
}));
vi.mock("../../../utils/logger.js", () => ({
  setLogger: vi.fn(),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

import { prisma } from "../../../shared/prisma.js";
import { DEFAULT_DATABASE_URL } from "../../../shared/prisma-constants.js";
import { QuotaRepository } from "../repository.js";
import { QuotaService } from "../service.js";

// ── Schema bootstrap (test scaffolding, not the app's migrate workflow) ──────
const SERVER_DIR = resolve(import.meta.dirname!, "..", "..", "..", "..");

beforeAll(() => {
  const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  execSync("npx prisma db push --accept-data-loss", {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });
});

// ── Fixed clock ──────────────────────────────────────────────────────────────
// "now" and the 30-day inactivity cutoff are pinned so share/file timestamps are
// unambiguously on one side of the boundary.
const NOW = new Date("2026-06-03T00:00:00.000Z");
const INACTIVE_DAYS = 30;
const INACTIVE_BEFORE = new Date(NOW.getTime() - INACTIVE_DAYS * 24 * 60 * 60 * 1000); // 2026-05-04
// Comfortably on each side of the cutoff.
const RECENT = new Date("2026-06-01T00:00:00.000Z"); // > cutoff → active
const STALE = new Date("2026-03-01T00:00:00.000Z"); // < cutoff → inactive

// ── Seed identity (unique per run, torn down in afterAll) ────────────────────
const RUN = randomUUID().slice(0, 8);
const USER_ID = `quota-repo-it-user-${RUN}`;

interface Created {
  fileIds: Record<string, string>;
  shareIds: string[];
  securityIds: string[];
  folderIds: string[];
}

const created: Created = { fileIds: {}, shareIds: [], securityIds: [], folderIds: [] };

/** Create a Share with its required ShareSecurity, set timestamps explicitly. */
async function createShare(opts: {
  isActive?: boolean;
  updatedAt: Date;
  lastDownloadedAt?: Date | null;
  fileIds?: string[];
  folderIds?: string[];
}): Promise<string> {
  const security = await prisma.shareSecurity.create({ data: {} });
  created.securityIds.push(security.id);

  const share = await prisma.share.create({
    data: {
      creatorId: USER_ID,
      securityId: security.id,
      isActive: opts.isActive ?? true,
      lastDownloadedAt: opts.lastDownloadedAt ?? null,
      files: opts.fileIds ? { connect: opts.fileIds.map((id) => ({ id })) } : undefined,
      folders: opts.folderIds ? { connect: opts.folderIds.map((id) => ({ id })) } : undefined,
    },
  });
  // updatedAt is @updatedAt (managed); force it deterministically post-create.
  await prisma.share.update({
    where: { id: share.id },
    data: { updatedAt: opts.updatedAt },
  });
  created.shareIds.push(share.id);
  return share.id;
}

async function createFile(key: string, createdAt: Date, folderId?: string): Promise<string> {
  const file = await prisma.file.create({
    data: {
      name: `${key}.bin`,
      extension: "bin",
      size: 100n,
      objectName: `${USER_ID}/${key}.bin`,
      userId: USER_ID,
      folderId: folderId ?? null,
      createdAt,
    },
  });
  created.fileIds[key] = file.id;
  return file.id;
}

async function createFolder(): Promise<string> {
  const folder = await prisma.folder.create({
    data: {
      name: `folder-${randomUUID().slice(0, 8)}`,
      objectName: `${USER_ID}/f`,
      userId: USER_ID,
    },
  });
  created.folderIds.push(folder.id);
  return folder.id;
}

beforeAll(async () => {
  await prisma.user.create({
    data: {
      id: USER_ID,
      firstName: "Quota",
      lastName: "RepoIT",
      username: `quota-repo-it-${RUN}`,
      email: `quota-repo-it-${RUN}@example.test`,
    },
  });

  // ── Scenario set ───────────────────────────────────────────────────────────
  // Files are created with ascending createdAt so oldest-first ordering is
  // observable. Naming: a=orphan, b=active-direct, c=inactive-direct,
  // d=active-folder, e=inactive-folder, f=two-shares-one-active.

  // (a) pure orphan: no share, no folder.
  await createFile("a", new Date("2026-01-01T00:00:00.000Z"));

  // (b) file in an ACTIVE direct share.
  await createFile("b", new Date("2026-01-02T00:00:00.000Z"));
  await createShare({ updatedAt: RECENT, fileIds: [created.fileIds.b] });

  // (c) file in an INACTIVE direct share.
  await createFile("c", new Date("2026-01-03T00:00:00.000Z"));
  await createShare({ updatedAt: STALE, fileIds: [created.fileIds.c] });

  // (d) file in an ACTIVE folder share.
  {
    const folder = await createFolder();
    await createFile("d", new Date("2026-01-04T00:00:00.000Z"), folder);
    await createShare({ updatedAt: RECENT, folderIds: [folder] });
  }

  // (e) file in an INACTIVE folder share.
  {
    const folder = await createFolder();
    await createFile("e", new Date("2026-01-05T00:00:00.000Z"), folder);
    await createShare({ updatedAt: STALE, folderIds: [folder] });
  }

  // (f) file in TWO direct shares — one active (recent download), one inactive.
  await createFile("f", new Date("2026-01-06T00:00:00.000Z"));
  await createShare({ updatedAt: STALE, fileIds: [created.fileIds.f] }); // inactive
  await createShare({
    updatedAt: STALE,
    lastDownloadedAt: RECENT, // recent download → active despite stale updatedAt
    fileIds: [created.fileIds.f],
  });
});

afterAll(async () => {
  // Disconnect file/folder ↔ share links implicitly via deletes (M2M join rows
  // are removed when either side is deleted). Order: shares → folders → files →
  // securities → user.
  await prisma.share.deleteMany({ where: { creatorId: USER_ID } });
  await prisma.folder.deleteMany({ where: { userId: USER_ID } });
  await prisma.file.deleteMany({ where: { userId: USER_ID } });
  if (created.securityIds.length > 0) {
    await prisma.shareSecurity.deleteMany({ where: { id: { in: created.securityIds } } });
  }
  await prisma.user.deleteMany({ where: { id: USER_ID } });
  await prisma.$disconnect();
});

// ── findOrphanFiles ──────────────────────────────────────────────────────────

describe("QuotaRepository.findOrphanFiles (real DB)", () => {
  let repository: QuotaRepository;
  beforeEach(() => {
    repository = new QuotaRepository();
  });

  it("returns ONLY the pure orphan (a) — never any shared or folder-shared file", async () => {
    const result = await repository.findOrphanFiles(USER_ID);
    expect(result.map((f) => f.id)).toEqual([created.fileIds.a]);
  });

  it("excludes files in inactive shares too (orphan = truly unreferenced)", async () => {
    const ids = (await repository.findOrphanFiles(USER_ID)).map((f) => f.id);
    // c (inactive direct) and e (inactive folder) are referenced, so NOT orphans.
    expect(ids).not.toContain(created.fileIds.c);
    expect(ids).not.toContain(created.fileIds.e);
  });
});

// ── findInactiveShareFiles ───────────────────────────────────────────────────

describe("QuotaRepository.findInactiveShareFiles (real DB)", () => {
  let repository: QuotaRepository;
  beforeEach(() => {
    repository = new QuotaRepository();
  });

  it("returns EXACTLY the inactive-share files (c, e), oldest-first", async () => {
    const result = await repository.findInactiveShareFiles(USER_ID, INACTIVE_BEFORE);
    // c (createdAt 01-03) before e (createdAt 01-05).
    expect(result.map((f) => f.id)).toEqual([created.fileIds.c, created.fileIds.e]);
  });

  it("NEVER returns a file in an active direct share (b) — the invariant", async () => {
    const ids = (await repository.findInactiveShareFiles(USER_ID, INACTIVE_BEFORE)).map(
      (f) => f.id,
    );
    expect(ids).not.toContain(created.fileIds.b);
  });

  it("NEVER returns a file in an active FOLDER share (d) — the invariant", async () => {
    const ids = (await repository.findInactiveShareFiles(USER_ID, INACTIVE_BEFORE)).map(
      (f) => f.id,
    );
    expect(ids).not.toContain(created.fileIds.d);
  });

  it("NEVER returns a file in two shares where one is still active (f) — the invariant", async () => {
    const ids = (await repository.findInactiveShareFiles(USER_ID, INACTIVE_BEFORE)).map(
      (f) => f.id,
    );
    expect(ids).not.toContain(created.fileIds.f);
  });

  it("excludes the pure orphan (a) — orphans are handled by findOrphanFiles", async () => {
    const ids = (await repository.findInactiveShareFiles(USER_ID, INACTIVE_BEFORE)).map(
      (f) => f.id,
    );
    expect(ids).not.toContain(created.fileIds.a);
  });
});

// ── pickDeletionCandidates (no repo mocking) ─────────────────────────────────

describe("QuotaService.pickDeletionCandidates (real DB, repo NOT mocked)", () => {
  let service: QuotaService;
  beforeEach(() => {
    service = new QuotaService();
  });

  it("frees orphan first, then inactive — and NEVER selects an active-share file", async () => {
    // bytesToFree huge → drain every safe candidate. a(100)+c(100)+e(100)=300.
    const result = await service.pickDeletionCandidates(USER_ID, 10_000n, INACTIVE_DAYS, NOW);
    const ids = result.map((f) => f.id);

    // Exactly the safe set: orphan a first, then inactive-share c, e (oldest-first).
    expect(ids).toEqual([created.fileIds.a, created.fileIds.c, created.fileIds.e]);
    // The invariant, end-to-end: no active-share file is ever a candidate.
    expect(ids).not.toContain(created.fileIds.b);
    expect(ids).not.toContain(created.fileIds.d);
    expect(ids).not.toContain(created.fileIds.f);
  });

  it("stops once enough bytes are freed (orphan alone covers a small target)", async () => {
    // 100 bytes needed → orphan a (100) suffices; inactive files not selected.
    const result = await service.pickDeletionCandidates(USER_ID, 100n, INACTIVE_DAYS, NOW);
    expect(result.map((f) => f.id)).toEqual([created.fileIds.a]);
  });
});
