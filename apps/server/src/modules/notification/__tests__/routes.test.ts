/**
 * routes.test.ts
 *
 * Integration tests for notification routes using app.inject().
 *
 * Tests the full request lifecycle for:
 * - GET  /notifications/preferences  — authenticated, returns all types
 * - PUT  /notifications/preferences  — authenticated, updates preferences
 * - GET  /notifications/unsubscribe  — public, renders HTML confirmation
 * - POST /notifications/unsubscribe  — public, performs unsubscribe
 *
 * Mock path notes: all vi.mock() specifiers are resolved relative to the
 * CALLING TEST FILE (src/modules/notification/__tests__/routes.test.ts),
 * not the project root.
 */

import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock Prisma ──────────────────────────────────────────────────────────────

const mockPrisma = {
  user: {
    count: vi.fn().mockResolvedValue(1),
    findUnique: vi.fn(),
  },
  notificationPreference: {
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn().mockResolvedValue(null),
    upsert: vi.fn().mockResolvedValue({}),
  },
  emailJob: {
    count: vi.fn().mockResolvedValue(0),
    create: vi.fn().mockResolvedValue({ id: "test-job-id" }),
    findFirst: vi.fn().mockResolvedValue(null),
  },
};

vi.mock("../../../shared/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue({ enqueued: true }),
  },
}));

// ─── Mock config service ───────────────────────────────────────────────────────

