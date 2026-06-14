/**
 * remind-non-downloaders.routes.test.ts
 *
 * Feature 8.3 Batch 3 — `app.inject()` integration tests for the manual
 * download-reminder route:
 *   - POST /shares/:shareId/remind
 *
 * Exercises the full request lifecycle (JWT cookie + CSRF) so the route↔schema
 * wiring, owner-auth, the non-downloader filter, the email type, the audit row,
 * and the notifiedAt update are all verified end-to-end (CLAUDE.md rules 10/11).
 *
 * The defining invariant: only recipients with `lastDownloadedAt == null` are
 * reminded — a recipient who already downloaded is never reminded even when its
 * email is passed explicitly in the body.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockShareFindUnique,
  mockShareRecipientUpdate,
  mockUserFindUnique,
  mockUserCount,
  mockEmailSend,
  mockBuildShareLink,
} = vi.hoisted(() => ({
  mockShareFindUnique: vi.fn(),
  mockShareRecipientUpdate: vi.fn().mockResolvedValue({}),
  mockUserFindUnique: vi.fn(),
  mockUserCount: vi.fn().mockResolvedValue(1),
  mockEmailSend: vi.fn().mockResolvedValue({ enqueued: true }),
  mockBuildShareLink: vi.fn().mockResolvedValue("https://app.example.com/s/my-alias"),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: mockUserFindUnique,
    },
    share: {
      findUnique: mockShareFindUnique,
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn(),
    },
    shareRecipient: {
      update: mockShareRecipientUpdate,
    },
    shareAlias: {
      findUnique: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    // A6-03 spam-guard reads the user's recent enqueue count; 0 = within quota.
    emailJob: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

vi.mock("../../email/service.js", () => ({
  emailService: { send: (...args: unknown[]) => mockEmailSend(...args) },
}));

vi.mock("../../email/url-builder.js", () => ({
  buildShareLink: (...args: unknown[]) => mockBuildShareLink(...args),
  buildShareManageUrl: vi.fn().mockResolvedValue("https://app.example.com/manage"),
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
    getPresignedGetUrl = vi.fn();
    deleteObject = vi.fn();
  },
}));

// ─── Static imports (after vi.mock hoisting) ─────────────────────────────────

import { logAuditEvent } from "../../audit/service.js";

// ─── Test data helpers ────────────────────────────────────────────────────────

const CREATOR_ID = "creator-user-1";
const OTHER_ID = "other-user-1";
const SHARE_ID = "share-1";

function makeRecipient(overrides: Record<string, unknown> = {}) {
  return {
    id: "recipient-1",
    shareId: SHARE_ID,
    email: "bob@example.com",
    name: null,
    trackingToken: "tok-bob",
    notifiedAt: new Date("2024-01-02"),
    lastAccessedAt: null,
    accessCount: 0,
    downloadCount: 0,
    lastDownloadedAt: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    ...overrides,
  };
}

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
    securityId: "security-1",
    nameFieldRequired: "HIDDEN",
    emailFieldRequired: "HIDDEN",
    inactivityAlertDays: null,
    inactivityAlertSent: false,
    lastDownloadedAt: null,
    notifyOnDownload: false,
    notifiedForMaxViews: false,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    notifiedForPendingDeletion: false,
    isActive: true,
    deactivatedAt: null,
    deactivationReason: null,
    security: { id: "security-1", password: null, createdAt: new Date(), updatedAt: new Date() },
    files: [],
    folders: [],
    recipients: [makeRecipient()],
    alias: {
      id: "alias-1",
      alias: "my-alias",
      shareId: SHARE_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    creator: { email: "creator@example.com", locale: "en", isActive: true },
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: CREATOR_ID,
    firstName: "Alice",
    lastName: "Smith",
    username: "alice",
    email: "alice@example.com",
    locale: "en",
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("POST /shares/:shareId/remind — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

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
    mockUserCount.mockResolvedValue(1);
    mockUserFindUnique.mockResolvedValue(makeUser());
    mockShareRecipientUpdate.mockResolvedValue({});
    mockEmailSend.mockResolvedValue({ enqueued: true });
    mockBuildShareLink.mockResolvedValue("https://app.example.com/s/my-alias");
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function signToken(userId: string): string {
    const jwt = app.jwt.sign({ userId, isAdmin: false, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = res.json();
    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  // Each call uses a distinct source IP so the per-route rate limit (max 5 / 10 min,
  // keyed on request.ip) never trips across the suite's requests.
  let ipCounter = 0;

  async function remind(userId: string, body: Record<string, unknown> = {}) {
    ipCounter += 1;
    const remoteAddress = `10.0.0.${ipCounter}`;
    const { csrfToken, csrfCookie } = await getCsrf();
    return app.inject({
      method: "POST",
      url: `/shares/${SHARE_ID}/remind`,
      remoteAddress,
      headers: {
        cookie: `token=${signToken(userId)}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
      payload: body,
    });
  }

  // ── Core behaviour ─────────────────────────────────────────────────────────

  it("reminds only non-downloaders and enqueues share_download_reminder", async () => {
    mockShareFindUnique.mockResolvedValue(
      makeShare({
        recipients: [
          makeRecipient({ id: "r-pending", email: "pending@example.com", lastDownloadedAt: null }),
          makeRecipient({
            id: "r-done",
            email: "done@example.com",
            trackingToken: "tok-done",
            lastDownloadedAt: new Date("2024-03-01"),
          }),
        ],
      }),
    );

    const res = await remind(CREATOR_ID);

    expect(res.statusCode).toBe(200);
    expect(res.json().remindedRecipients).toEqual(["pending@example.com"]);

    // Email sent only to the pending recipient, with the reminder type.
    expect(mockEmailSend).toHaveBeenCalledOnce();
    expect(mockEmailSend).toHaveBeenCalledWith(
      "share_download_reminder",
      expect.objectContaining({
        to: "pending@example.com",
        data: expect.objectContaining({
          senderName: "Alice Smith",
          shareName: "Test Share",
          shareLink: "https://app.example.com/s/my-alias?t=tok-bob",
        }),
      }),
    );
    // userId is intentionally omitted (external recipient, no preference row).
    expect(mockEmailSend.mock.calls[0][1]).not.toHaveProperty("userId");
  });

  it("updates notifiedAt on reminded recipients", async () => {
    mockShareFindUnique.mockResolvedValue(makeShare());

    await remind(CREATOR_ID);

    expect(mockShareRecipientUpdate).toHaveBeenCalledWith({
      where: { id: "recipient-1" },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it("writes a SHARE_RECIPIENT_REMIND audit row when reminders are sent", async () => {
    mockShareFindUnique.mockResolvedValue(makeShare());

    await remind(CREATOR_ID);

    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_RECIPIENT_REMIND",
        targetType: "share",
        targetId: SHARE_ID,
        metadata: expect.objectContaining({
          recipientCount: 1,
          emails: ["bob@example.com"],
        }),
      }),
    );
  });

  it("skips an already-downloaded recipient even when passed explicitly in emails", async () => {
    mockShareFindUnique.mockResolvedValue(
      makeShare({
        recipients: [
          makeRecipient({
            id: "r-done",
            email: "done@example.com",
            lastDownloadedAt: new Date("2024-03-01"),
          }),
        ],
      }),
    );

    const res = await remind(CREATOR_ID, { emails: ["done@example.com"] });

    expect(res.statusCode).toBe(200);
    expect(res.json().remindedRecipients).toEqual([]);
    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("returns an empty no-op result (not an error) when nobody is pending", async () => {
    mockShareFindUnique.mockResolvedValue(
      makeShare({
        recipients: [makeRecipient({ id: "r-done", lastDownloadedAt: new Date("2024-03-01") })],
      }),
    );

    const res = await remind(CREATOR_ID);

    expect(res.statusCode).toBe(200);
    expect(res.json().remindedRecipients).toEqual([]);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("does not enqueue or audit when SMTP is off (send returns enqueued: false)", async () => {
    mockShareFindUnique.mockResolvedValue(makeShare());
    mockEmailSend.mockResolvedValue({ enqueued: false });

    const res = await remind(CREATOR_ID);

    expect(res.statusCode).toBe(200);
    expect(res.json().remindedRecipients).toEqual([]);
    // notifiedAt is not bumped when nothing was enqueued.
    expect(mockShareRecipientUpdate).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-owner", async () => {
    mockShareFindUnique.mockResolvedValue(makeShare());

    const res = await remind(OTHER_ID);

    expect(res.statusCode).toBe(403);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("returns 404 when the share does not exist", async () => {
    mockShareFindUnique.mockResolvedValue(null);

    const res = await remind(CREATOR_ID);

    expect(res.statusCode).toBe(404);
  });

  it("returns 400 when the share has no recipients", async () => {
    mockShareFindUnique.mockResolvedValue(makeShare({ recipients: [] }));

    const res = await remind(CREATOR_ID);

    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when unauthenticated (valid CSRF but no auth token)", async () => {
    mockShareFindUnique.mockResolvedValue(makeShare());
    ipCounter += 1;
    const { csrfToken, csrfCookie } = await getCsrf();

    const res = await app.inject({
      method: "POST",
      url: `/shares/${SHARE_ID}/remind`,
      remoteAddress: `10.0.1.${ipCounter}`,
      headers: {
        // No `token=` cookie — only the CSRF double-submit pair.
        cookie: `_csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
      payload: {},
    });

    expect(res.statusCode).toBe(401);
    expect(mockEmailSend).not.toHaveBeenCalled();
  });

  it("reminds only the selected non-downloaders when emails are provided", async () => {
    mockShareFindUnique.mockResolvedValue(
      makeShare({
        recipients: [
          makeRecipient({ id: "r-alice", email: "alice@example.com", lastDownloadedAt: null }),
          makeRecipient({ id: "r-bob", email: "bob@example.com", lastDownloadedAt: null }),
        ],
      }),
    );

    const res = await remind(CREATOR_ID, { emails: ["alice@example.com"] });

    expect(res.statusCode).toBe(200);
    expect(res.json().remindedRecipients).toEqual(["alice@example.com"]);
    expect(mockEmailSend).toHaveBeenCalledOnce();
    expect(mockEmailSend).toHaveBeenCalledWith(
      "share_download_reminder",
      expect.objectContaining({ to: "alice@example.com" }),
    );
  });

  it("does not remind a recipient who was never notified (notifiedAt == null)", async () => {
    // A reminder is a follow-up to a prior invitation — an un-notified recipient is excluded,
    // mirroring the "Pending" badge / "Remind (N)" count (I2 / R-6).
    mockShareFindUnique.mockResolvedValue(
      makeShare({
        recipients: [makeRecipient({ id: "r-new", email: "new@example.com", notifiedAt: null })],
      }),
    );

    const res = await remind(CREATOR_ID);

    expect(res.statusCode).toBe(200);
    expect(res.json().remindedRecipients).toEqual([]);
    expect(mockEmailSend).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
