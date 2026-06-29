/**
 * invite-register-locale.integration.test.ts
 *
 * Full request-lifecycle (`app.inject()`) coverage for email-language seeding on
 * the invite-registration path (`POST /register-with-invite`), mirroring the
 * `/auth/register` seeding trio in `setup-bypass-register.integration.test.ts`.
 *
 * Proves the locale the invitee registered under (NEXT_LOCALE cookie /
 * Accept-Language) reaches `prisma.user.create`, so invitations *they* later send
 * default to their own language. `/register-with-invite` is `csrfExempt`, so no
 * CSRF token dance is needed.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Captures the row passed to the transactional user.create so tests can assert
// the seeded locale.
let createdUser: Record<string, unknown> | null = null;

const mockTokenFindUnique = vi.fn();
const mockUserFindFirst = vi.fn();
const mockTokenUpdateMany = vi.fn();
const mockUserCreate = vi.fn();
const mockAuditCreate = vi.fn();

vi.mock("../shared/prisma.js", () => {
  const tx = {
    inviteToken: { updateMany: mockTokenUpdateMany, findUnique: mockTokenFindUnique },
    user: { create: mockUserCreate },
  };
  return {
    prisma: {
      inviteToken: { findUnique: mockTokenFindUnique },
      user: { findFirst: mockUserFindFirst },
      auditLog: { create: mockAuditCreate },
      // registerWithInvite runs its claim + create inside a transaction; invoke
      // the callback with a tx facade exposing the mutations it touches.
      // biome-ignore lint/suspicious/noExplicitAny: test harness passthrough
      $transaction: vi.fn(async (cb: any) => cb(tx)),
    },
  };
});

vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn(async () => "true"),
}));

vi.mock("../modules/email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(undefined),
    sendToAdmins: vi.fn().mockResolvedValue({ enqueued: true }),
  },
}));

const STRONG_PASSWORD = "InvitePass123!"; // ≥ 8 chars

const REGISTER_BODY = {
  token: "valid-open-token",
  firstName: "Ada",
  lastName: "Lovelace",
  username: "ada",
  email: "ada@example.com",
  password: STRONG_PASSWORD,
};

describe("invite-registration — email-language seeding", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("ENCRYPTION_SECRET", "test-encryption-secret-3333333333-32+chars");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();
    const { inviteRoutes } = await import("../modules/invite/routes.js");
    app.register(inviteRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    createdUser = null;

    // Open (bearer) token: not bound to an email, unused, far from expiry.
    mockTokenFindUnique.mockResolvedValue({
      id: "invite-1",
      email: null,
      usedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    mockUserFindFirst.mockResolvedValue(null);
    mockTokenUpdateMany.mockResolvedValue({ count: 1 });
    mockAuditCreate.mockResolvedValue({});
    mockUserCreate.mockImplementation(async (arg: { data: Record<string, unknown> }) => {
      createdUser = arg.data;
      return { id: "new-user-1", username: arg.data.username, email: arg.data.email };
    });
  });

  it("seeds the new user's locale from the NEXT_LOCALE cookie", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/register-with-invite",
      headers: { cookie: "NEXT_LOCALE=fr-FR" },
      payload: REGISTER_BODY,
    });

    expect(res.statusCode).toBe(200);
    expect(createdUser?.locale).toBe("fr-FR");
  });

  it("seeds locale from Accept-Language (base-language match) when no cookie is set", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/register-with-invite",
      headers: { "accept-language": "fr-CA,fr;q=0.9" },
      payload: REGISTER_BODY,
    });

    expect(res.statusCode).toBe(200);
    // fr-CA isn't a shipped UI locale, but resolves to fr-FR by base language.
    expect(createdUser?.locale).toBe("fr-FR");
  });

  it("leaves locale unset when the request carries no usable locale signal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/register-with-invite",
      headers: { "accept-language": "xx-XX" },
      payload: REGISTER_BODY,
    });

    expect(res.statusCode).toBe(200);
    // No signal → undefined so Prisma applies the column default ("en").
    expect(createdUser?.locale).toBeUndefined();
  });
});
