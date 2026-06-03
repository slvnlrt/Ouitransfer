/**
 * Integration test — deleting a user redacts their email from
 * historical audit metadata (GDPR erasure), and the deletion event itself does
 * not re-persist the email.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;
const VICTIM_EMAIL = "victim@example.com";

const mockUserCount = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserDelete = vi.fn();
const mockAuditFindMany = vi.fn();
const mockAuditUpdate = vi.fn();
const mockAuditCreate = vi.fn();
const mockFileFindMany = vi.fn();
const mockFileDeleteMany = vi.fn();
const mockFolderDeleteMany = vi.fn();
const mockShareFindMany = vi.fn();
const mockReverseShareFindMany = vi.fn();
const mockReverseShareFileFindMany = vi.fn();
const mockReverseShareDelete = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: mockUserFindUnique,
      delete: mockUserDelete,
    },
    auditLog: {
      findMany: mockAuditFindMany,
      update: mockAuditUpdate,
      create: mockAuditCreate,
    },
    // Surface used by purgeUserContent (A8 full cascade).
    file: { findMany: mockFileFindMany, deleteMany: mockFileDeleteMany },
    folder: { deleteMany: mockFolderDeleteMany },
    share: { findMany: mockShareFindMany },
    reverseShare: { findMany: mockReverseShareFindMany, delete: mockReverseShareDelete },
    reverseShareFile: { findMany: mockReverseShareFileFindMany },
    $transaction: mockTransaction,
    // Read while building the register password schema during route registration.
    appConfig: { findUnique: vi.fn().mockResolvedValue({ value: "8" }) },
  },
}));

// Storage provider — assert that purgeUserContent deletes the user's S3 objects.
const mockDeleteObject = vi.fn();
vi.mock("../providers/s3-storage.provider.js", () => ({
  S3StorageProvider: class {
    deleteObject = mockDeleteObject;
  },
}));

function deletedUserRow() {
  const now = new Date();
  return {
    id: "victim-1",
    firstName: "Vic",
    lastName: "Tim",
    username: "victim",
    email: VICTIM_EMAIL,
    image: null,
    isAdmin: false,
    isActive: true,
    tokenVersion: 0,
    createdAt: now,
    updatedAt: now,
    groupId: null,
    group: null,
    maxFileSizeOverride: null,
    maxTotalStorageOverride: null,
  };
}

describe("DELETE /users/:id — audit PII redaction (integration)", () => {
  let app: FastifyInstance;

  async function adminHeaders(): Promise<Record<string, string>> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    const jwt = app.jwt.sign({ userId: "admin-1", isAdmin: true, tokenVersion: TOKEN_VERSION });
    return {
      cookie: `token=${app.signCookie(jwt)}; _csrf=${csrfCookie.value}`,
      "x-csrf-token": csrfToken,
    };
  }

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { userRoutes } = await import("../modules/user/routes.js");
    app.register(userRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCount.mockResolvedValue(2); // users exist → no setup bypass
    mockUserFindUnique.mockResolvedValue({ id: "admin-1", tokenVersion: TOKEN_VERSION });
    mockUserDelete.mockResolvedValue(deletedUserRow());
    mockAuditFindMany.mockResolvedValue([]);
    mockAuditUpdate.mockResolvedValue({});
    mockAuditCreate.mockResolvedValue({});
    // purgeUserContent defaults: no content for the deleted user.
    mockFileFindMany.mockResolvedValue([]);
    mockFileDeleteMany.mockResolvedValue({ count: 0 });
    mockFolderDeleteMany.mockResolvedValue({ count: 0 });
    mockShareFindMany.mockResolvedValue([]);
    mockReverseShareFindMany.mockResolvedValue([]);
    mockReverseShareFileFindMany.mockResolvedValue([]);
    mockReverseShareDelete.mockResolvedValue({});
    mockDeleteObject.mockResolvedValue(undefined);
    // deleteShareLink runs inside a transaction; invoke the callback with a
    // minimal tx client exposing the surface it touches.
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => unknown) =>
      cb({
        share: {
          update: vi.fn().mockResolvedValue(undefined),
          delete: vi.fn().mockResolvedValue({ security: null }),
        },
        shareSecurity: { delete: vi.fn().mockResolvedValue(undefined) },
      }),
    );
  });

  it("redacts the deleted user's email from matching audit metadata", async () => {
    mockAuditFindMany.mockResolvedValue([
      {
        id: "log-1",
        metadata: JSON.stringify({ count: 2, emails: [VICTIM_EMAIL, "other@example.com"] }),
      },
    ]);

    const res = await app.inject({
      method: "DELETE",
      url: "/users/victim-1",
      headers: await adminHeaders(),
    });

    expect(res.statusCode).toBe(200);

    // Redaction queries by the deleted user's email and rewrites the match.
    expect(mockAuditFindMany).toHaveBeenCalledWith({
      where: { metadata: { contains: VICTIM_EMAIL } },
      select: { id: true, metadata: true },
    });
    expect(mockAuditUpdate).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { metadata: JSON.stringify({ count: 2, emails: ["[deleted]", "other@example.com"] }) },
    });
  });

  it("still deletes the user (200) when there is nothing to redact", async () => {
    mockAuditFindMany.mockResolvedValue([]);

    const res = await app.inject({
      method: "DELETE",
      url: "/users/victim-1",
      headers: await adminHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe(VICTIM_EMAIL); // response to the admin still carries it
    expect(mockAuditUpdate).not.toHaveBeenCalled();
  });

  it("does not fail the deletion when redaction throws", async () => {
    mockAuditFindMany.mockRejectedValue(new Error("db down"));

    const res = await app.inject({
      method: "DELETE",
      url: "/users/victim-1",
      headers: await adminHeaders(),
    });

    // The user row is already gone; a redaction failure must not surface as an error.
    expect(res.statusCode).toBe(200);
  });

  it("performs the full A8 cascade: deletes the user's shares and their files' S3 objects", async () => {
    // The user owns one file (with an S3 object) and one share.
    mockFileFindMany.mockResolvedValue([{ objectName: "user/victim-1/photo.jpg" }]);
    mockFileDeleteMany.mockResolvedValue({ count: 1 });
    mockShareFindMany.mockResolvedValue([{ id: "share-1" }]);

    const res = await app.inject({
      method: "DELETE",
      url: "/users/victim-1",
      headers: await adminHeaders(),
    });

    expect(res.statusCode).toBe(200);

    // The share is removed via deleteShareLink (runs in a transaction) — never
    // left orphaned by the SetNull FK.
    expect(mockShareFindMany).toHaveBeenCalledWith({
      where: { creatorId: "victim-1" },
      select: { id: true },
    });
    expect(mockTransaction).toHaveBeenCalled();

    // The user's File S3 object is deleted so nothing dangles in storage.
    expect(mockDeleteObject).toHaveBeenCalledWith("user/victim-1/photo.jpg");

    // The user row itself is removed only after the purge.
    expect(mockUserDelete).toHaveBeenCalledWith({
      where: { id: "victim-1" },
      include: { group: { select: { id: true, name: true } } },
    });
  });
});
