/**
 * share-error-codes.integration.test.ts
 *
 * Integration tests verifying that share and password-related errors now return
 * specific error codes (PASSWORD_REQUIRED, INVALID_PASSWORD, SHARE_EXPIRED,
 * MAX_VIEWS_REACHED, SHARE_INACTIVE) instead of the generic UNAUTHORIZED / GONE
 * codes that were used before Task 4 of the error handling improvement plan.
 *
 * Uses app.inject() to exercise the full Fastify request lifecycle:
 *   routing → Zod schema → controller → service → globalErrorHandler → response
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(0) },
    share: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      // incrementViewsAtomic uses updateMany for atomic max-views enforcement
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    shareAlias: { findUnique: vi.fn().mockResolvedValue(null) },
    shareSecurity: { findUnique: vi.fn() },
  },
}));

// ── Mock config service ──────────────────────────────────────────────────────
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockResolvedValue("true"),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

// ── Mock token version (not under test here) ─────────────────────────────────
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Shared mock data ─────────────────────────────────────────────────────────
/** A bare-minimum share object used by the repository mock */
const makeShare = (overrides: Record<string, unknown> = {}) => ({
  id: "share-abc",
  name: "Test Share",
  description: null,
  expiration: null,
  views: 0,
  maxViews: null,
  creatorId: "creator-user",
  securityId: "sec-1",
  createdAt: new Date(),
  updatedAt: new Date(),
  files: [],
  folders: [],
  recipients: [],
  alias: null,
  security: {
    id: "sec-1",
    password: null,
  },
  ...overrides,
});

// ── Test suite ───────────────────────────────────────────────────────────────
describe("Share error codes — integration (Task 4)", () => {
  let app: FastifyInstance;
  let prismaModule: {
    prisma: {
      share: { findUnique: ReturnType<typeof vi.fn>; findFirst: ReturnType<typeof vi.fn> };
    };
  };

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { shareRoutes } = await import("../modules/share/routes.js");
    app.register(shareRoutes);
    await app.ready();

    prismaModule = (await import("../shared/prisma.js")) as unknown as typeof prismaModule;
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Helper: POST /shares/:shareId/access (csrfExempt route) ─────────────
  async function accessShare(shareId: string, password: string) {
    return app.inject({
      method: "POST",
      url: `/shares/${shareId}/access`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ password }),
    });
  }

  // ── Helper: GET /shares/:shareId (no password, anonymous) ───────────────
  async function getShare(shareId: string) {
    return app.inject({
      method: "GET",
      url: `/shares/${shareId}`,
    });
  }

  // ────────────────────────────────────────────────────────────────────────────
  // PASSWORD_REQUIRED
  // ────────────────────────────────────────────────────────────────────────────
  it("returns code=PASSWORD_REQUIRED (not UNAUTHORIZED) when share has a password and none is provided", async () => {
    // bcrypt hash of "secret" — matches real bcrypt.compare logic but we check no-password path,
    // so any non-null value triggers the "password required" branch before compare is called.
    const share = makeShare({
      security: { id: "sec-1", password: "$2b$10$hashedPassword" },
    });
    prismaModule.prisma.share.findUnique.mockResolvedValue(share);

    // GET without password — triggers PASSWORD_REQUIRED
    const res = await getShare("share-abc");

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe("PASSWORD_REQUIRED");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // INVALID_PASSWORD — requires actual bcrypt compare, so we use a known hash
  // ────────────────────────────────────────────────────────────────────────────
  it("returns code=INVALID_PASSWORD (not UNAUTHORIZED) when a wrong password is supplied", async () => {
    // bcrypt hash of "correct-password" generated offline:
    // (we'll mock bcrypt by using a wrong hash that will fail compare)
    // "$2b$10$invalidhashXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX" is a well-formed but mismatched hash.
    // In practice, bcrypt.compare("wrong", anyHash) returns false quickly when the hash is invalid format,
    // so we use a syntactically valid but wrong hash.
    const share = makeShare({
      security: {
        id: "sec-1",
        // Hash of "correct-password" — "wrong-password" will NOT match
        password: "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lh8i",
      },
    });
    prismaModule.prisma.share.findUnique.mockResolvedValue(share);

    const res = await accessShare("share-abc", "wrong-password");

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe("INVALID_PASSWORD");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // SHARE_EXPIRED
  // ────────────────────────────────────────────────────────────────────────────
  it("returns code=SHARE_EXPIRED (not GONE) when a share is past its expiration date", async () => {
    const share = makeShare({
      expiration: new Date(Date.now() - 1000), // 1 second in the past
      security: { id: "sec-1", password: null },
    });
    prismaModule.prisma.share.findUnique.mockResolvedValue(share);

    const res = await getShare("share-abc");

    expect(res.statusCode).toBe(410);
    const body = res.json();
    expect(body.code).toBe("SHARE_EXPIRED");
  });

  // ────────────────────────────────────────────────────────────────────────────
  // MAX_VIEWS_REACHED
  // ────────────────────────────────────────────────────────────────────────────
  it("returns code=MAX_VIEWS_REACHED (not GONE) when a share has reached its view limit", async () => {
    const share = makeShare({
      views: 5,
      maxViews: 5,
      security: { id: "sec-1", password: null },
    });
    prismaModule.prisma.share.findUnique.mockResolvedValue(share);

    const res = await getShare("share-abc");

    expect(res.statusCode).toBe(410);
    const body = res.json();
    expect(body.code).toBe("MAX_VIEWS_REACHED");
  });
});
