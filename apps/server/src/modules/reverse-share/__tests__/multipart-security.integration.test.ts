/**
 * multipart-security.integration.test.ts
 *
 * Integration tests (app.inject()) for the R1 hardening of the public reverse-share
 * multipart routes:
 *   - A3-01/A4-01: objectName must belong to reverse-shares/<id>; a cross-namespace
 *     key is rejected with 400 BEFORE any S3 call on part-url/complete/abort/list-parts.
 *   - A3-05/A4-04: create pre-checks owner quota; complete enforces maxFiles/
 *     maxFileSize/owner-quota with the REAL size and creates the ReverseShareFile row.
 *
 * These routes are public (csrfExempt) and take an alias, so the suite mocks the
 * alias lookup, the storage provider (via FileService), and quota/config.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockAliasFindUnique,
  mockReverseShareFileCount,
  mockResolveEffectiveLimits,
  mockCalculateStorageUsed,
  mockIsReverseUploadAllowed,
  mockGetConfigValue,
  mockCompleteMultipart,
  mockAbortMultipart,
  mockCreateMultipart,
  mockGetPresignedPartUrl,
  mockGetObjectHead,
  mockGetObjectSize,
  mockDeleteObject,
  mockTransaction,
  mockTxFileCount,
  mockTxFileCreate,
} = vi.hoisted(() => ({
  mockAliasFindUnique: vi.fn(),
  mockReverseShareFileCount: vi.fn(),
  mockResolveEffectiveLimits: vi.fn(),
  mockCalculateStorageUsed: vi.fn(),
  mockIsReverseUploadAllowed: vi.fn(),
  mockGetConfigValue: vi.fn(),
  mockCompleteMultipart: vi.fn(),
  mockAbortMultipart: vi.fn(),
  mockCreateMultipart: vi.fn(),
  mockGetPresignedPartUrl: vi.fn(),
  mockGetObjectHead: vi.fn(),
  mockGetObjectSize: vi.fn(),
  mockDeleteObject: vi.fn(),
  mockTransaction: vi.fn(),
  mockTxFileCount: vi.fn(),
  mockTxFileCreate: vi.fn(),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(1), findUnique: vi.fn() },
    reverseShare: { findUnique: vi.fn() },
    reverseShareAlias: { findUnique: mockAliasFindUnique },
    reverseShareFile: { count: mockReverseShareFileCount, create: vi.fn() },
    // The atomic create-at-complete path runs inside prisma.$transaction(cb).
    $transaction: mockTransaction,
  },
}));

vi.mock("../../email/service.js", () => ({
  emailService: { send: vi.fn().mockResolvedValue({ enqueued: false }) },
}));

vi.mock("../../../modules/config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));
vi.mock("../../config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../modules/quota/service.js", () => ({
  quotaService: {
    resolveEffectiveLimits: mockResolveEffectiveLimits,
    calculateStorageUsed: mockCalculateStorageUsed,
    isReverseUploadAllowed: mockIsReverseUploadAllowed,
    evaluateAndNotifyQuota: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  setLogger: vi.fn(),
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("../../audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../file/service.js", () => ({
  FileService: class {
    getPresignedGetUrl = vi.fn();
    getPresignedPutUrl = vi.fn();
    getObjectStream = vi.fn();
    getObjectHead = mockGetObjectHead;
    getObjectSize = mockGetObjectSize;
    deleteObject = mockDeleteObject;
    createMultipartUpload = mockCreateMultipart;
    getPresignedPartUrl = mockGetPresignedPartUrl;
    completeMultipartUpload = mockCompleteMultipart;
    abortMultipartUpload = mockAbortMultipart;
    listParts = vi.fn().mockResolvedValue([]);
  },
}));

vi.mock("../../../config/storage.config.js", () => ({ isInternalStorage: false }));

// ─── Test data ──────────────────────────────────────────────────────────────

const RS_ID = "rs-1";
const ALIAS = "inbox-alias";
const CREATOR_ID = "creator-1";

function makeReverseShare(overrides: Record<string, unknown> = {}) {
  return {
    id: RS_ID,
    name: "Inbox",
    description: null,
    expiration: null,
    maxFiles: null,
    maxFileSize: null,
    allowedFileTypes: null,
    password: null,
    pageLayout: "DEFAULT",
    backgroundImageId: null,
    isActive: true,
    nameFieldRequired: "HIDDEN",
    emailFieldRequired: "HIDDEN",
    notifyOnUpload: false,
    bypassUploadCooldown: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    creatorId: CREATOR_ID,
    files: [],
    alias: { id: "a1", alias: ALIAS, reverseShareId: RS_ID },
    creator: {
      id: CREATOR_ID,
      firstName: "Owner",
      lastName: "User",
      email: "owner@example.com",
      isActive: true,
    },
    ...overrides,
  };
}

// A realistic server-generated key (timestamp-uuid-filename.ext).
const VALID_KEY = `reverse-shares/${RS_ID}/1700000000000-11111111-2222-3333-4444-555555555555-doc.txt`;
const CROSS_NS_KEY = "victim-user-id/secret.pdf";

describe("Reverse-share multipart security — integration (A3-01 / A3-05)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../../../app.js");
    app = await buildApp();
    const { reverseShareRoutes } = await import("../routes.js");
    app.register(reverseShareRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAliasFindUnique.mockResolvedValue({
      id: "a1",
      alias: ALIAS,
      reverseShareId: RS_ID,
      reverseShare: makeReverseShare(),
    });
    mockReverseShareFileCount.mockResolvedValue(0);
    mockResolveEffectiveLimits.mockResolvedValue({ maxFileSize: 0n, maxTotalStorage: 0n }); // unlimited owner
    mockCalculateStorageUsed.mockResolvedValue(0n);
    mockGetConfigValue.mockResolvedValue("true");
    mockCreateMultipart.mockResolvedValue("upload-id-1");
    mockGetPresignedPartUrl.mockResolvedValue("https://presigned/part");
    mockCompleteMultipart.mockResolvedValue(undefined);
    mockAbortMultipart.mockResolvedValue(undefined);
    mockGetObjectHead.mockResolvedValue(Buffer.from("plain text content"));
    mockGetObjectSize.mockResolvedValue(BigInt(10));
    mockDeleteObject.mockResolvedValue(undefined);
    // Default transaction: run the callback against a tx whose count/create are mocked.
    mockTxFileCount.mockResolvedValue(0);
    mockTxFileCreate.mockResolvedValue({ id: "rf-1" });
    mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        reverseShareFile: { count: mockTxFileCount, create: mockTxFileCreate },
      }),
    );
  });

  // ── A3-01 / A4-01: cross-namespace objectName rejected on every sub-route ──

  it.each([
    ["part-url", { uploadId: "u1", objectName: CROSS_NS_KEY, partNumber: "1" }],
    [
      "complete",
      { uploadId: "u1", objectName: CROSS_NS_KEY, parts: [{ PartNumber: 1, ETag: "e" }] },
    ],
    ["abort", { uploadId: "u1", objectName: CROSS_NS_KEY }],
    ["list-parts", { uploadId: "u1", objectName: CROSS_NS_KEY }],
  ])("rejects a cross-namespace objectName on /%s with 400", async (route, body) => {
    const res = await app.inject({
      method: "POST",
      url: `/reverse-shares/alias/${ALIAS}/multipart/${route}`,
      payload: body,
    });

    expect(res.statusCode).toBe(400);
    // No S3 operation must have run for the foreign key.
    expect(mockCompleteMultipart).not.toHaveBeenCalled();
    expect(mockAbortMultipart).not.toHaveBeenCalled();
    expect(mockGetPresignedPartUrl).not.toHaveBeenCalled();
  });

  it("accepts an in-namespace objectName on part-url (200)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/reverse-shares/alias/${ALIAS}/multipart/part-url`,
      payload: { uploadId: "u1", objectName: VALID_KEY, partNumber: "1" },
    });
    expect(res.statusCode).toBe(200);
    expect(mockGetPresignedPartUrl).toHaveBeenCalledWith(VALID_KEY, "u1", 1, expect.any(Number));
  });

  // ── A3-05: create pre-checks owner quota (over-budget owner blocked) ───────

  it("blocks create when the owner is already over a hard quota", async () => {
    mockResolveEffectiveLimits.mockResolvedValue({ maxFileSize: 0n, maxTotalStorage: 1000n });
    mockCalculateStorageUsed.mockResolvedValue(1001n); // already OVER limit
    mockGetConfigValue.mockResolvedValue("false"); // hard enforcement

    const res = await app.inject({
      method: "POST",
      url: `/reverse-shares/alias/${ALIAS}/multipart/create`,
      payload: { filename: "doc", extension: "txt" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCreateMultipart).not.toHaveBeenCalled();
  });

  it("blocks create when the file type is not in allowedFileTypes", async () => {
    mockAliasFindUnique.mockResolvedValue({
      id: "a1",
      alias: ALIAS,
      reverseShareId: RS_ID,
      reverseShare: makeReverseShare({ allowedFileTypes: "png,jpg" }),
    });

    const res = await app.inject({
      method: "POST",
      url: `/reverse-shares/alias/${ALIAS}/multipart/create`,
      payload: { filename: "doc", extension: "txt" },
    });

    expect(res.statusCode).toBe(400);
    expect(mockCreateMultipart).not.toHaveBeenCalled();
  });

  // ── A3-05 / A4-04: complete enforces maxFileSize with the REAL size ────────

  it("rejects complete when the real object size exceeds maxFileSize (and aborts)", async () => {
    mockAliasFindUnique.mockResolvedValue({
      id: "a1",
      alias: ALIAS,
      reverseShareId: RS_ID,
      reverseShare: makeReverseShare({ maxFileSize: 100n }),
    });
    mockGetObjectSize.mockResolvedValue(BigInt(5000)); // real size over the 100-byte limit

    const res = await app.inject({
      method: "POST",
      url: `/reverse-shares/alias/${ALIAS}/multipart/complete`,
      payload: { uploadId: "u1", objectName: VALID_KEY, parts: [{ PartNumber: 1, ETag: "e" }] },
    });

    expect(res.statusCode).toBe(400);
    // The just-completed object is cleaned up.
    expect(mockAbortMultipart).toHaveBeenCalledWith(VALID_KEY, "u1");
    // No DB row is created for a rejected upload.
    expect(mockTxFileCreate).not.toHaveBeenCalled();
  });

  // ── A3-05 / A4-04: complete creates the ReverseShareFile row (quota accounting) ──

  it("creates the ReverseShareFile row at completion for a valid upload", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/reverse-shares/alias/${ALIAS}/multipart/complete`,
      payload: { uploadId: "u1", objectName: VALID_KEY, parts: [{ PartNumber: 1, ETag: "e" }] },
    });

    expect(res.statusCode).toBe(200);
    expect(mockCompleteMultipart).toHaveBeenCalledWith(VALID_KEY, "u1", [
      { PartNumber: 1, ETag: "e" },
    ]);
    expect(mockTxFileCreate).toHaveBeenCalledTimes(1);
    const createArg = mockTxFileCreate.mock.calls[0][0];
    expect(createArg.data.objectName).toBe(VALID_KEY);
    expect(createArg.data.reverseShareId).toBe(RS_ID);
    expect(createArg.data.size).toBe(BigInt(10));
  });

  // ── A3-05: atomic maxFiles re-check at completion (TOCTOU) ─────────────────

  it("rejects complete + cleans up when the atomic maxFiles re-check loses the race", async () => {
    mockAliasFindUnique.mockResolvedValue({
      id: "a1",
      alias: ALIAS,
      reverseShareId: RS_ID,
      reverseShare: makeReverseShare({ maxFiles: 1 }),
    });
    // Pre-checks see room (0 < 1), but inside the transaction another upload won
    // the slot first (count is now 1) → conditional create returns false.
    mockReverseShareFileCount.mockResolvedValue(0);
    mockTxFileCount.mockResolvedValue(1);

    const res = await app.inject({
      method: "POST",
      url: `/reverse-shares/alias/${ALIAS}/multipart/complete`,
      payload: { uploadId: "u1", objectName: VALID_KEY, parts: [{ PartNumber: 1, ETag: "e" }] },
    });

    expect(res.statusCode).toBe(403);
    expect(mockTxFileCreate).not.toHaveBeenCalled();
    // The orphaned object is deleted.
    expect(mockDeleteObject).toHaveBeenCalledWith(VALID_KEY);
  });
});
