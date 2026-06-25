/**
 * direct-quota-warning.integration.test.ts
 *
 * Integration tests (`app.inject()`) for the 5.2 Phase B B1 threshold-warning /
 * exceeded-transition behavior driven through the REAL `evaluateAndNotifyQuota`
 * logic (NOT mocked). Unlike `direct-quota.integration.test.ts` — which stubs
 * the whole `quotaService` to prove the route invokes the hook with the correct
 * transition — this suite exercises the actual warning/dedup/exceeded code over
 * the full direct-upload request lifecycle (JWT + CSRF → route → file.create →
 * fire-and-forget evaluation).
 *
 * Only the transport/queue boundary is mocked: `emailService.send` /
 * `.sendToAdmins` stand in for the email queue, and `prisma` is the controllable
 * state store (usage via `file.aggregate`, warning state via `user.findUnique`
 * + `user.update`). The quota service itself is the real implementation.
 *
 * Asserted:
 * - Two uploads that cross 80% then stay in-band (still < 90%) enqueue exactly
 *   ONE `quota_warning` (dedup via `quotaLastWarnedThreshold`).
 * - An upload crossing 100% enqueues `quota_exceeded` and sets
 *   `User.quotaExceededSince` (via the persisted `user.update`).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks (transport + state store boundaries only) ──────────────────

const {
  mockFileAggregate,
  mockReverseShareFileAggregate,
  mockUserFindUnique,
  mockUserUpdate,
  mockFileCreate,
  mockGetConfigValue,
  mockEmailSend,
  mockEmailSendToAdmins,
  mockGetObjectSize,
} = vi.hoisted(() => ({
  mockFileAggregate: vi.fn(),
  mockReverseShareFileAggregate: vi.fn(),
  mockUserFindUnique: vi.fn(),
  mockUserUpdate: vi.fn(),
  mockFileCreate: vi.fn(),
  mockGetConfigValue: vi.fn(),
  mockEmailSend: vi.fn(),
  mockEmailSendToAdmins: vi.fn(),
  mockGetObjectSize: vi.fn(),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: mockUserFindUnique,
      update: mockUserUpdate,
    },
    file: {
      create: mockFileCreate,
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      aggregate: mockFileAggregate,
    },
    reverseShareFile: {
      aggregate: mockReverseShareFileAggregate,
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

// The quota service ALSO imports getConfigValue from this exact specifier.
vi.mock("../../config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
}));

vi.mock("../../../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

vi.mock("../../email/service.js", () => ({
  emailService: {
    send: mockEmailSend,
    sendToAdmins: mockEmailSendToAdmins,
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

// NOTE: ../../quota/service.js is deliberately NOT mocked — the real
// QuotaService drives the B1 warning/exceeded evaluation.

// ─── Test data ──────────────────────────────────────────────────────────────

const USER_ID = "user-b1";
const LIMIT = 1000n; // 80% = 800, 90% = 900, 100% = 1000.

/**
 * Mutable warning state, mirroring the two `User` columns that
 * `evaluateAndNotifyQuota` reads and writes. `user.findUnique` returns it and
 * `user.update` mutates it, so dedup/transition bookkeeping is durable across
 * uploads exactly as it would be against the real DB.
 */
const userState = {
  quotaLastWarnedThreshold: null as number | null,
  quotaExceededSince: null as Date | null,
};

/** Controlled storage usage BEFORE the next upload (drives the transition). */
let currentUsed = 0n;

