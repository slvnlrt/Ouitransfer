/**
 * pause-resume.test.ts
 *
 * Phase A.1 Batch 2 — unit tests for the manual pause/resume service methods and
 * reactivation-on-extend in updateShare().
 *
 * Tests:
 *  - pauseShare sets isActive=false / deactivatedAt / reason='manual' and audits.
 *  - pauseShare rejects a non-owner.
 *  - resumeShare clears the deactivation fields, re-arms notifiedForPendingDeletion, audits.
 *  - resumeShare refuses while the share is still expired or still maxed.
 *  - updateShare reactivates a deactivated share when expiration is extended into the future.
 *  - updateShare does NOT reactivate when the extended share is still maxed.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindShareById, mockUpdateShare } = vi.hoisted(() => ({
  mockFindShareById: vi.fn(),
  mockUpdateShare: vi.fn().mockResolvedValue({}),
}));

const { mockLogAuditEvent } = vi.hoisted(() => ({
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    share: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("../../email/service.js", () => ({
  emailService: { send: vi.fn().mockResolvedValue({ enqueued: true }) },
}));

vi.mock("../../audit/service.js", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("../repository.js", () => ({
  PrismaShareRepository: class {
    findShareById = mockFindShareById;
    updateShare = mockUpdateShare;
    updateShareSecurity = vi.fn();
    findSharesByUserId = vi.fn().mockResolvedValue([]);
    incrementViewsAtomic = vi.fn();
    findShareByAlias = vi.fn();
    findShareBySecurityId = vi.fn();
    deleteShare = vi.fn();
    incrementViews = vi.fn();
    addFilesToShare = vi.fn();
    removeFilesFromShare = vi.fn();
    addFoldersToShare = vi.fn();
    removeFoldersFromShare = vi.fn();
    findFilesByIds = vi.fn().mockResolvedValue([]);
    findFoldersByIds = vi.fn().mockResolvedValue([]);
    addRecipients = vi.fn();
    removeRecipients = vi.fn();
    createShare = vi.fn();
  },
}));

const CREATOR_ID = "creator-1";
const OTHER_ID = "intruder-9";
const SHARE_ID = "share-1";
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
    notifiedForMaxViews: false,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    notifiedForPendingDeletion: false,
    isActive: true,
    deactivatedAt: null,
    deactivationReason: null,
    security: { id: SECURITY_ID, password: null, createdAt: new Date(), updatedAt: new Date() },
    files: [],
    folders: [],
    recipients: [],
    alias: null,
    creator: { email: "creator@example.com", locale: "en", isActive: true },
    ...overrides,
  };
}

describe("ShareService — pauseShare / resumeShare", () => {
  beforeAll(() => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pauseShare sets manual deactivation fields and audits SHARE_DEACTIVATED", async () => {
    const share = makeShare();
    mockFindShareById.mockResolvedValue(share);
    mockUpdateShare.mockResolvedValue(share);

    const { ShareService } = await import("../service.js");
    await new ShareService().pauseShare(SHARE_ID, CREATOR_ID);

    expect(mockUpdateShare).toHaveBeenCalledWith(
      SHARE_ID,
      expect.objectContaining({
        isActive: false,
        deactivationReason: "manual",
        deactivatedAt: expect.any(Date),
      }),
    );
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_DEACTIVATED",
        targetId: SHARE_ID,
        metadata: { reason: "manual" },
      }),
    );
  });

  it("pauseShare rejects a non-owner", async () => {
    mockFindShareById.mockResolvedValue(makeShare());

    const { ShareService } = await import("../service.js");
    await expect(new ShareService().pauseShare(SHARE_ID, OTHER_ID)).rejects.toThrow(
      /Unauthorized/i,
    );
    expect(mockUpdateShare).not.toHaveBeenCalled();
  });

  it("resumeShare clears deactivation fields, re-arms the warning, and audits SHARE_REACTIVATED", async () => {
    const paused = makeShare({
      isActive: false,
      deactivatedAt: new Date(),
      deactivationReason: "manual",
      notifiedForPendingDeletion: true,
    });
    mockFindShareById.mockResolvedValue(paused);
    mockUpdateShare.mockResolvedValue(paused);

    const { ShareService } = await import("../service.js");
    await new ShareService().resumeShare(SHARE_ID, CREATOR_ID);

    expect(mockUpdateShare).toHaveBeenCalledWith(
      SHARE_ID,
      expect.objectContaining({
        isActive: true,
        deactivatedAt: null,
        deactivationReason: null,
        notifiedForPendingDeletion: false,
      }),
    );
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SHARE_REACTIVATED", targetId: SHARE_ID }),
    );
  });

  it("resumeShare refuses while the share is still expired", async () => {
    const expired = makeShare({
      isActive: false,
      deactivatedAt: new Date(),
      deactivationReason: "expired",
      expiration: new Date(Date.now() - 1000),
    });
    mockFindShareById.mockResolvedValue(expired);

    const { ShareService } = await import("../service.js");
    await expect(new ShareService().resumeShare(SHARE_ID, CREATOR_ID)).rejects.toThrow(
      /still expired|view limit|extend/i,
    );
    expect(mockUpdateShare).not.toHaveBeenCalled();
  });

  it("resumeShare refuses while the share has still reached its view limit", async () => {
    const maxed = makeShare({
      isActive: false,
      deactivatedAt: new Date(),
      deactivationReason: "max_views",
      views: 5,
      maxViews: 5,
    });
    mockFindShareById.mockResolvedValue(maxed);

    const { ShareService } = await import("../service.js");
    await expect(new ShareService().resumeShare(SHARE_ID, CREATOR_ID)).rejects.toThrow(
      /still expired|view limit|extend/i,
    );
    expect(mockUpdateShare).not.toHaveBeenCalled();
  });
});

describe("ShareService.updateShare — reactivation on extend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reactivates an expired-deactivated share when expiration is extended into the future", async () => {
    const expired = makeShare({
      isActive: false,
      deactivatedAt: new Date(),
      deactivationReason: "expired",
      expiration: new Date(Date.now() - 86_400_000), // yesterday
    });
    mockFindShareById.mockResolvedValue(expired);
    mockUpdateShare.mockResolvedValue(expired);

    const future = new Date(Date.now() + 86_400_000).toISOString(); // tomorrow

    const { ShareService } = await import("../service.js");
    await new ShareService().updateShare(SHARE_ID, { expiration: future }, CREATOR_ID);

    expect(mockUpdateShare).toHaveBeenCalledWith(
      SHARE_ID,
      expect.objectContaining({
        isActive: true,
        deactivatedAt: null,
        deactivationReason: null,
        notifiedForPendingDeletion: false,
      }),
    );
  });

  it("does NOT reactivate when the share remains maxed after the update", async () => {
    const maxed = makeShare({
      isActive: false,
      deactivatedAt: new Date(),
      deactivationReason: "max_views",
      views: 5,
      maxViews: 5,
    });
    mockFindShareById.mockResolvedValue(maxed);
    mockUpdateShare.mockResolvedValue(maxed);

    // Extend expiration (which it never had) but leave maxViews at 5 → still maxed.
    const future = new Date(Date.now() + 86_400_000).toISOString();

    const { ShareService } = await import("../service.js");
    await new ShareService().updateShare(SHARE_ID, { expiration: future }, CREATOR_ID);

    const updateArg = mockUpdateShare.mock.calls[0]![1] as Record<string, unknown>;
    expect(updateArg.isActive).toBeUndefined();
    expect(updateArg.deactivationReason).toBeUndefined();
  });

  it("reactivates a maxed-deactivated share when maxViews is raised above the view count", async () => {
    const maxed = makeShare({
      isActive: false,
      deactivatedAt: new Date(),
      deactivationReason: "max_views",
      views: 5,
      maxViews: 5,
    });
    mockFindShareById.mockResolvedValue(maxed);
    mockUpdateShare.mockResolvedValue(maxed);

    const { ShareService } = await import("../service.js");
    await new ShareService().updateShare(SHARE_ID, { maxViews: 10 }, CREATOR_ID);

    expect(mockUpdateShare).toHaveBeenCalledWith(
      SHARE_ID,
      expect.objectContaining({ isActive: true, deactivationReason: null }),
    );
  });
});
