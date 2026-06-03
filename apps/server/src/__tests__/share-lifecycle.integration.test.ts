/**
 * share-lifecycle.integration.test.ts
 *
 * Phase A.1 Batch 2 — read-time deactivation gating for regular shares.
 *
 * Exercises the full Fastify lifecycle via app.inject():
 *   routing → Zod schema → controller → service → globalErrorHandler → response
 *
 * Covers:
 *  - A deactivated share is blocked, with the response chosen by deactivationReason
 *    (expired/max_views → 410 SHARE_EXPIRED/MAX_VIEWS_REACHED, manual → 403 SHARE_INACTIVE).
 *  - An active share is reachable (200).
 *  - The owner is never blocked from their own deactivated share (owner-self path).
 *  - Hitting maxViews at read time persists the deactivation (isActive=false / reason).
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
      update: vi.fn().mockResolvedValue({ views: 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    shareAlias: { findUnique: vi.fn().mockResolvedValue(null) },
    shareSecurity: { findUnique: vi.fn() },
    shareVisit: { create: vi.fn().mockResolvedValue({ id: "visit-1" }) },
    shareRecipient: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
    auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
  },
}));

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

vi.mock("../modules/email/service.js", () => ({
  emailService: { send: vi.fn().mockResolvedValue({ enqueued: true }) },
}));

const CREATOR_ID = "creator-user";

const makeShare = (overrides: Record<string, unknown> = {}) => ({
  id: "share-abc",
  name: "Test Share",
  description: null,
  expiration: null,
  views: 0,
  maxViews: null,
  creatorId: CREATOR_ID,
  securityId: "sec-1",
  isActive: true,
  deactivatedAt: null,
  deactivationReason: null,
  notifiedForMaxViews: false,
  notifiedForExpiring: false,
  notifiedForExpired: false,
  notifiedForPendingDeletion: false,
  nameFieldRequired: "HIDDEN",
  emailFieldRequired: "HIDDEN",
  inactivityAlertDays: null,
  lastDownloadedAt: null,
  notifyOnDownload: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  files: [],
  folders: [],
  recipients: [],
  alias: null,
  security: { id: "sec-1", password: null },
  creator: { email: "creator@example.com", locale: "en", isActive: true },
  ...overrides,
});

describe("Share lifecycle read-time gating — integration (Phase A.1)", () => {
  let app: FastifyInstance;
  let prismaModule: {
    prisma: {
      share: {
        findUnique: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
      };
    };
  };
  let signToken: (userId: string) => string;

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
    signToken = (userId: string) => app.jwt.sign({ userId, isAdmin: false, tokenVersion: 0 });
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    prismaModule.prisma.share.updateMany.mockResolvedValue({ count: 1 });
  });

  async function getShareAnon(shareId: string) {
    return app.inject({ method: "GET", url: `/shares/${shareId}` });
  }

  // ── Reason-based gating ───────────────────────────────────────────────────

  it("blocks a manually-paused share with 403 SHARE_INACTIVE", async () => {
    prismaModule.prisma.share.findUnique.mockResolvedValue(
      makeShare({ isActive: false, deactivatedAt: new Date(), deactivationReason: "manual" }),
    );

    const res = await getShareAnon("share-abc");

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SHARE_INACTIVE");
  });

  it("blocks an expired-deactivated share with 410 SHARE_EXPIRED", async () => {
    prismaModule.prisma.share.findUnique.mockResolvedValue(
      makeShare({ isActive: false, deactivatedAt: new Date(), deactivationReason: "expired" }),
    );

    const res = await getShareAnon("share-abc");

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("SHARE_EXPIRED");
  });

  it("blocks a max_views-deactivated share with 410 MAX_VIEWS_REACHED", async () => {
    prismaModule.prisma.share.findUnique.mockResolvedValue(
      makeShare({
        isActive: false,
        deactivatedAt: new Date(),
        deactivationReason: "max_views",
        views: 5,
        maxViews: 5,
      }),
    );

    const res = await getShareAnon("share-abc");

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("MAX_VIEWS_REACHED");
  });

  it("falls back to 410 SHARE_EXPIRED when deactivated with a null reason", async () => {
    prismaModule.prisma.share.findUnique.mockResolvedValue(
      makeShare({ isActive: false, deactivatedAt: new Date(), deactivationReason: null }),
    );

    const res = await getShareAnon("share-abc");

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("SHARE_EXPIRED");
  });

  // ── Active share is reachable ─────────────────────────────────────────────

  it("allows anonymous access to an active share (200)", async () => {
    prismaModule.prisma.share.findUnique.mockResolvedValue(makeShare());

    const res = await getShareAnon("share-abc");

    expect(res.statusCode).toBe(200);
  });

  // ── Owner-self is never blocked ───────────────────────────────────────────

  it("does NOT block the owner from their own deactivated share", async () => {
    prismaModule.prisma.share.findUnique.mockResolvedValue(
      makeShare({ isActive: false, deactivatedAt: new Date(), deactivationReason: "manual" }),
    );

    const token = app.signCookie(signToken(CREATOR_ID));
    const res = await app.inject({
      method: "GET",
      url: "/shares/share-abc",
      headers: { cookie: `token=${token}` },
    });

    expect(res.statusCode).toBe(200);
    // Owner sees the real (paused) lifecycle state in the response.
    const { share } = res.json();
    expect(share.isActive).toBe(false);
    expect(share.deactivationReason).toBe("manual");
  });

  // ── Defensive expiry check (still active, expired between sweeps) ──────────

  it("blocks an active-but-expired share immediately (defensive date check)", async () => {
    prismaModule.prisma.share.findUnique.mockResolvedValue(
      makeShare({ isActive: true, expiration: new Date(Date.now() - 1000) }),
    );

    const res = await getShareAnon("share-abc");

    expect(res.statusCode).toBe(410);
    expect(res.json().code).toBe("SHARE_EXPIRED");
  });

  // ── maxViews-hit at read time persists the deactivation ───────────────────

  it("persists deactivation (isActive=false / reason=max_views) when the read hits the limit", async () => {
    // views=4, maxViews=5: this access is the 5th → atomic increment succeeds and
    // newViews (5) >= maxViews (5), so the persist compare-and-set must fire.
    prismaModule.prisma.share.findUnique.mockResolvedValue(
      makeShare({ views: 4, maxViews: 5, isActive: true }),
    );
    // incrementViewsAtomic uses updateMany to advance views (count:1 = incremented)
    // and then findUnique to read the post-increment count.
    prismaModule.prisma.share.updateMany.mockResolvedValue({ count: 1 });
    // Second findUnique inside incrementViewsAtomic returns the post-increment count.
    prismaModule.prisma.share.findUnique
      .mockResolvedValueOnce(makeShare({ views: 4, maxViews: 5, isActive: true }))
      .mockResolvedValue({ views: 5 });

    const res = await getShareAnon("share-abc");

    expect(res.statusCode).toBe(200);
    // The deactivation compare-and-set must have been issued with the right fields.
    expect(prismaModule.prisma.share.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "share-abc", isActive: true },
        data: expect.objectContaining({ isActive: false, deactivationReason: "max_views" }),
      }),
    );
  });
});
