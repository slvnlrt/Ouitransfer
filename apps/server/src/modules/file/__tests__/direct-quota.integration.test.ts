/**
 * direct-quota.integration.test.ts
 *
 * Integration tests (`app.inject()`) asserting that DIRECT file uploads
 * (`POST /files`, the owner's own file manager) keep HARD storage-quota
 * enforcement — independent of the 5.2 Phase B B3 reverse-share soft-enforcement
 * setting. A direct upload that would push the owner at/over their limit is
 * always refused with 400 `INSUFFICIENT_STORAGE`; the soft-overage tolerance
 * applies only to external reverse-share uploads.
 *
 * Exercises the full request lifecycle (JWT cookie + CSRF). `QuotaService` is
 * mocked to pin the effective limit and current usage.
 */

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockResolveEffectiveLimits,
  mockCalculateStorageUsed,
  mockEvaluateAndNotifyQuota,
  mockFileCreate,
  mockGetConfigValue,
  mockGetObjectSize,
} = vi.hoisted(() => ({
  mockResolveEffectiveLimits: vi.fn(),
  mockCalculateStorageUsed: vi.fn(),
  mockEvaluateAndNotifyQuota: vi.fn(),
  mockFileCreate: vi.fn(),
  mockGetConfigValue: vi.fn(),
  mockGetObjectSize: vi.fn(),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn(),
    },
    file: {
      create: mockFileCreate,
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    folder: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../../../modules/config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

vi.mock("../../quota/service.js", () => ({
  quotaService: {
    resolveEffectiveLimits: mockResolveEffectiveLimits,
    calculateStorageUsed: mockCalculateStorageUsed,
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

vi.mock("../service.js", () => ({
  FileService: class {
    getObjectHead = vi.fn().mockResolvedValue(Buffer.from("plain text content"));
    getObjectSize = mockGetObjectSize;
    getPresignedGetUrl = vi.fn();
    getPresignedPutUrl = vi.fn();
  },
}));

// ─── Test data ──────────────────────────────────────────────────────────────

const USER_ID = "user-1";
const LIMIT = 1000n;

function registerPayload(size: number) {
  // objectName must live under the user's namespace (no mimeType → magic-byte
  // verification is skipped, so no S3 round-trip is needed).
  return {
    name: "doc.txt",
    extension: "txt",
    size,
    objectName: `${USER_ID}/doc.txt`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Direct upload hard quota enforcement — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../../../app.js");
    app = await buildApp();

    const { fileRoutes } = await import("../routes.js");
    app.register(fileRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveEffectiveLimits.mockResolvedValue({ maxFileSize: 0n, maxTotalStorage: LIMIT });
    mockEvaluateAndNotifyQuota.mockResolvedValue(undefined);
    mockFileCreate.mockResolvedValue({
      id: "f-1",
      name: "doc.txt",
      description: null,
      extension: "txt",
      size: 100n,
      objectName: `${USER_ID}/doc.txt`,
      userId: USER_ID,
      folderId: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    });
  });

  function signToken(): string {
    const jwt = app.jwt.sign({ userId: USER_ID, isAdmin: false, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = res.json();
    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  async function register(size: number) {
    // A3-08: register HEAD-reconciles declared size against the real object size.
    // Echo the declared size so these quota tests exercise quota math, not the
    // size-mismatch guard.
    mockGetObjectSize.mockResolvedValue(BigInt(size));
    const { csrfToken, csrfCookie } = await getCsrf();
    return app.inject({
      method: "POST",
      url: "/files",
      headers: {
        cookie: `token=${signToken()}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
      payload: registerPayload(size),
    });
  }

  // Soft enforcement should be irrelevant on the direct path — assert the hard
  // block fires whether the (reverse-only) toggle is on or off.
  for (const soft of [true, false]) {
    it(`hard-blocks a direct upload that would exceed the limit (soft=${soft})`, async () => {
      mockGetConfigValue.mockResolvedValue(soft ? "true" : "false");
      // used 900 + size 200 = 1100 > 1000.
      mockCalculateStorageUsed.mockResolvedValue(900n);

      const res = await register(200);

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe(ErrorCodes.INSUFFICIENT_STORAGE);
      expect(mockFileCreate).not.toHaveBeenCalled();
      // Blocked before any usage transition is evaluated.
      expect(mockEvaluateAndNotifyQuota).not.toHaveBeenCalled();
    });
  }

  it("hard-blocks exactly at 100% (used + size == limit is allowed; over is not)", async () => {
    mockGetConfigValue.mockResolvedValue("true");
    // used 1000 already at the limit; any positive size exceeds it.
    mockCalculateStorageUsed.mockResolvedValue(1000n);

    const res = await register(1);

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe(ErrorCodes.INSUFFICIENT_STORAGE);
  });

  it("allows a direct upload within the limit and fires the B1 warning evaluation", async () => {
    mockGetConfigValue.mockResolvedValue("true");
    // used 800 + size 100 = 900 <= 1000.
    mockCalculateStorageUsed.mockResolvedValue(800n);

    const res = await register(100);

    expect(res.statusCode).toBe(201);
    expect(mockFileCreate).toHaveBeenCalled();
    expect(mockEvaluateAndNotifyQuota).toHaveBeenCalledWith(USER_ID, {
      oldUsed: 800n,
      newUsed: 900n,
    });
  });
});