vi.mock("../../../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    if (key === "passwordMinLength") return "8";
    if (key === "passwordAuthEnabled") return "true";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

// ─── Mock token version ───────────────────────────────────────────────────────

vi.mock("../../../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ─── Static imports of mocked modules (must come AFTER vi.mock hoisting) ─────

import { emailService } from "../../email/service.js";

// ─── Token helpers ────────────────────────────────────────────────────────────

const JWT_SECRET = "a]test-jwt-secret-32-chars-long!";
const UNSUBSCRIBE_KEY_LABEL = "unsubscribe";
const UNSUBSCRIBE_TOKEN_EXPIRY_SECONDS = 90 * 24 * 60 * 60; // 90 days

function deriveKey(label: string): Buffer {
  return crypto.createHmac("sha256", JWT_SECRET).update(label).digest();
}

function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

/**
 * Creates a valid unsubscribe token using the same algorithm as email/service.ts.
 * Used in tests to generate tokens without exposing the private function.
 */
function signUnsubscribeToken(
  payload: { userId: string; type: string },
  expiresInSeconds = UNSUBSCRIBE_TOKEN_EXPIRY_SECONDS,
): string {
  const key = deriveKey(UNSUBSCRIBE_KEY_LABEL);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + expiresInSeconds,
    }),
  );

  const signature = base64url(
    crypto.createHmac("sha256", key).update(`${header}.${body}`).digest(),
  );

  return `${header}.${body}.${signature}`;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Notification routes — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", JWT_SECRET);
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../../../app.js");
    app = await buildApp();

    const { notificationRoutes } = await import("../routes.js");
    app.register(notificationRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish defaults after clearAllMocks (clearAllMocks keeps
    // implementations, so reset findUnique to avoid locale leaking between tests).
    vi.mocked(mockPrisma.user.count).mockResolvedValue(1);
    vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(null as never);
    vi.mocked(mockPrisma.notificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(mockPrisma.notificationPreference.upsert).mockResolvedValue({} as never);
    vi.mocked(mockPrisma.emailJob.count).mockResolvedValue(0);
    vi.mocked(mockPrisma.emailJob.create).mockResolvedValue({ id: "test-job-id" } as never);
  });

  // ── Helpers ───────────────────────────────────────────────────────────────

  function signUserToken(userId = "user-1"): string {
    const jwt = app.jwt.sign({ userId, isAdmin: false, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  function signAdminToken(userId = "admin-user"): string {
    const jwt = app.jwt.sign({ userId, isAdmin: true, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = res.json();
    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /notifications/preferences
  // ═══════════════════════════════════════════════════════════════════════════

  describe("GET /notifications/preferences", () => {
    it("returns 200 with all notification types including defaults", async () => {
      const token = signUserToken();

      const res = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("preferences");
      expect(Array.isArray(body.preferences)).toBe(true);

      // Should include all catalog types (22 types)
      expect(body.preferences.length).toBeGreaterThan(0);

      // Each item should have the expected shape
      const firstPref = body.preferences[0];
      expect(firstPref).toHaveProperty("type");
      expect(firstPref).toHaveProperty("frequency");
      expect(firstPref).toHaveProperty("configurable");
      expect(firstPref).toHaveProperty("isCritical");
      expect(firstPref).toHaveProperty("defaultFrequency");
    });

    it("returns stored preference when user has one set", async () => {
      // Mock a stored preference for share_expiring → disabled
      vi.mocked(mockPrisma.notificationPreference.findMany).mockResolvedValue([
        {
          id: "pref-1",
          userId: "user-1",
          type: "share_expiring",
          frequency: "disabled",
        } as never,
      ]);

      const token = signUserToken();

      const res = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      const shareExpiringPref = body.preferences.find(
        (p: { type: string }) => p.type === "share_expiring",
      );
      expect(shareExpiringPref).toBeDefined();
      expect(shareExpiringPref.frequency).toBe("disabled");
    });

    it("returns catalog default when user has no stored preference", async () => {
      vi.mocked(mockPrisma.notificationPreference.findMany).mockResolvedValue([]);

      const token = signUserToken();

      const res = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();

      // share_accessed defaults to "disabled"
      const shareAccessedPref = body.preferences.find(
        (p: { type: string }) => p.type === "share_accessed",
      );
      expect(shareAccessedPref).toBeDefined();
      expect(shareAccessedPref.frequency).toBe("disabled");
      expect(shareAccessedPref.configurable).toBe(true);

      // welcome defaults to "immediate" and is non-configurable
      const welcomePref = body.preferences.find((p: { type: string }) => p.type === "welcome");
      expect(welcomePref).toBeDefined();
      expect(welcomePref.frequency).toBe("immediate");
      expect(welcomePref.configurable).toBe(false);
    });

    it("returns 401 when not authenticated", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/notifications/preferences",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // PUT /notifications/preferences
  // ═══════════════════════════════════════════════════════════════════════════

  describe("PUT /notifications/preferences", () => {
    it("returns 200 when updating a configurable type", async () => {
      const token = signUserToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({
          preferences: [{ type: "share_expiring", frequency: "disabled" }],
        }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.message).toBe("Notification preferences updated");
    });

    it("calls upsert for the updated preference", async () => {
      const token = signUserToken("user-42");
      const { csrfToken, csrfCookie } = await getCsrf();

      await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({
          preferences: [{ type: "share_expiring", frequency: "immediate" }],
        }),
      });

      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledOnce();
      const upsertCall = vi.mocked(mockPrisma.notificationPreference.upsert).mock.calls[0][0];
      expect(upsertCall.where).toEqual({
        userId_type: { userId: "user-42", type: "share_expiring" },
      });
      expect(upsertCall.create.frequency).toBe("immediate");
      expect(upsertCall.update.frequency).toBe("immediate");
    });

    it("returns 400 when trying to update a non-configurable type", async () => {
      const token = signUserToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({
          preferences: [{ type: "welcome", frequency: "disabled" }],
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when frequency is 'daily_digest'", async () => {
      const token = signUserToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({
          preferences: [{ type: "share_expiring", frequency: "daily_digest" }],
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when notification type does not exist", async () => {
      const token = signUserToken();
      const { csrfToken, csrfCookie } = await getCsrf();

      const res = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({
          preferences: [{ type: "nonexistent_type", frequency: "disabled" }],
        }),
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 401 or 403 when not authenticated", async () => {
      // CSRF hook fires before JWT validation for PUT — either 401 or 403 is acceptable
      const res = await app.inject({
        method: "PUT",
        url: "/notifications/preferences",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({
          preferences: [{ type: "share_expiring", frequency: "disabled" }],
        }),
      });

      expect([401, 403]).toContain(res.statusCode);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /notifications/unsubscribe
  // ═══════════════════════════════════════════════════════════════════════════

  describe("GET /notifications/unsubscribe", () => {
    it("returns HTML confirmation page with valid token (does NOT unsubscribe)", async () => {
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" });

      const res = await app.inject({
        method: "GET",
        url: `/notifications/unsubscribe?token=${token}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");

      const html = res.payload;
      expect(html).toContain("Unsubscribe from notifications");
      // Uses the human-readable displayName from the catalog instead of the raw type key
      expect(html).toContain("Share Expiring Soon");
      expect(html).toContain("Confirm Unsubscribe");

      // The GET endpoint must NOT have unsubscribed the user
      expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });

    it("renders the confirmation page in the user's locale (French)", async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ locale: "fr" } as never);
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" });

      const res = await app.inject({
        method: "GET",
        url: `/notifications/unsubscribe?token=${token}`,
      });

      expect(res.statusCode).toBe(200);
      const html = res.payload;
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain("Se désabonner des notifications");
      expect(html).toContain("Confirmer le désabonnement");
    });

    it("returns error HTML page with an invalid token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/notifications/unsubscribe?token=invalid.token.value",
      });

      // Even with invalid token, returns 200 HTML (not 4xx)
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");

      const html = res.payload;
      expect(html).toContain("Invalid or expired unsubscribe link");
    });

    it("returns 400 when token query parameter is missing", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/notifications/unsubscribe",
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /notifications/unsubscribe
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /notifications/unsubscribe", () => {
    it("returns success HTML page and sets preference to disabled with valid token", async () => {
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" });

      const res = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");

      const html = res.payload;
      expect(html).toContain("Successfully unsubscribed");
      // Uses the human-readable displayName from the catalog instead of the raw type key
      expect(html).toContain("Share Expiring Soon");

      // Should have called upsert to set frequency to disabled
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledOnce();
      const upsertCall = vi.mocked(mockPrisma.notificationPreference.upsert).mock.calls[0][0];
      expect(upsertCall.where).toEqual({
        userId_type: { userId: "user-1", type: "share_expiring" },
      });
      expect(upsertCall.create.frequency).toBe("disabled");
      expect(upsertCall.update.frequency).toBe("disabled");
    });

    it("renders the success page in the user's locale (French)", async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({ locale: "fr" } as never);
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" });

      const res = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token }),
      });

      expect(res.statusCode).toBe(200);
      const html = res.payload;
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain("Désabonnement réussi");
    });

    it("returns error HTML page with expired token", async () => {
      // Token with -1 second expiry (already expired)
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" }, -1);

      const res = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");

      const html = res.payload;
      expect(html).toContain("Invalid or expired unsubscribe link");

      // Should NOT have called upsert
      expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });

    it("returns error HTML page with invalid token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token: "not.a.valid.jwt" }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");

      const html = res.payload;
      expect(html).toContain("Invalid or expired unsubscribe link");

      expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });

    it("is idempotent — re-unsubscribing succeeds without error", async () => {
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" });

      // First unsubscribe
      const res1 = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token }),
      });

      expect(res1.statusCode).toBe(200);
      expect(res1.payload).toContain("Successfully unsubscribed");

      // Second unsubscribe with same token
      const res2 = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token }),
      });

      expect(res2.statusCode).toBe(200);
      expect(res2.payload).toContain("Successfully unsubscribed");

      // Upsert called twice — idempotent by design
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledTimes(2);
    });

    it("is CSRF-exempt — succeeds without CSRF token", async () => {
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" });

      // No CSRF token or cookie in headers
      const res = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ token }),
      });

      // Should succeed, not return 403
      expect(res.statusCode).toBe(200);
      expect(res.payload).toContain("Successfully unsubscribed");
    });

    it("accepts form-urlencoded body (HTML form submission)", async () => {
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" });

      const res = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: `token=${encodeURIComponent(token)}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.payload).toContain("Successfully unsubscribed");
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledOnce();
    });

    it("accepts token from query string (RFC 8058 one-click unsubscribe)", async () => {
      const token = signUnsubscribeToken({ userId: "user-1", type: "share_expiring" });

      // RFC 8058: mail client POSTs to List-Unsubscribe URL with
      // List-Unsubscribe=One-Click body, token is in the URL query
      const res = await app.inject({
        method: "POST",
        url: `/notifications/unsubscribe?token=${encodeURIComponent(token)}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.payload).toContain("Successfully unsubscribed");
      expect(mockPrisma.notificationPreference.upsert).toHaveBeenCalledOnce();
    });

    it("returns error page when no token is provided anywhere", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/notifications/unsubscribe",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "List-Unsubscribe=One-Click",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.payload).toContain("Invalid or expired unsubscribe link");
      expect(mockPrisma.notificationPreference.upsert).not.toHaveBeenCalled();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Admin email endpoints
  // ═══════════════════════════════════════════════════════════════════════════

  describe("admin email endpoints", () => {
    // ── GET /admin/email/stats ─────────────────────────────────────────────

    it("GET /admin/email/stats returns counters", async () => {
      // evaluateEmailHealth issues the four counts via Promise.all in this exact
      // order: pending, sentLast24h, failed, digestPending.
      vi.mocked(mockPrisma.emailJob.count)
        .mockResolvedValueOnce(5) // pending
        .mockResolvedValueOnce(42) // sentLast24h
        .mockResolvedValueOnce(3) // failed
        .mockResolvedValueOnce(7); // digestPending
      // No job carries a lastError in this scenario.
      vi.mocked(mockPrisma.emailJob.findFirst).mockResolvedValueOnce(null);

      const token = signAdminToken();

      const res = await app.inject({
        method: "GET",
        url: "/admin/email/stats",
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // smtpEnabled resolves "true" (mock default) ⇒ smtpConfigured. failed=3 with
      // sentLast24h>0 ⇒ degraded. No lastError job ⇒ null.
      expect(body).toEqual({
        pending: 5,
        sentLast24h: 42,
        failed: 3,
        digestPending: 7,
        status: "degraded",
        smtpConfigured: true,
        lastError: null,
      });
    });

    it("GET /admin/email/stats rejected for non-admin", async () => {
      const token = signUserToken();

      const res = await app.inject({
        method: "GET",
        url: "/admin/email/stats",
        headers: { cookie: `token=${token}` },
      });

      expect(res.statusCode).toBe(403);
    });

    // ── POST /admin/email/test ─────────────────────────────────────────────

    it("POST /admin/email/test creates EmailJob via emailService.send", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const token = signAdminToken();

      const res = await app.inject({
        method: "POST",
        url: "/admin/email/test",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({ to: "admin@example.com" }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toEqual({ success: true, message: "Test email queued" });

      expect(vi.mocked(emailService.send)).toHaveBeenCalledOnce();
      expect(vi.mocked(emailService.send)).toHaveBeenCalledWith("test_email", {
        to: "admin@example.com",
        locale: "en",
        data: {},
      });
    });

    it("POST /admin/email/test rejected for non-admin", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const token = signUserToken();

      const res = await app.inject({
        method: "POST",
        url: "/admin/email/test",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({ to: "user@example.com" }),
      });

      expect(res.statusCode).toBe(403);
    });

    it("POST /admin/email/test with invalid email → 400", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const token = signAdminToken();

      const res = await app.inject({
        method: "POST",
        url: "/admin/email/test",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify({ to: "not-a-valid-email" }),
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
