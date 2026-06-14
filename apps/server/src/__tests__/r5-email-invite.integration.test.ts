/**
 * r5-email-invite.integration.test.ts (R5)
 *
 * Full request-lifecycle integration tests (app.inject) for R5 email/invite
 * hardening:
 *  - A6-02: strict per-IP rate limit on POST /register-with-invite (bcrypt-DoS bound).
 *  - A6-04: an email-bound invite token rejects a mismatched registrant email (403).
 *  - A6-03: the per-user outbound-email quota is enforced on the share notify route (429).
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted prisma mock fns ───────────────────────────────────────────────────
const {
  mockInviteFindUnique,
  mockInviteUpdateMany,
  mockUserFindFirst,
  mockUserCreate,
  mockShareFindUnique,
  mockShareRecipientUpdate,
  mockUserFindUnique,
  mockEmailJobCount,
} = vi.hoisted(() => ({
  mockInviteFindUnique: vi.fn(),
  mockInviteUpdateMany: vi.fn(),
  mockUserFindFirst: vi.fn(),
  mockUserCreate: vi.fn(),
  mockShareFindUnique: vi.fn(),
  mockShareRecipientUpdate: vi.fn().mockResolvedValue({}),
  mockUserFindUnique: vi.fn(),
  mockEmailJobCount: vi.fn().mockResolvedValue(0),
}));

vi.mock("../shared/prisma.js", () => {
  const prisma = {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: mockUserFindUnique,
      findFirst: mockUserFindFirst,
      create: mockUserCreate,
    },
    inviteToken: {
      findUnique: mockInviteFindUnique,
      updateMany: mockInviteUpdateMany,
    },
    share: {
      findUnique: mockShareFindUnique,
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    shareRecipient: { update: mockShareRecipientUpdate },
    shareAlias: { findUnique: vi.fn().mockResolvedValue(null) },
    notificationPreference: { findUnique: vi.fn().mockResolvedValue(null) },
    emailJob: { count: mockEmailJobCount },
    $transaction: vi.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
  };
  return { prisma };
});

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

vi.mock("../modules/audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../modules/email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue({ enqueued: true }),
    sendToAdmins: vi.fn().mockResolvedValue({ enqueued: true }),
  },
}));

vi.mock("../modules/email/url-builder.js", () => ({
  buildShareLink: vi.fn(async (alias: string) => `https://app.example.com/s/${alias}`),
  buildInviteRegistrationUrl: vi.fn(
    async (token: string) => `https://app.example.com/register-with-invite/${token}`,
  ),
}));

const FUTURE = new Date(Date.now() + 10 * 60 * 1000);

function registerBody(email: string) {
  return {
    token: "tok-abc",
    firstName: "Mallory",
    lastName: "Example",
    username: "mallory",
    email,
    password: "correct-horse-battery-staple",
  };
}

describe("R5 email/invite hardening — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();
    const { inviteRoutes } = await import("../modules/invite/routes.js");
    const { shareRoutes } = await import("../modules/share/routes.js");
    app.register(inviteRoutes);
    app.register(shareRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockEmailJobCount.mockResolvedValue(0);
    mockShareRecipientUpdate.mockResolvedValue({});
  });

  // ── A6-04: email-bound invite rejects a mismatched registrant email ─────────

  it("A6-04: rejects registration with a mismatched email on an email-bound token (403)", async () => {
    mockInviteFindUnique.mockResolvedValue({
      id: "invite-1",
      token: "tok-abc",
      email: "alice@corp.example",
      usedAt: null,
      expiresAt: FUTURE,
    });

    const res = await app.inject({
      method: "POST",
      url: "/register-with-invite",
      headers: { "content-type": "application/json" },
      remoteAddress: "10.20.0.1",
      payload: JSON.stringify(registerBody("mallory@evil.example")),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("INVITE_EMAIL_MISMATCH");
    // The bcrypt+claim path must not have run for a mismatched email.
    expect(mockInviteUpdateMany).not.toHaveBeenCalled();
    expect(mockUserCreate).not.toHaveBeenCalled();
  });

  it("A6-04: accepts the bound email case-insensitively", async () => {
    mockInviteFindUnique.mockResolvedValue({
      id: "invite-1",
      token: "tok-abc",
      email: "alice@corp.example",
      usedAt: null,
      expiresAt: FUTURE,
    });
    mockUserFindFirst.mockResolvedValue(null);
    mockInviteUpdateMany.mockResolvedValue({ count: 1 });
    mockUserCreate.mockResolvedValue({
      id: "user-1",
      username: "mallory",
      email: "alice@corp.example",
    });

    const res = await app.inject({
      method: "POST",
      url: "/register-with-invite",
      headers: { "content-type": "application/json" },
      remoteAddress: "10.20.0.2",
      payload: JSON.stringify(registerBody("Alice@Corp.Example")),
    });

    expect(res.statusCode).toBe(200);
    expect(mockUserCreate).toHaveBeenCalledTimes(1);
  });

  // ── A6-02: strict per-IP rate limit on POST /register-with-invite ───────────

  it("A6-02: rate-limits POST /register-with-invite at 5/min per IP", async () => {
    // Unknown token → cheap pre-flight 404 (ahead of bcrypt). We only care that the
    // 6th request from the same IP is throttled with 429.
    mockInviteFindUnique.mockResolvedValue(null);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "POST",
        url: "/register-with-invite",
        headers: { "content-type": "application/json" },
        remoteAddress: "10.20.1.1",
        payload: JSON.stringify(registerBody("someone@example.com")),
      });
      statuses.push(res.statusCode);
    }

    // First 5 pass the limiter (404 unknown token); the 6th is rate-limited.
    expect(statuses.slice(0, 5).every((s) => s === 404)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  it("A6-08: rate-limits GET /invite-tokens/:token at 5/min per IP", async () => {
    mockInviteFindUnique.mockResolvedValue(null);

    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({
        method: "GET",
        url: "/invite-tokens/probe-token",
        remoteAddress: "10.20.1.2",
      });
      statuses.push(res.statusCode);
    }

    expect(statuses.slice(0, 5).every((s) => s === 200)).toBe(true);
    expect(statuses[5]).toBe(429);
  });

  // ── A6-03: per-user email quota enforced on the share notify route ──────────

  it("A6-03: returns 429 when the share owner's email quota is exhausted", async () => {
    // The owner already sits at the daily cap, so any further notify is rejected.
    mockEmailJobCount.mockResolvedValue(100_000);
    mockUserFindUnique.mockResolvedValue({ id: "owner-1", tokenVersion: 0, locale: "en" });
    mockShareFindUnique.mockResolvedValue({
      id: "share-1",
      creatorId: "owner-1",
      name: "Docs",
      expiration: null,
      alias: { alias: "my-alias" },
      security: { password: null },
      recipients: [
        {
          id: "rec-1",
          email: "ext@example.com",
          trackingToken: "tok",
          notifiedAt: null,
          lastDownloadedAt: null,
        },
      ],
    });

    const jwt = app.jwt.sign({ userId: "owner-1", isAdmin: false, tokenVersion: 0 });
    const cookie = app.signCookie(jwt);
    const csrf = await app.inject({ method: "GET", url: "/csrf-token" });
    const csrfToken = csrf.json().token;
    const csrfCookie = csrf.cookies.find((c) => c.name === "_csrf")?.value ?? "";

    const res = await app.inject({
      method: "POST",
      url: "/shares/share-1/notify",
      headers: {
        cookie: `token=${cookie}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
        "content-type": "application/json",
      },
      payload: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(429);
    expect(res.json().code).toBe("RATE_LIMITED");
    // No recipient was marked notified — the quota gate short-circuited the loop.
    expect(mockShareRecipientUpdate).not.toHaveBeenCalled();
  });
});
