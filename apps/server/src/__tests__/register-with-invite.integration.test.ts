/**
 * register-with-invite.integration.test.ts
 *
 * Integration tests verifying that POST /register-with-invite returns structured
 * error codes (INVITE_TOKEN_USED, INVITE_TOKEN_EXPIRED, USERNAME_EXISTS,
 * EMAIL_EXISTS) instead of relying on human-readable English messages.
 *
 * Uses app.inject() to exercise the full Fastify request lifecycle:
 *   routing → Zod schema → controller → service → globalErrorHandler → response
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    inviteToken: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ── Mock config service ──────────────────────────────────────────────────────
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

// ── Mock email service (prevent side effects) ────────────────────────────────
vi.mock("../modules/email/service.js", () => ({
  emailService: {
    send: vi.fn(),
    sendToAdmins: vi.fn().mockResolvedValue(undefined),
  },
}));

// ── Mock audit service (prevent side effects) ────────────────────────────────
vi.mock("../modules/audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Shared helpers ───────────────────────────────────────────────────────────

const VALID_TOKEN = "a".repeat(64); // 32 bytes hex = 64 chars

const makeInviteToken = (overrides: Record<string, unknown> = {}) => ({
  id: "invite-token-1",
  token: VALID_TOKEN,
  expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from now
  usedAt: null,
  createdBy: "admin-user-1",
  createdAt: new Date(),
  ...overrides,
});

const validPayload = () => ({
  token: VALID_TOKEN,
  firstName: "Alice",
  lastName: "Smith",
  username: "alicesmith",
  email: "alice@example.com",
  password: "securepassword1",
});

// ── Test suite ───────────────────────────────────────────────────────────────
describe("POST /register-with-invite — structured error codes (TD-37)", () => {
  let app: FastifyInstance;
  let prismaModule: {
    prisma: {
      user: {
        count: ReturnType<typeof vi.fn>;
        findFirst: ReturnType<typeof vi.fn>;
        create: ReturnType<typeof vi.fn>;
      };
      inviteToken: {
        findUnique: ReturnType<typeof vi.fn>;
        update: ReturnType<typeof vi.fn>;
      };
      $transaction: ReturnType<typeof vi.fn>;
    };
  };

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { inviteRoutes } = await import("../modules/invite/routes.js");
    app.register(inviteRoutes);
    await app.ready();

    prismaModule = (await import("../shared/prisma.js")) as unknown as typeof prismaModule;
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset user.count to 1 so setup middleware doesn't redirect to /setup
    prismaModule.prisma.user.count.mockResolvedValue(1);
  });

  // ── Helper ────────────────────────────────────────────────────────────────

  async function postRegister(payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: "/register-with-invite",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify(payload),
    });
  }

  // ── Test 1: INVITE_TOKEN_USED (409) ──────────────────────────────────────
  it("returns INVITE_TOKEN_USED (409) when token has already been used", async () => {
    prismaModule.prisma.inviteToken.findUnique.mockResolvedValue(
      makeInviteToken({ usedAt: new Date(Date.now() - 60_000) }),
    );

    const res = await postRegister(validPayload());

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("INVITE_TOKEN_USED");
  });

  // ── Test 2: INVITE_TOKEN_EXPIRED (410) ───────────────────────────────────
  it("returns INVITE_TOKEN_EXPIRED (410) when token has expired", async () => {
    prismaModule.prisma.inviteToken.findUnique.mockResolvedValue(
      makeInviteToken({ expiresAt: new Date(Date.now() - 60_000) }),
    );

    const res = await postRegister(validPayload());

    expect(res.statusCode).toBe(410);
    const body = res.json();
    expect(body.code).toBe("INVITE_TOKEN_EXPIRED");
  });

  // ── Test 3: NOT_FOUND (404) when token doesn't exist ─────────────────────
  it("returns NOT_FOUND (404) when token does not exist", async () => {
    prismaModule.prisma.inviteToken.findUnique.mockResolvedValue(null);

    const res = await postRegister(validPayload());

    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body.code).toBe("NOT_FOUND");
  });

  // ── Test 4: USERNAME_EXISTS (409) ────────────────────────────────────────
  it("returns USERNAME_EXISTS (409) when username is already taken", async () => {
    prismaModule.prisma.inviteToken.findUnique.mockResolvedValue(makeInviteToken());
    prismaModule.prisma.user.findFirst.mockResolvedValue({
      id: "existing-user-1",
      username: "alicesmith",
      email: "other@example.com",
    });

    const res = await postRegister(validPayload());

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("USERNAME_EXISTS");
  });

  // ── Test 5: EMAIL_EXISTS (409) ───────────────────────────────────────────
  it("returns EMAIL_EXISTS (409) when email is already taken", async () => {
    prismaModule.prisma.inviteToken.findUnique.mockResolvedValue(makeInviteToken());
    prismaModule.prisma.user.findFirst.mockResolvedValue({
      id: "existing-user-2",
      username: "differentuser",
      email: "alice@example.com",
    });

    const res = await postRegister(validPayload());

    expect(res.statusCode).toBe(409);
    const body = res.json();
    expect(body.code).toBe("EMAIL_EXISTS");
  });

  // ── Test 6: Success (200) ────────────────────────────────────────────────
  it("returns 200 with user data on successful registration", async () => {
    const newUser = {
      id: "new-user-1",
      username: "alicesmith",
      email: "alice@example.com",
    };

    prismaModule.prisma.inviteToken.findUnique.mockResolvedValue(makeInviteToken());
    prismaModule.prisma.user.findFirst.mockResolvedValue(null);
    prismaModule.prisma.$transaction.mockImplementation(
      async (fn: (tx: typeof prismaModule.prisma) => Promise<unknown>) => {
        const tx = {
          user: {
            create: vi.fn().mockResolvedValue(newUser),
          },
          inviteToken: {
            update: vi.fn().mockResolvedValue({ id: "invite-token-1" }),
          },
        };
        return fn(tx as unknown as typeof prismaModule.prisma);
      },
    );

    const res = await postRegister(validPayload());

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.message).toBe("User registered successfully");
    expect(body.user.username).toBe("alicesmith");
    expect(body.user.email).toBe("alice@example.com");
    expect(body.user.id).toBe("new-user-1");
  });
});
