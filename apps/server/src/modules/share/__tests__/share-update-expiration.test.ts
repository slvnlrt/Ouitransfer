/**
 * share-update-expiration.test.ts
 *
 * Unit tests for the notifiedForExpiration reset logic in share updateShare().
 *
 * Tests:
 * - Extending share expiration resets notifiedForExpiration to false
 * - Reducing share expiration does NOT reset notifiedForExpiration
 * - Setting expiration on a share without one does not reset (no previous expiration)
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const { mockFindShareById, mockUpdateShare, mockUpdateShareSecurity, mockFindSharesByUserId } =
  vi.hoisted(() => ({
    mockFindShareById: vi.fn(),
    mockUpdateShare: vi.fn().mockResolvedValue({}),
    mockUpdateShareSecurity: vi.fn().mockResolvedValue({}),
    mockFindSharesByUserId: vi.fn().mockResolvedValue([]),
  }));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    share: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    shareSecurity: {
      update: vi.fn().mockResolvedValue({}),
    },
    shareRecipient: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn().mockImplementation(async (cb) =>
      cb({
        shareRecipient: {
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: vi.fn(),
          create: vi.fn(),
        },
      }),
    ),
  },
}));

vi.mock("../../email/service.js", () => ({
  emailService: {
    send: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

vi.mock("../repository.js", () => ({
  PrismaShareRepository: class {
    findShareById = mockFindShareById;
    updateShare = mockUpdateShare;
    updateShareSecurity = mockUpdateShareSecurity;
    findSharesByUserId = mockFindSharesByUserId;
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

// ─── Test data ────────────────────────────────────────────────────────────────

const CREATOR_ID = "creator-1";
const SHARE_ID = "share-1";
const SECURITY_ID = "security-1";

function makeFullShare(overrides: Record<string, unknown> = {}) {
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
    notifiedForExpiration: true, // already notified
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

describe("updateShare — notifiedForExpiration reset", () => {
  beforeAll(() => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resets notifiedForExpiration when expiration is extended", async () => {
    const currentExpiration = new Date("2024-07-01T00:00:00Z");
    const newExpiration = new Date("2024-08-01T00:00:00Z"); // later

    const share = makeFullShare({ expiration: currentExpiration, notifiedForExpiration: true });
    // findShareById called twice: before update and after update
    mockFindShareById.mockResolvedValue(share);
    mockUpdateShare.mockResolvedValue(share);

    const { ShareService } = await import("../service.js");
    const service = new ShareService();

    await service.updateShare(SHARE_ID, { expiration: newExpiration.toISOString() }, CREATOR_ID);

    expect(mockUpdateShare).toHaveBeenCalledWith(
      SHARE_ID,
      expect.objectContaining({
        notifiedForExpiration: false,
      }),
    );
  });

  it("does NOT reset notifiedForExpiration when expiration is reduced", async () => {
    const currentExpiration = new Date("2024-08-01T00:00:00Z");
    const newExpiration = new Date("2024-07-01T00:00:00Z"); // earlier

    const share = makeFullShare({ expiration: currentExpiration, notifiedForExpiration: true });
    mockFindShareById.mockResolvedValue(share);
    mockUpdateShare.mockResolvedValue(share);

    const { ShareService } = await import("../service.js");
    const service = new ShareService();

    await service.updateShare(SHARE_ID, { expiration: newExpiration.toISOString() }, CREATOR_ID);

    // notifiedForExpiration should NOT be set to false
    const updateCall = mockUpdateShare.mock.calls[0][1];
    expect(updateCall.notifiedForExpiration).toBeUndefined();
  });

  it("does NOT reset notifiedForExpiration when share had no prior expiration", async () => {
    const newExpiration = new Date("2024-08-01T00:00:00Z");

    const share = makeFullShare({ expiration: null, notifiedForExpiration: false });
    mockFindShareById.mockResolvedValue(share);
    mockUpdateShare.mockResolvedValue(share);

    const { ShareService } = await import("../service.js");
    const service = new ShareService();

    await service.updateShare(SHARE_ID, { expiration: newExpiration.toISOString() }, CREATOR_ID);

    // No notifiedForExpiration reset — no previous expiration to compare against
    const updateCall = mockUpdateShare.mock.calls[0][1];
    expect(updateCall.notifiedForExpiration).toBeUndefined();
  });
});
