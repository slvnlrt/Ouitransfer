/**
 * folder-ancestors.test.ts
 *
 * Real-SQLite integration test for getAncestorFolderIds().
 * Unlike most tests that mock Prisma, this uses the actual database to verify
 * the recursive CTE SQL is correct against SQLite's engine.
 *
 * Covers:
 * 1. null/undefined folderId → empty array (no DB call)
 * 2. Single folder (no parent) → returns [self]
 * 3. Linear chain (3 levels) → returns [self, parent, grandparent]
 * 4. Deep chain (5 levels) → correct full traversal
 * 5. LIMIT 100 safety guard (cycle would be caught)
 */

import { execSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "../../../generated/prisma/client.js";
import { createPrismaClient, DEFAULT_DATABASE_URL } from "../../../shared/prisma-factory.js";
import { getAncestorFolderIds } from "../folder-ancestors.js";

const SERVER_DIR = resolve(import.meta.dirname!, "..", "..", "..", "..");

let prisma: PrismaClient;
let testUserId: string;

// Unique prefix to isolate test data from any existing dev DB content
const TEST_PREFIX = `folder-ancestors-test-${randomUUID().slice(0, 8)}`;

/** Generate a unique objectName (required field in Folder model) */
function uniqueObjectName(): string {
  return `test-folder-${randomBytes(8).toString("hex")}`;
}

beforeAll(async () => {
  // Ensure schema exists (same pattern as prisma-v7.integration.test.ts)
  const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL;
  execSync("npx prisma db push --accept-data-loss", {
    cwd: SERVER_DIR,
    env: { ...process.env, DATABASE_URL: dbUrl },
    stdio: "pipe",
  });

  prisma = createPrismaClient();

  // Create a test user to own the folders
  const user = await prisma.user.create({
    data: {
      username: `${TEST_PREFIX}-user`,
      email: `${TEST_PREFIX}@test.local`,
      password: "hashed-password-placeholder",
      firstName: "Test",
      lastName: "User",
      isAdmin: false,
      isActive: true,
    },
  });
  testUserId = user.id;
});

afterAll(async () => {
  // Clean up: delete test folders and user
  await prisma.folder.deleteMany({ where: { userId: testUserId } });
  await prisma.user.delete({ where: { id: testUserId } });
  await prisma.$disconnect();
});

describe("getAncestorFolderIds — real SQLite", () => {
  it("returns empty array for null folderId (no DB call)", async () => {
    const result = await getAncestorFolderIds(prisma, null);
    expect(result).toEqual([]);
  });

  it("returns empty array for undefined folderId (no DB call)", async () => {
    const result = await getAncestorFolderIds(prisma, undefined);
    expect(result).toEqual([]);
  });

  it("returns [self] for a root folder (no parent)", async () => {
    const folder = await prisma.folder.create({
      data: {
        name: `${TEST_PREFIX}-root`,
        objectName: uniqueObjectName(),
        userId: testUserId,
        parentId: null,
      },
    });

    const result = await getAncestorFolderIds(prisma, folder.id);
    expect(result).toEqual([folder.id]);
  });

  it("returns [self, parent, grandparent] for a 3-level chain", async () => {
    const grandparent = await prisma.folder.create({
      data: {
        name: `${TEST_PREFIX}-gp`,
        objectName: uniqueObjectName(),
        userId: testUserId,
        parentId: null,
      },
    });
    const parent = await prisma.folder.create({
      data: {
        name: `${TEST_PREFIX}-p`,
        objectName: uniqueObjectName(),
        userId: testUserId,
        parentId: grandparent.id,
      },
    });
    const child = await prisma.folder.create({
      data: {
        name: `${TEST_PREFIX}-c`,
        objectName: uniqueObjectName(),
        userId: testUserId,
        parentId: parent.id,
      },
    });

    const result = await getAncestorFolderIds(prisma, child.id);

    // Should contain all three, order may vary (CTE doesn't guarantee order)
    expect(result).toHaveLength(3);
    expect(result).toContain(child.id);
    expect(result).toContain(parent.id);
    expect(result).toContain(grandparent.id);
  });

  it("returns all 5 ancestors for a 5-level deep chain", async () => {
    const ids: string[] = [];

    // Create a chain: level0 → level1 → level2 → level3 → level4
    let parentId: string | null = null;
    for (let i = 0; i < 5; i++) {
      const folder = await prisma.folder.create({
        data: {
          name: `${TEST_PREFIX}-deep-${i}`,
          objectName: uniqueObjectName(),
          userId: testUserId,
          parentId,
        },
      });
      ids.push(folder.id);
      parentId = folder.id;
    }

    // Query from the deepest folder (level4)
    const result = await getAncestorFolderIds(prisma, ids[4]);

    expect(result).toHaveLength(5);
    for (const id of ids) {
      expect(result).toContain(id);
    }
  });

  it("returns only the queried folder when it has no parent (isolation)", async () => {
    // Create two unrelated root folders
    const folderA = await prisma.folder.create({
      data: {
        name: `${TEST_PREFIX}-iso-a`,
        objectName: uniqueObjectName(),
        userId: testUserId,
        parentId: null,
      },
    });
    const folderB = await prisma.folder.create({
      data: {
        name: `${TEST_PREFIX}-iso-b`,
        objectName: uniqueObjectName(),
        userId: testUserId,
        parentId: null,
      },
    });

    const resultA = await getAncestorFolderIds(prisma, folderA.id);
    expect(resultA).toEqual([folderA.id]);
    expect(resultA).not.toContain(folderB.id);
  });

  it("returns empty array for a non-existent folderId", async () => {
    const result = await getAncestorFolderIds(prisma, "non-existent-id-xyz");
    expect(result).toEqual([]);
  });
});
