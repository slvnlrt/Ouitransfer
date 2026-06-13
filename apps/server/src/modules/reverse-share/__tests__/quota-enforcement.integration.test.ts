/**
 * quota-enforcement.integration.test.ts
 *
 * Integration tests (`app.inject()`) for the 5.2 Phase B B3 reverse-share
 * soft-enforcement on external uploads, exercised through the real
 * `POST /reverse-shares/:id/register-file` route.
 *
 * The owner's storage quota is enforced when an external party uploads to a
 * reverse share:
 * - Soft enforcement ON (default): tolerated past 100% up to
 *   `min(limit × factor, absoluteCap)`; blocked beyond.
 * - Soft enforcement OFF: hard block once `used + size > limit`.
 *
 * Direct uploads (the owner's own files via `POST /files`) keep hard
 * enforcement regardless of the soft-enforcement setting — that is covered by
 * the file-module tests and asserted indirectly here by leaving the reverse
 * path as the only softened one.
 *
 * `QuotaService` is mocked so each test pins `resolveEffectiveLimits`,
 * `calculateStorageUsed`, and the pure `isReverseUploadAllowed` decision. The
 * real config values are pinned via the `getConfigValue` mock.
 */

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockReverseShareFindUnique,
  mockReverseShareFileCount,
  mockReverseShareFileCreate,
  mockResolveEffectiveLimits,
  mockCalculateStorageUsed,
  mockIsReverseUploadAllowed,
  mockEvaluateAndNotifyQuota,
  mockGetConfigValue,
  mockGetObjectSize,
} = vi.hoisted(() => ({
  mockReverseShareFindUnique: vi.fn(),
  mockReverseShareFileCount: vi.fn(),
  mockReverseShareFileCreate: vi.fn(),
  mockResolveEffectiveLimits: vi.fn(),
  mockCalculateStorageUsed: vi.fn(),
  mockIsReverseUploadAllowed: vi.fn(),
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
      findUnique: vi.fn(),
    },
    reverseShareFile: {
      count: mockReverseShareFileCount,
      create: mockReverseShareFileCreate,
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

// The upload service imports getConfigValue via "../config/service.js" (same module).
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
    isReverseUploadAllowed: mockIsReverseUploadAllowed,
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
    // Return an unidentifiable buffer so magic-byte verification passes for the
    // text/plain test fixture; getObjectSize echoes the per-call declared size.
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
const CREATOR_ID = "creator-1";
const LIMIT = 1000n;

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
    alias: null,
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

function registerPayload(size: number) {
  return {
    name: "doc",
    extension: "txt",
    size,
    mimeType: "text/plain",
    objectName: `reverse-shares/${RS_ID}/obj.txt`,
  };
}

// Pin the config values; tests flip `reverseShareQuotaSoftEnforcement`.
function setConfig({
  soft,
  factor = "3",
  cap = "0",
}: {
  soft: boolean;
  factor?: string;
  cap?: string;
}) {
  mockGetConfigValue.mockImplementation(async (key: string) => {
    switch (key) {
      case "reverseShareQuotaSoftEnforcement":
        return soft ? "true" : "false";
      case "reverseShareMaxOverageFactor":
        return factor;
      case "reverseShareAbsoluteMaxBytes":
        return cap;
      // Other keys read elsewhere in the request lifecycle.
      default:
        return "true";
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Reverse-share B3 soft enforcement — integration", () => {
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
    // Default: limited owner with a 1000-byte quota.
    mockResolveEffectiveLimits.mockResolvedValue({ maxFileSize: 0n, maxTotalStorage: LIMIT });
    mockEvaluateAndNotifyQuota.mockResolvedValue(undefined);
  });

  async function register(size: number) {
    // A3-08: echo the declared size for the HEAD-reconcile check so these quota
    // tests exercise quota math, not the size-mismatch guard.
    mockGetObjectSize.mockResolvedValue(BigInt(size));
    return app.inject({
      method: "POST",
      url: `/reverse-shares/${RS_ID}/register-file`,
      payload: registerPayload(size),
    });
  }

  // ── Soft enforcement ON ────────────────────────────────────────────────────

  describe("soft enforcement ON (default)", () => {
    beforeEach(() => setConfig({ soft: true }));

    it("allows an upload that stays within limit × factor (over 100% tolerated)", async () => {
      // used 1500 (already over the 1000 limit) + 100 = 1600 <= 3000 (3×).
      mockCalculateStorageUsed.mockResolvedValue(1500n);
      mockIsReverseUploadAllowed.mockReturnValue(true);

      const res = await register(100);

      expect(res.statusCode).toBe(201);
      expect(mockIsReverseUploadAllowed).toHaveBeenCalledWith(1500n, 100n, LIMIT, 3, 0n);
      expect(mockReverseShareFileCreate).toHaveBeenCalled();
      // The overage-zone warning evaluation is fired post-register.
      expect(mockEvaluateAndNotifyQuota).toHaveBeenCalledWith(CREATOR_ID, {
        oldUsed: 1500n,
        newUsed: 1600n,
      });
    });

    it("blocks when projected usage exceeds limit × factor", async () => {
      mockCalculateStorageUsed.mockResolvedValue(2900n);
      mockIsReverseUploadAllowed.mockReturnValue(false);

      const res = await register(500);

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(ErrorCodes.INSUFFICIENT_STORAGE);
      expect(mockReverseShareFileCreate).not.toHaveBeenCalled();
      expect(mockEvaluateAndNotifyQuota).not.toHaveBeenCalled();
    });

    it("blocks when the absolute cap is exceeded (cap passed through to the helper)", async () => {
      setConfig({ soft: true, factor: "3", cap: "2000" });
      mockCalculateStorageUsed.mockResolvedValue(1800n);
      mockIsReverseUploadAllowed.mockReturnValue(false);

      const res = await register(500);

      expect(res.statusCode).toBe(400);
      expect(mockIsReverseUploadAllowed).toHaveBeenCalledWith(1800n, 500n, LIMIT, 3, 2000n);
    });
  });

  // ── Soft enforcement OFF ───────────────────────────────────────────────────

  describe("soft enforcement OFF", () => {
    beforeEach(() => setConfig({ soft: false }));

    it("hard-blocks at the limit (used + size > limit), bypassing the soft helper", async () => {
      // used 900 + size 200 = 1100 > 1000 → hard block.
      mockCalculateStorageUsed.mockResolvedValue(900n);

      const res = await register(200);

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(ErrorCodes.INSUFFICIENT_STORAGE);
      // Soft helper is NOT consulted when enforcement is off.
      expect(mockIsReverseUploadAllowed).not.toHaveBeenCalled();
      expect(mockReverseShareFileCreate).not.toHaveBeenCalled();
    });

    it("allows an upload that stays within the hard limit", async () => {
      // used 800 + size 100 = 900 <= 1000.
      mockCalculateStorageUsed.mockResolvedValue(800n);

      const res = await register(100);

      expect(res.statusCode).toBe(201);
      expect(mockIsReverseUploadAllowed).not.toHaveBeenCalled();
      expect(mockReverseShareFileCreate).toHaveBeenCalled();
    });
  });

  // ── Unlimited owner ────────────────────────────────────────────────────────

  it("unlimited owner (limit 0n) is never blocked and skips warning evaluation", async () => {
    setConfig({ soft: true });
    mockResolveEffectiveLimits.mockResolvedValue({ maxFileSize: 0n, maxTotalStorage: 0n });

    const res = await register(1_000_000);

    expect(res.statusCode).toBe(201);
    // No usage query, no soft decision, no warning evaluation for unlimited owners.
    expect(mockCalculateStorageUsed).not.toHaveBeenCalled();
    expect(mockIsReverseUploadAllowed).not.toHaveBeenCalled();
    expect(mockEvaluateAndNotifyQuota).not.toHaveBeenCalled();
  });
});
