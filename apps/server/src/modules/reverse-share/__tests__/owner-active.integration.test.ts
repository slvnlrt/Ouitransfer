/**
 * owner-active.integration.test.ts
 *
 * Integration tests for the A6 deactivated-owner gate on reverse shares.
 *
 * Spec A6 requires that when a reverse share's owner account is deactivated,
 * external access AND uploads are blocked with 403 `OWNER_INACTIVE` — the
 * upload page URL is semi-public/bookmarkable, so the gate must be enforced on
 * every external entry point, not just the metadata fetch.
 *
 * Covered here with `app.inject()`:
 * - GET /reverse-shares/:id/upload (metadata gate): active owner → 200,
 *   deactivated owner → 403 OWNER_INACTIVE.
 * - POST /reverse-shares/:id/presigned-url (upload gate): active owner → 200,
 *   deactivated owner → 403 OWNER_INACTIVE.
 * - POST /reverse-shares/:id/register-file (upload gate): deactivated owner →
 *   403 OWNER_INACTIVE.
 *
 * Mirrors the regular-share coverage in share/__tests__/visitor-tracking.test.ts.
 */

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockReverseShareFindUnique, mockReverseShareFileCount, mockReverseShareFileCreate } =
  vi.hoisted(() => ({
    mockReverseShareFindUnique: vi.fn(),
    mockReverseShareFileCount: vi.fn(),
    mockReverseShareFileCreate: vi.fn(),
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
  getConfigValue: vi.fn().mockResolvedValue("true"),
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
    resolveEffectiveLimits: vi.fn().mockResolvedValue({ maxFileSize: 0n, maxTotalStorage: 0n }),
    calculateStorageUsed: vi.fn().mockResolvedValue(0n),
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
    getObjectHead = vi.fn();
    deleteObject = vi.fn();
    createMultipartUpload = vi.fn();
    getPresignedPartUrl = vi.fn();
    completeMultipartUpload = vi.fn();
    abortMultipartUpload = vi.fn();
    listParts = vi.fn();
  },
}));

// Internal-vs-external storage check imported dynamically by the upload service.
vi.mock("../../../config/storage.config.js", () => ({ isInternalStorage: false }));

// ─── Test data ──────────────────────────────────────────────────────────────

const RS_ID = "rs-1";
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

// ─────────────────────────────────────────────────────────────────────────────

describe("Reverse share A6 deactivated-owner gate — integration", () => {
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
  });

  // ── GET metadata gate ─────────────────────────────────────────────────────

  describe("GET /reverse-shares/:id/upload (metadata gate)", () => {
    it("returns 200 for an active owner", async () => {
      mockReverseShareFindUnique.mockResolvedValue(makeReverseShare());

      const res = await app.inject({ method: "GET", url: `/reverse-shares/${RS_ID}/upload` });

      expect(res.statusCode).toBe(200);
      expect(res.json().reverseShare.id).toBe(RS_ID);
    });

    it("returns 403 OWNER_INACTIVE for a deactivated owner", async () => {
      mockReverseShareFindUnique.mockResolvedValue(
        makeReverseShare({
          creator: {
            id: CREATOR_ID,
            firstName: "Owner",
            lastName: "User",
            email: "owner@example.com",
            isActive: false,
          },
        }),
      );

      const res = await app.inject({ method: "GET", url: `/reverse-shares/${RS_ID}/upload` });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe(ErrorCodes.OWNER_INACTIVE);
    });
  });

  // ── POST presigned-url upload gate ────────────────────────────────────────

  describe("POST /reverse-shares/:id/presigned-url (upload gate)", () => {
    const body = { filename: "doc", extension: "txt" };

    it("succeeds (non-403) for an active owner", async () => {
      mockReverseShareFindUnique.mockResolvedValue(makeReverseShare());

      const res = await app.inject({
        method: "POST",
        url: `/reverse-shares/${RS_ID}/presigned-url`,
        payload: body,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().url).toContain("https://presigned.url/upload");
    });

    it("returns 403 OWNER_INACTIVE for a deactivated owner", async () => {
      mockReverseShareFindUnique.mockResolvedValue(
        makeReverseShare({
          creator: {
            id: CREATOR_ID,
            firstName: "Owner",
            lastName: "User",
            email: "owner@example.com",
            isActive: false,
          },
        }),
      );

      const res = await app.inject({
        method: "POST",
        url: `/reverse-shares/${RS_ID}/presigned-url`,
        payload: body,
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe(ErrorCodes.OWNER_INACTIVE);
    });
  });

  // ── POST register-file upload gate ────────────────────────────────────────

  describe("POST /reverse-shares/:id/register-file (upload gate)", () => {
    it("returns 403 OWNER_INACTIVE for a deactivated owner", async () => {
      mockReverseShareFindUnique.mockResolvedValue(
        makeReverseShare({
          creator: {
            id: CREATOR_ID,
            firstName: "Owner",
            lastName: "User",
            email: "owner@example.com",
            isActive: false,
          },
        }),
      );

      const res = await app.inject({
        method: "POST",
        url: `/reverse-shares/${RS_ID}/register-file`,
        payload: {
          name: "doc",
          extension: "txt",
          size: 10,
          mimeType: "text/plain",
          objectName: `reverse-shares/${RS_ID}/obj.txt`,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe(ErrorCodes.OWNER_INACTIVE);
      // The gate fires before any file row is created.
      expect(mockReverseShareFileCreate).not.toHaveBeenCalled();
    });
  });
});