function registerPayload(size: number) {
  return {
    name: "doc.txt",
    extension: "txt",
    size,
    objectName: `${USER_ID}/doc.txt`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Direct upload B1 threshold warnings — integration (real quota logic)", () => {
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
    userState.quotaLastWarnedThreshold = null;
    userState.quotaExceededSince = null;
    currentUsed = 0n;

    // Limit comes from the global config default (no per-user/group override).
    mockGetConfigValue.mockImplementation(async (key: string) => {
      if (key === "maxTotalStoragePerUser") return LIMIT.toString();
      if (key === "maxFileSize") return "0"; // unlimited per-file
      if (key === "quotaWarningThresholds") return "80,90";
      if (key === "quotaGracePeriodDays") return "7";
      return "";
    });

    // resolveEffectiveLimits + the B1 state read both go through findUnique;
    // one record satisfies both selects (override fields null → global limit).
    mockUserFindUnique.mockImplementation(async () => ({
      id: USER_ID,
      isAdmin: false,
      isActive: true,
      maxFileSizeOverride: null,
      maxTotalStorageOverride: null,
      group: null,
      email: "owner@example.test",
      locale: "en",
      firstName: "Owner",
      lastName: "B1",
      quotaLastWarnedThreshold: userState.quotaLastWarnedThreshold,
      quotaExceededSince: userState.quotaExceededSince,
    }));

    mockUserUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
      if ("quotaLastWarnedThreshold" in data) {
        userState.quotaLastWarnedThreshold = data.quotaLastWarnedThreshold as number | null;
      }
      if ("quotaExceededSince" in data) {
        userState.quotaExceededSince = data.quotaExceededSince as Date | null;
      }
      return { id: USER_ID };
    });

    // calculateStorageUsed = file.aggregate + reverseShareFile.aggregate.
    mockFileAggregate.mockImplementation(async () => ({ _sum: { size: currentUsed } }));
    mockReverseShareFileAggregate.mockResolvedValue({ _sum: { size: 0n } });

    mockEmailSend.mockResolvedValue({ enqueued: true });
    mockEmailSendToAdmins.mockResolvedValue({ enqueued: true });

    mockFileCreate.mockImplementation(async () => ({
      id: "f-1",
      name: "doc.txt",
      description: null,
      extension: "txt",
      size: 0n,
      objectName: `${USER_ID}/doc.txt`,
      userId: USER_ID,
      folderId: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
    }));
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

  /** Register an upload of `size` bytes given the current usage, then advance usage. */
  async function register(size: number) {
    // A3-08: echo the declared size for the HEAD-reconcile check.
    mockGetObjectSize.mockResolvedValue(BigInt(size));
    const { csrfToken, csrfCookie } = await getCsrf();
    const res = await app.inject({
      method: "POST",
      url: "/files",
      headers: {
        cookie: `token=${signToken()}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
      payload: registerPayload(size),
    });
    // The route registers the file then advances real usage for the next call.
    if (res.statusCode === 201) currentUsed += BigInt(size);
    return res;
  }

  /** Count enqueued emails of a given type (B1 transport boundary). */
  function sendCountFor(type: string): number {
    return mockEmailSend.mock.calls.filter((c) => c[0] === type).length;
  }

  it("enqueues a SINGLE quota_warning across two uploads that cross 80% then stay in-band", async () => {
    // Upload 1: 0 → 850 (crosses 80%=800, below 90%=900) ⇒ one quota_warning.
    const r1 = await register(850);
    expect(r1.statusCode).toBe(201);

    // The fire-and-forget evaluation enqueues asynchronously; wait for it.
    await vi.waitFor(() => expect(sendCountFor("quota_warning")).toBe(1));
    expect(userState.quotaLastWarnedThreshold).toBe(80);

    // Upload 2: 850 → 880 (still within the 80–90% band) ⇒ NO new warning (dedup).
    const r2 = await register(30);
    expect(r2.statusCode).toBe(201);

    // Give any (incorrect) second enqueue a chance to land, then assert still 1.
    await vi.waitFor(() => expect(mockFileCreate).toHaveBeenCalledTimes(2));
    expect(sendCountFor("quota_warning")).toBe(1);
    expect(sendCountFor("quota_exceeded")).toBe(0);
  });

  it("enqueues quota_exceeded and sets quotaExceededSince when usage crosses 100%", async () => {
    // Single upload: 0 → 1000 (== limit ⇒ exceeded). Direct uploads hard-block
    // only when used + size > limit; used + size == limit is allowed, and 1000
    // hits the exceeded boundary, firing the transition.
    const r = await register(1000);
    expect(r.statusCode).toBe(201);

    await vi.waitFor(() => expect(sendCountFor("quota_exceeded")).toBe(1));
    // Owner gets the stronger exceeded notice, not a sub-100 warning.
    expect(sendCountFor("quota_warning")).toBe(0);
    // Admins are alerted once on the transition.
    expect(mockEmailSendToAdmins).toHaveBeenCalledWith("admin_quota_alert", expect.any(Object));
    // The grace clock is persisted.
    expect(userState.quotaExceededSince).toBeInstanceOf(Date);
  });
});
