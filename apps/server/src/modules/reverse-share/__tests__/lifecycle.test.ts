/**
 * lifecycle.test.ts
 *
 * Phase A.1 Batch 2 — unit tests for reverse-share lifecycle transitions:
 *  - deactivateReverseShare stamps reason='manual' + deactivatedAt (never auto-deleted).
 *  - activateReverseShare clears the deactivation metadata + re-arms the warning.
 *  - updateReverseShare reactivates when expiration is extended into the future.
 *  - the read path persists expiry (markExpiredInactive) before blocking with 410.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindById, mockUpdate, mockMarkExpiredInactive, mockCountFiles, mockComparePassword } =
  vi.hoisted(() => ({
    mockFindById: vi.fn(),
    mockUpdate: vi.fn(),
    mockMarkExpiredInactive: vi.fn().mockResolvedValue(1),
    mockCountFiles: vi.fn().mockResolvedValue(0),
    mockComparePassword: vi.fn().mockResolvedValue(true),
  }));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: { reverseShare: {}, reverseShareAlias: {} },
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("../../file/service.js", () => ({
  FileService: class {
    deleteObject = vi.fn();
  },
}));

vi.mock("../repository.js", () => ({
  ReverseShareRepository: class {
    findById = mockFindById;
    update = mockUpdate;
    markExpiredInactive = mockMarkExpiredInactive;
    countFilesByReverseShareId = mockCountFiles;
    comparePassword = mockComparePassword;
  },
}));

const RS_ID = "rs-1";
const CREATOR_ID = "creator-1";

function makeReverseShare(overrides: Record<string, unknown> = {}) {
  return {
    id: RS_ID,
    name: "Inbox",
    description: null,
    expiration: null,
    maxFiles: null,
    maxFileSize: null,
    allowedFileTypes: null,
    password: null,
    pageLayout: "DEFAULT",
    backgroundImageId: null,
    isActive: true,
    deactivatedAt: null,
    deactivationReason: null,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    notifiedForPendingDeletion: false,
    nameFieldRequired: "HIDDEN",
    emailFieldRequired: "HIDDEN",
    notifyOnUpload: false,
    bypassUploadCooldown: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    creatorId: CREATOR_ID,
    files: [],
    alias: null,
    creator: {
      id: CREATOR_ID,
      firstName: "Owner",
      lastName: "User",
      email: "owner@example.com",
      isActive: true,
    },
    ...overrides,
  };
}

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
  vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
  vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
  vi.stubEnv("NODE_ENV", "test");
});

describe("ReverseShareService — manual lifecycle toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkExpiredInactive.mockResolvedValue(1);
  });

  it("deactivateReverseShare stamps reason='manual' and deactivatedAt", async () => {
    mockFindById.mockResolvedValue(makeReverseShare());
    mockUpdate.mockResolvedValue(makeReverseShare({ isActive: false }));

    const { ReverseShareService } = await import("../service.js");
    await new ReverseShareService().deactivateReverseShare(RS_ID, CREATOR_ID);

    expect(mockUpdate).toHaveBeenCalledWith(
      RS_ID,
      expect.objectContaining({
        isActive: false,
        deactivationReason: "manual",
        deactivatedAt: expect.any(Date),
      }),
    );
  });

  it("activateReverseShare clears the deactivation metadata and re-arms the warning", async () => {
    mockFindById.mockResolvedValue(
      makeReverseShare({
        isActive: false,
        deactivatedAt: new Date(),
        deactivationReason: "manual",
        notifiedForPendingDeletion: true,
      }),
    );
    mockUpdate.mockResolvedValue(makeReverseShare());

    const { ReverseShareService } = await import("../service.js");
    await new ReverseShareService().activateReverseShare(RS_ID, CREATOR_ID);

    expect(mockUpdate).toHaveBeenCalledWith(
      RS_ID,
      expect.objectContaining({
        isActive: true,
        deactivatedAt: null,
        deactivationReason: null,
        notifiedForPendingDeletion: false,
      }),
    );
  });

  it("updateReverseShare reactivates when expiration is extended into the future", async () => {
    mockFindById.mockResolvedValue(
      makeReverseShare({
        isActive: false,
        deactivatedAt: new Date(),
        deactivationReason: "expired",
        expiration: new Date(Date.now() - 86_400_000),
      }),
    );
    mockUpdate.mockResolvedValue(makeReverseShare());

    const future = new Date(Date.now() + 86_400_000).toISOString();

    const { ReverseShareService } = await import("../service.js");
    await new ReverseShareService().updateReverseShare(RS_ID, { expiration: future }, CREATOR_ID);

    expect(mockUpdate).toHaveBeenCalledWith(
      RS_ID,
      expect.objectContaining({
        isActive: true,
        deactivatedAt: null,
        deactivationReason: null,
      }),
    );
  });
});

describe("ReverseShareService — read-time expiry persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMarkExpiredInactive.mockResolvedValue(1);
  });

  it("getReverseShareForUpload persists expiry then throws SHARE_EXPIRED", async () => {
    const expiration = new Date(Date.now() - 1000);
    mockFindById.mockResolvedValue(makeReverseShare({ expiration }));

    const { ReverseShareService } = await import("../service.js");
    await expect(new ReverseShareService().getReverseShareForUpload(RS_ID)).rejects.toMatchObject({
      statusCode: 410,
      code: "SHARE_EXPIRED",
    });

    // The expiry must be persisted with the expiration instant (not "now").
    expect(mockMarkExpiredInactive).toHaveBeenCalledWith(RS_ID, expiration);
  });
});
