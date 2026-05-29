/**
 * notification.scheduler.test.ts
 *
 * Unit tests for the notification scheduler (Batch 9).
 *
 * Tests:
 * - checkExpiringShares sends share_expiring and sets notifiedForExpiring
 * - checkExpiringShares skips already-notified shares
 * - checkExpiredShares sends share_expired and sets notifiedForExpired
 * - share_expiring does NOT block share_expired (separate flags)
 * - checkInactiveShares sends share_no_activity and sets inactivityAlertSent
 * - checkInactiveShares skips shares where inactivity threshold not reached
 * - checkExpiringReverseShares sends reverse_share_expiring and sets notifiedForExpiring
 * - checkExpiredReverseShares sends reverse_share_expired and sets notifiedForExpired
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const {
  mockShareFindMany,
  mockShareUpdate,
  mockReverseShareFindMany,
  mockReverseShareUpdate,
  mockEmailSend,
  mockBuildShareManageUrl,
} = vi.hoisted(() => ({
  mockShareFindMany: vi.fn(),
  mockShareUpdate: vi.fn().mockResolvedValue({}),
  mockReverseShareFindMany: vi.fn(),
  mockReverseShareUpdate: vi.fn().mockResolvedValue({}),
  mockEmailSend: vi.fn().mockResolvedValue(undefined),
  mockBuildShareManageUrl: vi.fn().mockResolvedValue("https://app.test/shares/share-1"),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    share: {
      findMany: mockShareFindMany,
      update: mockShareUpdate,
    },
    reverseShare: {
      findMany: mockReverseShareFindMany,
      update: mockReverseShareUpdate,
    },
  },
}));

vi.mock("../service.js", () => ({
  emailService: {
    send: mockEmailSend,
  },
}));

vi.mock("../url-builder.js", () => ({
  buildShareManageUrl: mockBuildShareManageUrl,
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

// ─── Test data ────────────────────────────────────────────────────────────────

const SHARE_ID = "share-1";
const CREATOR_ID = "creator-1";
const now = new Date("2024-06-15T12:00:00Z");

function makeCreator() {
  return { id: CREATOR_ID, email: "creator@example.com", locale: "en" };
}

function makeShare(overrides: Record<string, unknown> = {}) {
  return {
    id: SHARE_ID,
    name: "Test Share",
    creatorId: CREATOR_ID,
    expiration: null,
    lastDownloadedAt: null,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    inactivityAlertDays: null,
    inactivityAlertSent: false,
    createdAt: new Date("2024-01-01"),
    creator: makeCreator(),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Notification Scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(now);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── checkExpiringShares ────────────────────────────────────────────────────

  describe("checkExpiringShares", () => {
    it("sends share_expiring and sets notifiedForExpiring=true", async () => {
      const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days from now
      const share = makeShare({ expiration: expiresAt, notifiedForExpiring: false });
      mockShareFindMany.mockResolvedValue([share]);

      const { checkExpiringShares } = await import("../notification.scheduler.js");
      await checkExpiringShares();

      expect(mockEmailSend).toHaveBeenCalledWith(
        "share_expiring",
        expect.objectContaining({
          to: "creator@example.com",
          locale: "en",
          userId: CREATOR_ID,
          shareId: SHARE_ID,
          data: expect.objectContaining({
            shareName: "Test Share",
            expiresAt: expiresAt.toISOString(),
            shareManageUrl: "https://app.test/shares/share-1",
          }),
        }),
      );

      expect(mockShareUpdate).toHaveBeenCalledWith({
        where: { id: SHARE_ID },
        data: { notifiedForExpiring: true },
      });
    });

    it("queries with correct conditions (not yet notified, expiring within 3 days)", async () => {
      mockShareFindMany.mockResolvedValue([]);
      const { checkExpiringShares } = await import("../notification.scheduler.js");
      await checkExpiringShares();

      expect(mockShareFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expiration: expect.objectContaining({
              not: null,
              gt: now,
            }),
            notifiedForExpiring: false,
            creatorId: { not: null },
          }),
        }),
      );
    });

    it("skips shares with no creator", async () => {
      const share = makeShare({
        expiration: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        creatorId: null,
        creator: null,
      });
      mockShareFindMany.mockResolvedValue([share]);

      const { checkExpiringShares } = await import("../notification.scheduler.js");
      await checkExpiringShares();

      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(mockShareUpdate).not.toHaveBeenCalled();
    });

    it("does not send when no shares match", async () => {
      mockShareFindMany.mockResolvedValue([]);
      const { checkExpiringShares } = await import("../notification.scheduler.js");
      await checkExpiringShares();

      expect(mockEmailSend).not.toHaveBeenCalled();
    });
  });

  // ── checkExpiredShares ─────────────────────────────────────────────────────

  describe("checkExpiredShares", () => {
    it("sends share_expired and sets notifiedForExpired=true", async () => {
      const expiredAt = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
      const share = makeShare({ expiration: expiredAt, notifiedForExpired: false });
      mockShareFindMany.mockResolvedValue([share]);

      const { checkExpiredShares } = await import("../notification.scheduler.js");
      await checkExpiredShares();

      expect(mockEmailSend).toHaveBeenCalledWith(
        "share_expired",
        expect.objectContaining({
          to: "creator@example.com",
          locale: "en",
          userId: CREATOR_ID,
          shareId: SHARE_ID,
          data: expect.objectContaining({
            shareName: "Test Share",
            expiredAt: expiredAt.toISOString(),
            shareManageUrl: "https://app.test/shares/share-1",
          }),
        }),
      );

      expect(mockShareUpdate).toHaveBeenCalledWith({
        where: { id: SHARE_ID },
        data: { notifiedForExpired: true },
      });
    });

    it("queries for expired (lt now) and not notified shares", async () => {
      mockShareFindMany.mockResolvedValue([]);
      const { checkExpiredShares } = await import("../notification.scheduler.js");
      await checkExpiredShares();

      expect(mockShareFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            expiration: expect.objectContaining({
              not: null,
              lt: now,
            }),
            notifiedForExpired: false,
          }),
        }),
      );
    });
  });

  // ── share_expiring does NOT block share_expired ────────────────────────────

  describe("share_expiring does NOT block share_expired", () => {
    it("sends share_expired even if share was already notified for expiring", async () => {
      const expiredAt = new Date(now.getTime() - 24 * 60 * 60 * 1000); // 1 day ago
      // notifiedForExpiring=true (already warned), but notifiedForExpired=false
      const share = makeShare({
        expiration: expiredAt,
        notifiedForExpiring: true,
        notifiedForExpired: false,
      });
      mockShareFindMany.mockResolvedValue([share]);

      const { checkExpiredShares } = await import("../notification.scheduler.js");
      await checkExpiredShares();

      expect(mockEmailSend).toHaveBeenCalledWith(
        "share_expired",
        expect.objectContaining({
          to: "creator@example.com",
          shareId: SHARE_ID,
        }),
      );

      expect(mockShareUpdate).toHaveBeenCalledWith({
        where: { id: SHARE_ID },
        data: { notifiedForExpired: true },
      });
    });
  });

  // ── checkInactiveShares ────────────────────────────────────────────────────

  describe("checkInactiveShares", () => {
    it("sends share_no_activity and sets inactivityAlertSent=true when never downloaded", async () => {
      // Created 10 days ago, no downloads, alert after 7 days
      const createdAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const share = makeShare({
        inactivityAlertDays: 7,
        inactivityAlertSent: false,
        lastDownloadedAt: null,
        createdAt,
      });
      mockShareFindMany.mockResolvedValue([share]);

      const { checkInactiveShares } = await import("../notification.scheduler.js");
      await checkInactiveShares();

      expect(mockEmailSend).toHaveBeenCalledWith(
        "share_no_activity",
        expect.objectContaining({
          to: "creator@example.com",
          locale: "en",
          userId: CREATOR_ID,
          shareId: SHARE_ID,
          data: expect.objectContaining({
            shareName: "Test Share",
            inactivityDays: 7,
            shareManageUrl: "https://app.test/shares/share-1",
          }),
        }),
      );

      expect(mockShareUpdate).toHaveBeenCalledWith({
        where: { id: SHARE_ID },
        data: { inactivityAlertSent: true },
      });
    });

    it("sends share_no_activity when last download is older than threshold", async () => {
      // Last downloaded 10 days ago, alert after 7 days
      const lastDownloadedAt = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const share = makeShare({
        inactivityAlertDays: 7,
        inactivityAlertSent: false,
        lastDownloadedAt,
        createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      });
      mockShareFindMany.mockResolvedValue([share]);

      const { checkInactiveShares } = await import("../notification.scheduler.js");
      await checkInactiveShares();

      expect(mockEmailSend).toHaveBeenCalledWith("share_no_activity", expect.anything());
      expect(mockShareUpdate).toHaveBeenCalledWith({
        where: { id: SHARE_ID },
        data: { inactivityAlertSent: true },
      });
    });

    it("skips share when last download is within the inactivity threshold", async () => {
      // Last downloaded 3 days ago, alert after 7 days — not yet inactive
      const lastDownloadedAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const share = makeShare({
        inactivityAlertDays: 7,
        inactivityAlertSent: false,
        lastDownloadedAt,
        createdAt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      });
      mockShareFindMany.mockResolvedValue([share]);

      const { checkInactiveShares } = await import("../notification.scheduler.js");
      await checkInactiveShares();

      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(mockShareUpdate).not.toHaveBeenCalled();
    });

    it("skips share that was created recently (within inactivity threshold)", async () => {
      // Created 3 days ago, no downloads, alert after 7 days — not yet inactive
      const createdAt = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
      const share = makeShare({
        inactivityAlertDays: 7,
        inactivityAlertSent: false,
        lastDownloadedAt: null,
        createdAt,
      });
      mockShareFindMany.mockResolvedValue([share]);

      const { checkInactiveShares } = await import("../notification.scheduler.js");
      await checkInactiveShares();

      expect(mockEmailSend).not.toHaveBeenCalled();
      expect(mockShareUpdate).not.toHaveBeenCalled();
    });
  });

  // ── checkExpiringReverseShares ─────────────────────────────────────────────

  describe("checkExpiringReverseShares", () => {
    it("sends reverse_share_expiring and sets notifiedForExpiring=true", async () => {
      const expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);
      const rs = {
        id: "rs-1",
        name: "Upload request",
        creatorId: CREATOR_ID,
        expiration: expiresAt,
        notifiedForExpiring: false,
        creator: makeCreator(),
      };
      mockReverseShareFindMany.mockResolvedValue([rs]);

      const { checkExpiringReverseShares } = await import("../notification.scheduler.js");
      await checkExpiringReverseShares();

      expect(mockEmailSend).toHaveBeenCalledWith(
        "reverse_share_expiring",
        expect.objectContaining({
          to: "creator@example.com",
          userId: CREATOR_ID,
          data: expect.objectContaining({
            reverseShareName: "Upload request",
            expiresAt: expiresAt.toISOString(),
          }),
        }),
      );

      expect(mockReverseShareUpdate).toHaveBeenCalledWith({
        where: { id: "rs-1" },
        data: { notifiedForExpiring: true },
      });
    });

    it("queries with notifiedForExpiring: false filter", async () => {
      mockReverseShareFindMany.mockResolvedValue([]);
      const { checkExpiringReverseShares } = await import("../notification.scheduler.js");
      await checkExpiringReverseShares();

      expect(mockReverseShareFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            notifiedForExpiring: false,
          }),
        }),
      );
    });
  });

  // ── checkExpiredReverseShares ──────────────────────────────────────────────

  describe("checkExpiredReverseShares", () => {
    it("sends reverse_share_expired and sets notifiedForExpired=true", async () => {
      const expiredAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const rs = {
        id: "rs-1",
        name: "Upload request",
        creatorId: CREATOR_ID,
        expiration: expiredAt,
        notifiedForExpired: false,
        creator: makeCreator(),
      };
      mockReverseShareFindMany.mockResolvedValue([rs]);

      const { checkExpiredReverseShares } = await import("../notification.scheduler.js");
      await checkExpiredReverseShares();

      expect(mockEmailSend).toHaveBeenCalledWith(
        "reverse_share_expired",
        expect.objectContaining({
          to: "creator@example.com",
          userId: CREATOR_ID,
          data: expect.objectContaining({
            reverseShareName: "Upload request",
            expiredAt: expiredAt.toISOString(),
          }),
        }),
      );

      expect(mockReverseShareUpdate).toHaveBeenCalledWith({
        where: { id: "rs-1" },
        data: { notifiedForExpired: true },
      });
    });

    it("queries with notifiedForExpired: false filter", async () => {
      mockReverseShareFindMany.mockResolvedValue([]);
      const { checkExpiredReverseShares } = await import("../notification.scheduler.js");
      await checkExpiredReverseShares();

      expect(mockReverseShareFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            notifiedForExpired: false,
          }),
        }),
      );
    });
  });
});
