/**
 * visitor-identification.test.ts
 *
 * Integration tests for Batch 9 — Visitor Identification endpoint.
 *
 * Tests:
 * - POST /shares/alias/:alias/identify sets signed cookie and returns success
 * - POST /shares/alias/:alias/identify with missing required name → 400
 * - POST /shares/alias/:alias/identify with missing required email → 400
 * - Accessing share requiring identification without cookie/token → 403 IDENTIFICATION_REQUIRED
 * - Accessing with valid sv_{alias} cookie passes through
 * - Tracking token satisfies identification when recipient has required fields
 * - Tracking token does NOT satisfy when name is REQUIRED but recipient has no name
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockShareVisitCreate,
  mockShareFindUnique,
  mockShareUpdate,
  mockShareUpdateMany,
  mockShareRecipientFindUnique,
  mockShareRecipientUpdate,
  mockShareAliasFindUnique,
  mockShareSecurityCreate,
  mockEmailSend,
  mockUserCount,
} = vi.hoisted(() => ({
  mockShareVisitCreate: vi.fn().mockResolvedValue({ id: "visit-1" }),
  mockShareFindUnique: vi.fn(),
  mockShareUpdate: vi.fn().mockResolvedValue({}),
  mockShareUpdateMany: vi.fn().mockResolvedValue({ count: 1 }),
  mockShareRecipientFindUnique: vi.fn().mockResolvedValue(null),
  mockShareRecipientUpdate: vi.fn().mockResolvedValue({}),
  mockShareAliasFindUnique: vi.fn(),
  mockShareSecurityCreate: vi.fn(),
  mockEmailSend: vi.fn().mockResolvedValue(undefined),
  mockUserCount: vi.fn().mockResolvedValue(1),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: vi.fn(),
    },
    share: {
      findUnique: mockShareFindUnique,
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: mockShareUpdate,
      updateMany: mockShareUpdateMany,
      delete: vi.fn(),
    },
    shareSecurity: {
      create: mockShareSecurityCreate,
    },
    shareAlias: {
      findUnique: mockShareAliasFindUnique,
    },
    shareRecipient: {
      findUnique: mockShareRecipientFindUnique,
      update: mockShareRecipientUpdate,
    },
    shareVisit: {
      create: mockShareVisitCreate,
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    file: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
    folder: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../../email/service.js", () => ({
  emailService: {
    send: mockEmailSend,
  },
}));

vi.mock("../../../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    if (key === "passwordMinLength") return "8";
    if (key === "passwordAuthEnabled") return "true";
    return "true";
  }),
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
    resolveEffectiveLimits: vi.fn().mockResolvedValue({
      maxFileSize: 0n,
      maxTotalStorage: 0n,
    }),
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

// ─── Static imports ───────────────────────────────────────────────────────────

import { prisma } from "../../../shared/prisma.js";

// ─── Test data helpers ────────────────────────────────────────────────────────

const CREATOR_ID = "creator-user-1";
const SHARE_ID = "share-1";
const ALIAS = "myshare";
const SECURITY_ID = "security-1";

function makeShare(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_ID,
    name: "Test Share",
    description: null,
    views: 0,
    maxViews: null,
    expiration: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    creatorId: CREATOR_ID,
    securityId: SECURITY_ID,
    nameFieldRequired: "HIDDEN",
    emailFieldRequired: "HIDDEN",
    inactivityAlertDays: null,
    inactivityAlertSent: false,
    lastDownloadedAt: null,
    notifyOnDownload: false,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    security: { id: SECURITY_ID, password: null, createdAt: new Date(), updatedAt: new Date() },
    files: [],
    folders: [],
    recipients: [],
    alias: null,
    creator: { email: "creator@example.com", locale: "en" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Visitor Identification — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("SECURE_SITE", "false");

    const { buildApp } = await import("../../../app.js");
    app = await buildApp();

    const { shareRoutes } = await import("../routes.js");
    app.register(shareRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    mockShareVisitCreate.mockResolvedValue({ id: "visit-1" });
    mockShareUpdate.mockResolvedValue({});
    mockShareUpdateMany.mockResolvedValue({ count: 1 });
    mockShareRecipientFindUnique.mockResolvedValue(null);
    mockShareRecipientUpdate.mockResolvedValue({});
    mockEmailSend.mockResolvedValue(undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /shares/alias/:alias/identify — sets signed cookie
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /shares/alias/:alias/identify", () => {
    it("returns 200 and sets a signed sv_{alias} cookie when share has no required fields", async () => {
      // Share with no required fields
      mockShareAliasFindUnique.mockResolvedValue({
        share: makeShare({ nameFieldRequired: "OPTIONAL", emailFieldRequired: "OPTIONAL" }),
      });

      const res = await app.inject({
        method: "POST",
        url: `/shares/alias/${ALIAS}/identify`,
        headers: { "content-type": "application/json" },
        payload: { name: "Alice", email: "alice@example.com" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });

      // Should set a cookie named sv_myshare
      const cookie = res.cookies.find((c: { name: string }) => c.name === `sv_${ALIAS}`);
      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
    });

    it("returns 400 when name is REQUIRED but not provided", async () => {
      mockShareAliasFindUnique.mockResolvedValue({
        share: makeShare({ nameFieldRequired: "REQUIRED", emailFieldRequired: "OPTIONAL" }),
      });

      const res = await app.inject({
        method: "POST",
        url: `/shares/alias/${ALIAS}/identify`,
        headers: { "content-type": "application/json" },
        payload: { email: "alice@example.com" },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      // globalErrorHandler returns { error: message, code: ..., statusCode: ... }
      expect(body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 400 when email is REQUIRED but not provided", async () => {
      mockShareAliasFindUnique.mockResolvedValue({
        share: makeShare({ nameFieldRequired: "HIDDEN", emailFieldRequired: "REQUIRED" }),
      });

      const res = await app.inject({
        method: "POST",
        url: `/shares/alias/${ALIAS}/identify`,
        headers: { "content-type": "application/json" },
        payload: { name: "Alice" },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 when alias does not exist", async () => {
      mockShareAliasFindUnique.mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: `/shares/alias/nonexistent/identify`,
        headers: { "content-type": "application/json" },
        payload: {},
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 200 with both required fields provided", async () => {
      mockShareAliasFindUnique.mockResolvedValue({
        share: makeShare({ nameFieldRequired: "REQUIRED", emailFieldRequired: "REQUIRED" }),
      });

      const res = await app.inject({
        method: "POST",
        url: `/shares/alias/${ALIAS}/identify`,
        headers: { "content-type": "application/json" },
        payload: { name: "Alice Smith", email: "alice@example.com" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });

      const cookie = res.cookies.find((c: { name: string }) => c.name === `sv_${ALIAS}`);
      expect(cookie).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTIFICATION_REQUIRED gate — accessing share via alias
  // ═══════════════════════════════════════════════════════════════════════════

  describe("GET /shares/alias/:alias — identification gate", () => {
    it("returns 403 IDENTIFICATION_REQUIRED when name is required and no cookie/token", async () => {
      const share = makeShare({ nameFieldRequired: "REQUIRED" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe("IDENTIFICATION_REQUIRED");
    });

    it("returns 403 IDENTIFICATION_REQUIRED when email is required and no cookie/token", async () => {
      const share = makeShare({ emailFieldRequired: "REQUIRED" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
      });

      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe("IDENTIFICATION_REQUIRED");
    });

    it("allows access when identification is not required (HIDDEN)", async () => {
      const share = makeShare({ nameFieldRequired: "HIDDEN", emailFieldRequired: "HIDDEN" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);
      mockShareUpdateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
      });

      expect(res.statusCode).toBe(200);
    });

    it("allows access when name is OPTIONAL (not REQUIRED)", async () => {
      const share = makeShare({ nameFieldRequired: "OPTIONAL", emailFieldRequired: "OPTIONAL" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);
      mockShareUpdateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
      });

      expect(res.statusCode).toBe(200);
    });

    it("tracking token satisfies identification when recipient has required name", async () => {
      const trackingToken = "valid-tracking-token";
      const share = makeShare({ nameFieldRequired: "REQUIRED" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);
      mockShareUpdateMany.mockResolvedValue({ count: 1 });
      mockShareRecipientFindUnique.mockResolvedValue({
        id: "recipient-1",
        shareId: SHARE_ID,
        email: "alice@example.com",
        name: "Alice Smith", // has name ✓
        trackingToken,
        accessCount: 0,
        lastAccessedAt: null,
      });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}?t=${trackingToken}`,
      });

      expect(res.statusCode).toBe(200);
    });

    it("tracking token does NOT satisfy when name is REQUIRED but recipient has no name", async () => {
      const trackingToken = "token-no-name";
      const share = makeShare({ nameFieldRequired: "REQUIRED" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);
      mockShareRecipientFindUnique.mockResolvedValue({
        id: "recipient-1",
        shareId: SHARE_ID,
        email: "alice@example.com",
        name: null, // no name ✗
        trackingToken,
        accessCount: 0,
        lastAccessedAt: null,
      });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}?t=${trackingToken}`,
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("IDENTIFICATION_REQUIRED");
    });

    // ── Owner-only metadata stripped from anonymous response ─────────────
    it("anonymous GET does NOT expose owner-only metadata", async () => {
      const share = makeShare({
        nameFieldRequired: "HIDDEN",
        emailFieldRequired: "HIDDEN",
        notifyOnDownload: true,
        inactivityAlertDays: 30,
        lastDownloadedAt: new Date("2025-06-01"),
        notifiedForExpiring: true,
        notifiedForExpired: false,
      });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);
      mockShareUpdateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Owner-only fields should be nulled/zeroed for non-owner access
      expect(body.share.creatorId).toBeNull();
      expect(body.share.notifyOnDownload).toBe(false);
      expect(body.share.inactivityAlertDays).toBeNull();
      expect(body.share.lastDownloadedAt).toBeNull();
      expect(body.share.notifiedForExpiring).toBe(false);
      expect(body.share.notifiedForExpired).toBe(false);
    });

    // ── FIX 1 regression: recipients stripped from anonymous response ──────
    it("anonymous GET does NOT include recipients with trackingTokens", async () => {
      const share = makeShare({
        nameFieldRequired: "HIDDEN",
        emailFieldRequired: "HIDDEN",
        recipients: [
          {
            id: "r-1",
            shareId: SHARE_ID,
            email: "alice@example.com",
            name: "Alice",
            trackingToken: "secret-tracking-token-abc",
            notifiedAt: new Date("2025-01-01"),
            lastAccessedAt: null,
            accessCount: 0,
            createdAt: new Date("2025-01-01"),
            updatedAt: new Date("2025-01-01"),
          },
        ],
      });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);
      mockShareUpdateMany.mockResolvedValue({ count: 1 });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Recipients should be empty for non-owner access
      expect(body.share.recipients).toEqual([]);
    });

    // ── FIX 2 regression: cross-share tracking token rejected ──────────────
    it("tracking token from a DIFFERENT share does NOT bypass identification gate", async () => {
      const trackingToken = "token-from-other-share";
      const share = makeShare({ nameFieldRequired: "REQUIRED" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);
      // Recipient exists but belongs to a different share
      mockShareRecipientFindUnique.mockResolvedValue({
        id: "recipient-99",
        shareId: "OTHER-SHARE-ID", // ← different share!
        email: "alice@example.com",
        name: "Alice Smith",
        trackingToken,
        accessCount: 0,
        lastAccessedAt: null,
      });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}?t=${trackingToken}`,
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("IDENTIFICATION_REQUIRED");
    });

    // ── FIX 3 regression: cookie re-validated against current requirements ─
    it("cookie with name=null is rejected when nameFieldRequired=REQUIRED", async () => {
      const share = makeShare({ nameFieldRequired: "REQUIRED", emailFieldRequired: "HIDDEN" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);

      // Simulate a cookie that was set when name was OPTIONAL (name is null)
      const cookiePayload = JSON.stringify({ alias: ALIAS, name: null, email: "bob@example.com" });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
        cookies: {
          [`sv_${ALIAS}`]: cookiePayload,
        },
      });

      // Cookie has name=null but share now requires name → 403
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("IDENTIFICATION_REQUIRED");
    });

    it("cookie with email=null is rejected when emailFieldRequired=REQUIRED", async () => {
      const share = makeShare({ nameFieldRequired: "HIDDEN", emailFieldRequired: "REQUIRED" });
      mockShareAliasFindUnique.mockResolvedValue({ shareId: SHARE_ID });
      mockShareFindUnique.mockResolvedValue(share);

      // Simulate a cookie that was set when email was OPTIONAL (email is null)
      const cookiePayload = JSON.stringify({ alias: ALIAS, name: "Bob", email: null });

      const res = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
        cookies: {
          [`sv_${ALIAS}`]: cookiePayload,
        },
      });

      // Cookie has email=null but share now requires email → 403
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("IDENTIFICATION_REQUIRED");
    });

    // ── Integ M-4: happy-path — identify then access ───────────────────────
    it("valid identify cookie bypasses identification gate on subsequent GET", async () => {
      const share = makeShare({
        nameFieldRequired: "REQUIRED",
        emailFieldRequired: "REQUIRED",
      });

      // Setup: alias lookup for POST /identify and GET /alias/:alias
      mockShareAliasFindUnique.mockResolvedValue({
        share: makeShare({ nameFieldRequired: "REQUIRED", emailFieldRequired: "REQUIRED" }),
        shareId: SHARE_ID,
      });
      mockShareFindUnique.mockResolvedValue(share);
      mockShareUpdateMany.mockResolvedValue({ count: 1 });

      // Step 1: POST /identify to receive the signed cookie
      const identifyRes = await app.inject({
        method: "POST",
        url: `/shares/alias/${ALIAS}/identify`,
        headers: { "content-type": "application/json" },
        payload: { name: "Alice Smith", email: "alice@example.com" },
      });

      expect(identifyRes.statusCode).toBe(200);
      expect(identifyRes.json()).toEqual({ success: true });

      // Extract the signed cookie set by the identify endpoint
      const cookie = identifyRes.cookies.find((c: { name: string }) => c.name === `sv_${ALIAS}`);
      expect(cookie).toBeDefined();

      // Step 2: GET /alias/:alias — re-send the cookie, expect 200 (gate bypassed)
      const getRes = await app.inject({
        method: "GET",
        url: `/shares/alias/${ALIAS}`,
        cookies: { [`sv_${ALIAS}`]: cookie!.value },
      });

      expect(getRes.statusCode).toBe(200);
    });
  });
});
