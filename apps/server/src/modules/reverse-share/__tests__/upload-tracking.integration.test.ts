/**
 * upload-tracking.integration.test.ts
 *
 * Integration tests (`app.inject()`) for 8.3 lot D — best-effort per-recipient
 * upload tracking on reverse shares, exercised through the real
 * `POST /reverse-shares/:id/register-file` and
 * `POST /reverse-shares/alias/:alias/register-file` routes.
 *
 * Behavior under test (mirrors the share download-status tracking):
 * - An upload that self-declares an `uploaderEmail` matching a known recipient
 *   stamps `uploadedAt` (first match only, via a conditional updateMany on
 *   `uploadedAt: null`) and atomically increments `uploadCount`.
 * - A second upload by the same email increments the count again but the
 *   conditional timestamp update no longer matches (uploadedAt already set).
 * - An upload with no email, or an email matching no recipient, touches no
 *   recipient row counter (the unmatched updateMany simply affects 0 rows).
 * - A spoofed/arbitrary email links best-effort (we never verify identity) —
 *   this is the accepted comfort-feature behavior.
 * - The upload still succeeds (201) even when the counter update throws
 *   (fire-and-forget, failure-tolerant).
 *
 * The email matching itself runs against the real `ReverseShareRepository`
 * method; we mock `prisma.reverseShareRecipient.updateMany` to assert the exact
 * where/data shape (conditional first-set vs atomic increment).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockReverseShareFindUnique,
  mockReverseShareAliasFindUnique,
  mockReverseShareFileCount,
  mockReverseShareFileCreate,
  mockRecipientUpdateMany,
  mockResolveEffectiveLimits,
  mockCalculateStorageUsed,
  mockEvaluateAndNotifyQuota,
  mockGetConfigValue,
  mockGetObjectSize,
} = vi.hoisted(() => ({
  mockReverseShareFindUnique: vi.fn(),
  mockReverseShareAliasFindUnique: vi.fn(),
  mockReverseShareFileCount: vi.fn(),
  mockReverseShareFileCreate: vi.fn(),
  mockRecipientUpdateMany: vi.fn(),
  mockResolveEffectiveLimits: vi.fn(),
  mockCalculateStorageUsed: vi.fn(),
  mockEvaluateAndNotifyQuota: vi.fn(),
  mockGetConfigValue: vi.fn(),
  mockGetObjectSize: vi.fn(),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn(),
    },
    reverseShare: {
      findUnique: mockReverseShareFindUnique,
    },
    reverseShareAlias: {
      findUnique: mockReverseShareAliasFindUnique,
    },
    reverseShareFile: {
      count: mockReverseShareFileCount,
      create: mockReverseShareFileCreate,
    },
    reverseShareRecipient: {
      updateMany: mockRecipientUpdateMany,
    },
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
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

vi.mock("../../../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

vi.mock("../../../modules/quota/service.js", () => ({
  quotaService: {
    resolveEffectiveLimits: mockResolveEffectiveLimits,
    calculateStorageUsed: mockCalculateStorageUsed,
    isReverseUploadAllowed: vi.fn().mockReturnValue(true),
    evaluateAndNotifyQuota: mockEvaluateAndNotifyQuota,
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  setLogger: vi.fn(),
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../../audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../file/service.js", () => ({
  FileService: class {
    getPresignedGetUrl = vi.fn().mockResolvedValue("https://presigned.url/get");
    getPresignedPutUrl = vi.fn().mockResolvedValue("https://presigned.url/upload");
    getObjectStream = vi.fn();
    getObjectHead = vi.fn().mockResolvedValue(Buffer.from("plain text content"));
    getObjectSize = mockGetObjectSize;
    deleteObject = vi.fn();
    createMultipartUpload = vi.fn();
    getPresignedPartUrl = vi.fn();
    completeMultipartUpload = vi.fn();
    abortMultipartUpload = vi.fn();
    listParts = vi.fn();
  },
}));

vi.mock("../../../config/storage.config.js", () => ({ isInternalStorage: false }));

// ─── Test data ──────────────────────────────────────────────────────────────

const RS_ID = "rs-1";
const ALIAS = "inbox-alias";
const CREATOR_ID = "creator-1";
const RECIPIENT_EMAIL = "alice@example.com";

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
    nameFieldRequired: "OPTIONAL",
    emailFieldRequired: "OPTIONAL",
    notifyOnUpload: false,
    bypassUploadCooldown: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    creatorId: CREATOR_ID,
    files: [],
    alias: null,
    recipients: [
      {
        id: "rec-1",
        email: RECIPIENT_EMAIL,
        name: "Alice",
        notifiedAt: new Date("2024-01-02"),
        uploadCount: 0,
        uploadedAt: null,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
      },
    ],
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

function registerPayload(extra: Record<string, unknown> = {}) {
  return {
    name: "doc",
    extension: "txt",
    size: 10,
    mimeType: "text/plain",
    objectName: `reverse-shares/${RS_ID}/obj.txt`,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Reverse-share per-recipient upload tracking (8.3 lot D) — integration", () => {
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
    mockReverseShareFindUnique.mockResolvedValue(makeReverseShare());
    mockReverseShareAliasFindUnique.mockResolvedValue({
      id: "alias-row-1",
      alias: ALIAS,
      reverseShareId: RS_ID,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      reverseShare: makeReverseShare(),
    });
    mockReverseShareFileCount.mockResolvedValue(0);
    mockReverseShareFileCreate.mockResolvedValue({
      id: "rf-1",
      name: "doc",
      description: null,
      extension: "txt",
      size: BigInt(10),
      objectName: `reverse-shares/${RS_ID}/obj.txt`,
      uploaderEmail: null,
      uploaderName: null,
      reverseShareId: RS_ID,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    });
    mockRecipientUpdateMany.mockResolvedValue({ count: 1 });
    // Unlimited owner so the quota path is a no-op and we isolate tracking.
    mockResolveEffectiveLimits.mockResolvedValue({ maxFileSize: 0n, maxTotalStorage: 0n });
    mockEvaluateAndNotifyQuota.mockResolvedValue(undefined);
    mockGetConfigValue.mockResolvedValue("true");
    // A3-08: registerPayload declares size 10; echo it for the HEAD-reconcile.
    mockGetObjectSize.mockResolvedValue(BigInt(10));
  });

  function registerById(extra: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: `/reverse-shares/${RS_ID}/register-file`,
      payload: registerPayload(extra),
    });
  }

  function registerByAlias(extra: Record<string, unknown> = {}) {
    return app.inject({
      method: "POST",
      url: `/reverse-shares/alias/${ALIAS}/register-file`,
      payload: registerPayload(extra),
    });
  }

  // ── Matching uploaderEmail (id path) ──────────────────────────────────────

  it("links a matching uploaderEmail: stamps uploadedAt (conditional) + increments uploadCount", async () => {
    const res = await registerById({ uploaderEmail: RECIPIENT_EMAIL });

    expect(res.statusCode).toBe(201);

    // The tracking is fire-and-forget; allow the microtask queue to drain.
    await new Promise((r) => setImmediate(r));

    // Two writes: conditional first-set timestamp, then atomic increment.
    expect(mockRecipientUpdateMany).toHaveBeenCalledTimes(2);
    expect(mockRecipientUpdateMany).toHaveBeenCalledWith({
      where: { reverseShareId: RS_ID, email: RECIPIENT_EMAIL, uploadedAt: null },
      data: { uploadedAt: expect.any(Date) },
    });
    expect(mockRecipientUpdateMany).toHaveBeenCalledWith({
      where: { reverseShareId: RS_ID, email: RECIPIENT_EMAIL },
      data: { uploadCount: { increment: 1 } },
    });
  });

  it("normalizes the uploaderEmail (lowercase) before matching", async () => {
    // The route's Zod z.email() rejects surrounding whitespace (400 before the
    // service), but a valid mixed-case address passes and must be lowercased to
    // match the stored recipient email.
    const res = await registerById({ uploaderEmail: "ALICE@Example.com" });

    expect(res.statusCode).toBe(201);
    await new Promise((r) => setImmediate(r));

    // Both writes use the normalized (lowercased) email.
    for (const call of mockRecipientUpdateMany.mock.calls) {
      expect(call[0].where.email).toBe(RECIPIENT_EMAIL);
    }
  });

  it("on a second upload the conditional timestamp set matches 0 rows but the count still increments", async () => {
    // First upload: timestamp set succeeds (count 1).
    // Second upload: uploadedAt already set, so the conditional updateMany
    // affects 0 rows; the increment always affects the row.
    mockRecipientUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // first: timestamp set
      .mockResolvedValueOnce({ count: 1 }) // first: increment
      .mockResolvedValueOnce({ count: 0 }) // second: timestamp set (no match)
      .mockResolvedValueOnce({ count: 1 }); // second: increment

    const first = await registerById({ uploaderEmail: RECIPIENT_EMAIL });
    await new Promise((r) => setImmediate(r));
    const second = await registerById({ uploaderEmail: RECIPIENT_EMAIL });
    await new Promise((r) => setImmediate(r));

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(mockRecipientUpdateMany).toHaveBeenCalledTimes(4);
    // The conditional timestamp write is always issued; the DB-level
    // `uploadedAt: null` guard is what prevents a re-stamp (asserted via the
    // where clause being present on every first-set call).
    const firstSetCalls = mockRecipientUpdateMany.mock.calls.filter(
      (c) => "uploadedAt" in c[0].where,
    );
    expect(firstSetCalls).toHaveLength(2);
    for (const c of firstSetCalls) {
      expect(c[0].where.uploadedAt).toBeNull();
    }
  });

  // ── No / unknown / spoofed email ──────────────────────────────────────────

  it("does not touch recipients when no uploaderEmail is supplied", async () => {
    const res = await registerById();

    expect(res.statusCode).toBe(201);
    await new Promise((r) => setImmediate(r));

    expect(mockRecipientUpdateMany).not.toHaveBeenCalled();
  });

  it("issues the scoped updateMany even for an unknown email (matches 0 rows, no-op)", async () => {
    mockRecipientUpdateMany.mockResolvedValue({ count: 0 });

    const res = await registerById({ uploaderEmail: "stranger@example.com" });

    expect(res.statusCode).toBe(201);
    await new Promise((r) => setImmediate(r));

    // The query is reverse-share-scoped, so an unknown email simply affects 0
    // rows — no cross-share linkage is possible.
    expect(mockRecipientUpdateMany).toHaveBeenCalledTimes(2);
    for (const call of mockRecipientUpdateMany.mock.calls) {
      expect(call[0].where.reverseShareId).toBe(RS_ID);
      expect(call[0].where.email).toBe("stranger@example.com");
    }
  });

  it("links a spoofed/arbitrary matching email best-effort (identity is never verified)", async () => {
    // An anonymous uploader types a known recipient's email: linkage happens.
    // This is the accepted comfort-feature behavior — not a security control.
    const res = await registerById({ uploaderEmail: RECIPIENT_EMAIL, uploaderName: "Not Alice" });

    expect(res.statusCode).toBe(201);
    await new Promise((r) => setImmediate(r));

    expect(mockRecipientUpdateMany).toHaveBeenCalledWith({
      where: { reverseShareId: RS_ID, email: RECIPIENT_EMAIL },
      data: { uploadCount: { increment: 1 } },
    });
  });

  // ── Failure tolerance ─────────────────────────────────────────────────────

  it("upload still succeeds (201) when the counter update throws", async () => {
    mockRecipientUpdateMany.mockRejectedValue(new Error("db down"));

    const res = await registerById({ uploaderEmail: RECIPIENT_EMAIL });

    expect(res.statusCode).toBe(201);
    expect(res.json().file).toBeDefined();
  });

  // ── Alias path ─────────────────────────────────────────────────────────────

  it("links a matching uploaderEmail through the alias register path too", async () => {
    const res = await registerByAlias({ uploaderEmail: RECIPIENT_EMAIL });

    expect(res.statusCode).toBe(201);
    await new Promise((r) => setImmediate(r));

    expect(mockRecipientUpdateMany).toHaveBeenCalledTimes(2);
    expect(mockRecipientUpdateMany).toHaveBeenCalledWith({
      where: { reverseShareId: RS_ID, email: RECIPIENT_EMAIL, uploadedAt: null },
      data: { uploadedAt: expect.any(Date) },
    });
    expect(mockRecipientUpdateMany).toHaveBeenCalledWith({
      where: { reverseShareId: RS_ID, email: RECIPIENT_EMAIL },
      data: { uploadCount: { increment: 1 } },
    });
  });
});
