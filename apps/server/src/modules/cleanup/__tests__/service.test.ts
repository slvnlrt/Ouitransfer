import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    user: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    file: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
    },
    folder: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    backgroundImage: {
      findMany: vi.fn(),
    },
    share: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    shareSecurity: {
      delete: vi.fn(),
    },
    reverseShare: {
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    reverseShareFile: {
      findMany: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

const {
  mockDeleteObject,
  mockFileExists,
  mockListObjects,
  mockListMultipartUploads,
  mockAbortMultipartUpload,
} = vi.hoisted(() => ({
  mockDeleteObject: vi.fn(),
  mockFileExists: vi.fn(),
  mockListObjects: vi.fn(),
  mockListMultipartUploads: vi.fn(),
  mockAbortMultipartUpload: vi.fn(),
}));
vi.mock("../../../providers/s3-storage.provider.js", () => ({
  S3StorageProvider: class {
    deleteObject = mockDeleteObject;
    fileExists = mockFileExists;
    listObjects = mockListObjects;
    listMultipartUploads = mockListMultipartUploads;
    abortMultipartUpload = mockAbortMultipartUpload;
  },
}));

vi.mock("../../audit/service.js", () => ({
  logAuditEvent: vi.fn(),
}));

vi.mock("../../quota/service.js", () => ({
  quotaService: {
    resolveEffectiveLimits: vi.fn(),
    calculateStorageUsed: vi.fn(),
    pickDeletionCandidates: vi.fn(),
    evaluateAndNotifyQuota: vi.fn(),
  },
}));

vi.mock("../../email/service.js", () => ({
  emailService: {
    send: vi.fn(),
  },
}));

vi.mock("../../email/i18n/loader.js", () => ({
  // Echo the key so reason assertions are deterministic.
  t: vi.fn((_locale: string, key: string) => Promise.resolve(key)),
}));

vi.mock("../../email/url-builder.js", () => ({
  buildShareManageUrl: vi.fn((id: string) => Promise.resolve(`https://app/shares?open=${id}`)),
  buildReverseShareManageUrl: vi.fn(() => Promise.resolve("https://app/reverse-shares")),
}));

vi.mock("../../../utils/logger.js", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLogger: vi.fn(() => logger) };
});

// ── Imports (after mocks) ──────────────────────────────────────────────────────

import { prisma } from "../../../shared/prisma.js";
import { logAuditEvent } from "../../audit/service.js";
import { emailService } from "../../email/service.js";
import { quotaService } from "../../quota/service.js";
import {
  cleanupDeactivatedAccounts,
  deactivateEndedReverseShares,
  deactivateEndedShares,
  deleteDeactivatedReverseShares,
  deleteDeactivatedShares,
  deleteReverseShareWithStorage,
  deleteShareLink,
  enforceQuotaOverage,
  purgeUserContent,
  sweepOrphans,
} from "../service.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// A minimal transactional client mirroring the real prisma surface used inside
// deleteShareLink. The $transaction mock invokes the callback with this object.
function makeTxClient() {
  return {
    share: {
      update: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn(),
    },
    shareSecurity: {
      delete: vi.fn().mockResolvedValue(undefined),
    },
  };
}

/** Wire `prisma.$transaction` to invoke its callback with the given tx client. */
function installTxMock(tx: ReturnType<typeof makeTxClient>): void {
  // The real $transaction has overloaded signatures; cast to a loose callback
  // form for the test double.
  (prisma.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (c: typeof tx) => Promise<unknown>) => cb(tx),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: send succeeds and enqueues.
  vi.mocked(emailService.send).mockResolvedValue({ enqueued: true });
  vi.mocked(logAuditEvent).mockResolvedValue(undefined);
  vi.mocked(prisma.share.update).mockResolvedValue(undefined as never);
  vi.mocked(prisma.reverseShare.update).mockResolvedValue(undefined as never);
  // Default: a compare-and-set updateMany succeeds (1 row affected). Tests that
  // exercise the race-loser path override this with { count: 0 }.
  vi.mocked(prisma.share.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.reverseShare.updateMany).mockResolvedValue({ count: 1 } as never);
  mockDeleteObject.mockResolvedValue(undefined);
  mockFileExists.mockResolvedValue(true);
  mockListObjects.mockResolvedValue([]);
  // Default: no incomplete multipart uploads, abort succeeds.
  mockListMultipartUploads.mockResolvedValue([]);
  mockAbortMultipartUpload.mockResolvedValue(undefined);
  // Default: no folders / background images own any keys (overridden per test).
  vi.mocked(prisma.folder.findMany).mockResolvedValue([] as never);
  vi.mocked(prisma.backgroundImage.findMany).mockResolvedValue([] as never);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── deleteShareLink ─────────────────────────────────────────────────────────────

describe("deleteShareLink", () => {
  it("deletes the share then its orphaned ShareSecurity (no orphan left)", async () => {
    const tx = makeTxClient();
    tx.share.delete.mockResolvedValue({ id: "s1", security: { id: "sec1" } });
    installTxMock(tx);

    await deleteShareLink("s1");

    expect(tx.share.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { files: { set: [] }, folders: { set: [] } },
    });
    expect(tx.share.delete).toHaveBeenCalledWith({
      where: { id: "s1" },
      include: { security: true },
    });
    // The security row MUST be deleted explicitly — it does not cascade.
    expect(tx.shareSecurity.delete).toHaveBeenCalledWith({ where: { id: "sec1" } });
  });
});

// ── deleteReverseShareWithStorage ───────────────────────────────────────────────

describe("deleteReverseShareWithStorage", () => {
  it("deletes DB row first, then best-effort deletes each S3 object", async () => {
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([
      { objectName: "o1" },
      { objectName: "o2" },
    ] as never);
    vi.mocked(prisma.reverseShare.delete).mockResolvedValue({ id: "rs1" } as never);

    const errors = await deleteReverseShareWithStorage("rs1");

    expect(prisma.reverseShare.delete).toHaveBeenCalledWith({ where: { id: "rs1" } });
    expect(mockDeleteObject).toHaveBeenCalledWith("o1");
    expect(mockDeleteObject).toHaveBeenCalledWith("o2");
    expect(errors).toBe(0);
  });

  it("tolerates an S3 delete failure: continues with others and reports the count", async () => {
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([
      { objectName: "o1" },
      { objectName: "o2" },
    ] as never);
    vi.mocked(prisma.reverseShare.delete).mockResolvedValue({ id: "rs1" } as never);
    mockDeleteObject.mockRejectedValueOnce(new Error("S3 down")).mockResolvedValueOnce(undefined);

    const errors = await deleteReverseShareWithStorage("rs1");

    // Both attempted despite the first failing.
    expect(mockDeleteObject).toHaveBeenCalledTimes(2);
    expect(errors).toBe(1);
  });
});

// ── deactivateEndedShares (phase 1) ─────────────────────────────────────────────

describe("deactivateEndedShares", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    // Three findMany calls: expired-active, maxViews-candidates, expired-manual.
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);
  });

  it("deactivates an active expired share with reason=expired, anchoring deactivatedAt at the expiration instant", async () => {
    const expired = new Date(Date.now() - 2 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          maxViews: null,
          expiration: expired,
          views: 0,
          notifiedForExpired: false,
          notifiedForMaxViews: false,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never) // expired-active
      .mockResolvedValueOnce([] as never) // maxViews
      .mockResolvedValueOnce([] as never); // expired-manual

    const summary = await deactivateEndedShares();

    expect(summary).toEqual({ deactivated: 1, errors: 0 });
    // Compare-and-set writes the deactivation fields with deactivatedAt = expiration.
    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", isActive: true },
      data: { isActive: false, deactivatedAt: expired, deactivationReason: "expired" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_DEACTIVATED",
        targetId: "s1",
        metadata: expect.objectContaining({ reason: "expired" }),
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      "share_expired",
      expect.objectContaining({
        relatedId: "s1",
        data: expect.objectContaining({ expiredAt: expired.toISOString() }),
      }),
    );
  });

  it("deactivates a maxViews-reached active share with reason=max_views (views >= cap)", async () => {
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never) // expired-active
      .mockResolvedValueOnce([
        {
          id: "s2",
          name: "Photos",
          maxViews: 5,
          expiration: null,
          views: 5,
          notifiedForExpired: false,
          notifiedForMaxViews: false,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never) // maxViews
      .mockResolvedValueOnce([] as never); // expired-manual

    const summary = await deactivateEndedShares();

    expect(summary.deactivated).toBe(1);
    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: { id: "s2", isActive: true },
      data: expect.objectContaining({ isActive: false, deactivationReason: "max_views" }),
    });
    expect(emailService.send).toHaveBeenCalledWith(
      "share_max_views_reached",
      expect.objectContaining({ relatedId: "s2", data: expect.objectContaining({ maxViews: 5 }) }),
    );
  });

  it("does NOT deactivate a maxViews candidate still below its cap", async () => {
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: "s2",
          name: "Photos",
          maxViews: 5,
          expiration: null,
          views: 4, // below cap
          notifiedForExpired: false,
          notifiedForMaxViews: false,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const summary = await deactivateEndedShares();

    expect(summary.deactivated).toBe(0);
    expect(prisma.share.updateMany).not.toHaveBeenCalled();
  });

  it("upgrades a manual pause whose expiration has passed to reason=expired, re-anchoring deactivatedAt", async () => {
    const expired = new Date(Date.now() - 3 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never) // expired-active
      .mockResolvedValueOnce([] as never) // maxViews
      .mockResolvedValueOnce([
        {
          id: "s3",
          name: "Paused",
          maxViews: null,
          expiration: expired,
          views: 0,
          notifiedForExpired: false,
          notifiedForMaxViews: false,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never); // expired-manual

    const summary = await deactivateEndedShares();

    expect(summary.deactivated).toBe(1);
    // Reason is upgraded from manual → expired, deactivatedAt re-anchored at expiration.
    expect(prisma.share.updateMany).toHaveBeenCalledWith({
      where: { id: "s3", isActive: false, deactivationReason: "manual" },
      data: { deactivatedAt: expired, deactivationReason: "expired" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_DEACTIVATED",
        targetId: "s3",
        metadata: expect.objectContaining({ reason: "expired", upgradedFrom: "manual" }),
      }),
    );
  });

  it("is race-safe: a compare-and-set that affects 0 rows is not counted and emits no notice", async () => {
    const expired = new Date(Date.now() - 2 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          maxViews: null,
          expiration: expired,
          views: 0,
          notifiedForExpired: false,
          notifiedForMaxViews: false,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);
    // A concurrent path already deactivated it.
    vi.mocked(prisma.share.updateMany).mockResolvedValue({ count: 0 } as never);

    const summary = await deactivateEndedShares();

    expect(summary.deactivated).toBe(0);
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it("notifies once: skips the deactivation notice when the flag is already set", async () => {
    const expired = new Date(Date.now() - 2 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          maxViews: null,
          expiration: expired,
          views: 0,
          notifiedForExpired: true, // already notified
          notifiedForMaxViews: false,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    const summary = await deactivateEndedShares();

    // Still deactivated + audited, but no email sent.
    expect(summary.deactivated).toBe(1);
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it("flips notifiedForExpired only when the notice was enqueued (retry-safe)", async () => {
    const expired = new Date(Date.now() - 2 * ONE_DAY_MS);
    vi.mocked(emailService.send).mockResolvedValue({ enqueued: false });
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          maxViews: null,
          expiration: expired,
          views: 0,
          notifiedForExpired: false,
          notifiedForMaxViews: false,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    await deactivateEndedShares();

    // The deactivation compare-and-set ran, but the notifiedForExpired flag was
    // NOT flipped because the email did not enqueue.
    expect(prisma.share.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ notifiedForExpired: false }) }),
    );
  });
});

// ── deleteDeactivatedShares (phase 2) ───────────────────────────────────────────

describe("deleteDeactivatedShares", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);
    const tx = makeTxClient();
    tx.share.delete.mockResolvedValue({ id: "s1", security: { id: "sec1" } });
    installTxMock(tx);
  });

  it("deletes a share deactivated past the grace window (measured from deactivatedAt)", async () => {
    // grace = 7d; deactivated 8d ago → past the deletion moment.
    const deactivatedAt = new Date(Date.now() - 8 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never) // warn
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          deactivatedAt,
          deactivationReason: "expired",
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never); // delete

    const summary = await deleteDeactivatedShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(summary.deleted).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_AUTO_DELETED",
        targetId: "s1",
        metadata: expect.objectContaining({ reason: "expired" }),
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      "share_auto_deleted",
      expect.objectContaining({
        data: expect.objectContaining({ reason: "cleanupReason.expired" }),
      }),
    );
  });

  it("uses a localized view-limit reason for a max_views deletion", async () => {
    const deactivatedAt = new Date(Date.now() - 8 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          deactivatedAt,
          deactivationReason: "max_views",
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never);

    await deleteDeactivatedShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(emailService.send).toHaveBeenCalledWith(
      "share_auto_deleted",
      expect.objectContaining({
        data: expect.objectContaining({ reason: "cleanupReason.viewLimitReached" }),
      }),
    );
  });

  it("delete query measures grace from deactivatedAt and excludes manual pauses (auto-deletable reasons only)", async () => {
    const now = Date.now();
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never) // warn
      .mockResolvedValueOnce([] as never); // delete

    await deleteDeactivatedShares({ graceDays: 7, notifyDaysBefore: 3 });

    const deleteCall = vi.mocked(prisma.share.findMany).mock.calls[1][0] as {
      where: {
        isActive: boolean;
        deactivationReason: { in: string[] };
        deactivatedAt: { lt: Date };
      };
    };
    expect(deleteCall.where.isActive).toBe(false);
    // Grace boundary anchored on deactivatedAt = now - grace.
    expect(deleteCall.where.deactivatedAt.lt.getTime()).toBe(now - 7 * ONE_DAY_MS);
    // Manual pauses are excluded — only expired / max_views are eligible.
    expect(deleteCall.where.deactivationReason.in).toEqual(["expired", "max_views"]);
    expect(deleteCall.where.deactivationReason.in).not.toContain("manual");
  });

  it("warns once and sets the flag only when the email is enqueued", async () => {
    // grace 7, notify 3: deletion moment within 3 days → deactivatedAt in
    // (now-7d, now-4d]. Pick deactivatedAt = now - 5d.
    const deactivatedAt = new Date(Date.now() - 5 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          deactivatedAt,
          deactivationReason: "expired",
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en" },
        },
      ] as never) // warn
      .mockResolvedValueOnce([] as never); // delete

    const summary = await deleteDeactivatedShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(emailService.send).toHaveBeenCalledWith(
      "share_pending_deletion",
      expect.objectContaining({ relatedId: "s1" }),
    );
    expect(prisma.share.update).toHaveBeenCalledWith({
      where: { id: "s1" },
      data: { notifiedForPendingDeletion: true },
    });
    expect(summary.warned).toBe(1);
  });

  it("warn query also excludes manual pauses (auto-deletable reasons only)", async () => {
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never) // warn
      .mockResolvedValueOnce([] as never); // delete

    await deleteDeactivatedShares({ graceDays: 7, notifyDaysBefore: 3 });

    const warnCall = vi.mocked(prisma.share.findMany).mock.calls[0][0] as {
      where: { deactivationReason: { in: string[] } };
    };
    expect(warnCall.where.deactivationReason.in).toEqual(["expired", "max_views"]);
  });

  it("skips the warn phase entirely when notifyDaysBefore is 0", async () => {
    vi.mocked(prisma.share.findMany).mockResolvedValueOnce([] as never); // delete only

    await deleteDeactivatedShares({ graceDays: 7, notifyDaysBefore: 0 });

    expect(prisma.share.findMany).toHaveBeenCalledTimes(1);
  });
});

// ── deactivateEndedReverseShares (phase 1) ──────────────────────────────────────

describe("deactivateEndedReverseShares", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValue([] as never);
  });

  it("deactivates an active expired reverse share, anchoring deactivatedAt at expiration", async () => {
    const expired = new Date(Date.now() - 2 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValueOnce([
      {
        id: "rs1",
        name: "Inbox",
        expiration: expired,
        notifiedForExpired: false,
        creatorId: "u1",
        creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
      },
    ] as never);

    const summary = await deactivateEndedReverseShares();

    expect(summary).toEqual({ deactivated: 1, errors: 0 });
    expect(prisma.reverseShare.updateMany).toHaveBeenCalledWith({
      where: { id: "rs1", isActive: true },
      data: { isActive: false, deactivatedAt: expired, deactivationReason: "expired" },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REVERSE_SHARE_DEACTIVATED",
        targetId: "rs1",
        metadata: expect.objectContaining({ reason: "expired" }),
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      "reverse_share_expired",
      expect.objectContaining({
        relatedId: "rs1",
        data: expect.objectContaining({ expiredAt: expired.toISOString() }),
      }),
    );
  });

  it("is race-safe: a 0-row compare-and-set is not counted and emits no notice", async () => {
    const expired = new Date(Date.now() - 2 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValueOnce([
      {
        id: "rs1",
        name: "Inbox",
        expiration: expired,
        notifiedForExpired: false,
        creatorId: "u1",
        creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
      },
    ] as never);
    vi.mocked(prisma.reverseShare.updateMany).mockResolvedValue({ count: 0 } as never);

    const summary = await deactivateEndedReverseShares();

    expect(summary.deactivated).toBe(0);
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();
  });

  it("notifies once: skips the notice when notifiedForExpired is already set", async () => {
    const expired = new Date(Date.now() - 2 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValueOnce([
      {
        id: "rs1",
        name: "Inbox",
        expiration: expired,
        notifiedForExpired: true,
        creatorId: "u1",
        creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
      },
    ] as never);

    const summary = await deactivateEndedReverseShares();

    expect(summary.deactivated).toBe(1);
    expect(emailService.send).not.toHaveBeenCalled();
  });
});

// ── deleteDeactivatedReverseShares (phase 2) ────────────────────────────────────

describe("deleteDeactivatedReverseShares", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reverseShare.delete).mockResolvedValue({ id: "rs1" } as never);
  });

  it("deletes a reverse share deactivated past the grace window with its S3 objects and audits", async () => {
    const deactivatedAt = new Date(Date.now() - 8 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany)
      .mockResolvedValueOnce([] as never) // warn
      .mockResolvedValueOnce([
        {
          id: "rs1",
          name: "Inbox",
          deactivatedAt,
          deactivationReason: "expired",
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never); // delete
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([{ objectName: "o1" }] as never);

    const summary = await deleteDeactivatedReverseShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(summary.deleted).toBe(1);
    expect(mockDeleteObject).toHaveBeenCalledWith("o1");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REVERSE_SHARE_AUTO_DELETED",
        targetType: "reverse_share",
        targetId: "rs1",
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      "reverse_share_auto_deleted",
      expect.objectContaining({ to: "u@x.com" }),
    );
  });

  it("delete query measures grace from deactivatedAt and excludes manual pauses", async () => {
    const now = Date.now();
    vi.mocked(prisma.reverseShare.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([] as never);

    await deleteDeactivatedReverseShares({ graceDays: 7, notifyDaysBefore: 3 });

    const deleteCall = vi.mocked(prisma.reverseShare.findMany).mock.calls[1][0] as {
      where: {
        isActive: boolean;
        deactivationReason: { in: string[] };
        deactivatedAt: { lt: Date };
      };
    };
    expect(deleteCall.where.isActive).toBe(false);
    expect(deleteCall.where.deactivatedAt.lt.getTime()).toBe(now - 7 * ONE_DAY_MS);
    expect(deleteCall.where.deactivationReason.in).toEqual(["expired", "max_views"]);
    expect(deleteCall.where.deactivationReason.in).not.toContain("manual");
  });

  it("tolerates S3 best-effort failure: still deletes and counts the error", async () => {
    const deactivatedAt = new Date(Date.now() - 8 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: "rs1",
          name: "Inbox",
          deactivatedAt,
          deactivationReason: "expired",
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never);
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([{ objectName: "o1" }] as never);
    mockDeleteObject.mockRejectedValueOnce(new Error("S3 down"));

    const summary = await deleteDeactivatedReverseShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(summary.deleted).toBe(1);
    expect(summary.errors).toBe(1);
    expect(prisma.reverseShare.delete).toHaveBeenCalledWith({ where: { id: "rs1" } });
  });

  it("warns once before deletion and sets the flag only when enqueued", async () => {
    const deactivatedAt = new Date(Date.now() - 5 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany)
      .mockResolvedValueOnce([
        {
          id: "rs1",
          name: "Inbox",
          deactivatedAt,
          deactivationReason: "expired",
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en" },
        },
      ] as never) // warn
      .mockResolvedValueOnce([] as never); // delete

    const summary = await deleteDeactivatedReverseShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(emailService.send).toHaveBeenCalledWith(
      "reverse_share_pending_deletion",
      expect.objectContaining({ relatedId: "rs1" }),
    );
    expect(prisma.reverseShare.update).toHaveBeenCalledWith({
      where: { id: "rs1" },
      data: { notifiedForPendingDeletion: true },
    });
    expect(summary.warned).toBe(1);
  });
});

// ── purgeUserContent (A7/A8 shared helper) ──────────────────────────────────────

describe("purgeUserContent", () => {
  beforeEach(() => {
    // Default: user owns nothing.
    vi.mocked(prisma.file.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.file.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.folder.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reverseShare.delete).mockResolvedValue(undefined as never);
  });

  it("deletes the user's shares (link only), reverse shares (+S3), files & folders, then File S3 objects", async () => {
    vi.mocked(prisma.file.findMany).mockResolvedValue([
      { objectName: "u1/a.jpg" },
      { objectName: "u1/b.png" },
    ] as never);
    vi.mocked(prisma.file.deleteMany).mockResolvedValue({ count: 2 } as never);
    vi.mocked(prisma.folder.deleteMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.share.findMany).mockResolvedValue([{ id: "s1" }, { id: "s2" }] as never);
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValue([{ id: "rs1" }] as never);
    // The reverse share has one uploaded file with an S3 object.
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([
      { objectName: "rs1/upload.bin" },
    ] as never);

    const tx = makeTxClient();
    tx.share.delete.mockResolvedValue({ security: null });
    installTxMock(tx);

    const result = await purgeUserContent("u1");

    // Shares removed via deleteShareLink (transactional, link-only).
    expect(prisma.share.findMany).toHaveBeenCalledWith({
      where: { creatorId: "u1" },
      select: { id: true },
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);

    // Reverse share + its S3 object removed.
    expect(prisma.reverseShare.delete).toHaveBeenCalledWith({ where: { id: "rs1" } });
    expect(mockDeleteObject).toHaveBeenCalledWith("rs1/upload.bin");

    // File/folder rows removed, then each File S3 object deleted.
    expect(prisma.file.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(prisma.folder.deleteMany).toHaveBeenCalledWith({ where: { userId: "u1" } });
    expect(mockDeleteObject).toHaveBeenCalledWith("u1/a.jpg");
    expect(mockDeleteObject).toHaveBeenCalledWith("u1/b.png");

    expect(result).toEqual({
      files: 2,
      shares: 2,
      reverseShares: 1,
      folders: 1,
      s3Errors: 0,
    });
  });

  it("deletes the user's Folder S3 objects (skipping null object names)", async () => {
    vi.mocked(prisma.file.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.folder.findMany).mockResolvedValue([
      { objectName: "u1/folder-a.placeholder" },
      { objectName: null }, // a folder without a placeholder object → skipped
      { objectName: "u1/folder-b.placeholder" },
    ] as never);
    vi.mocked(prisma.folder.deleteMany).mockResolvedValue({ count: 3 } as never);

    const result = await purgeUserContent("u1");

    expect(prisma.folder.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { objectName: true },
    });
    expect(mockDeleteObject).toHaveBeenCalledWith("u1/folder-a.placeholder");
    expect(mockDeleteObject).toHaveBeenCalledWith("u1/folder-b.placeholder");
    // The null-object folder is skipped (no delete attempt, no error).
    expect(mockDeleteObject).toHaveBeenCalledTimes(2);
    expect(result.folders).toBe(3);
    expect(result.s3Errors).toBe(0);
  });

  it("never touches the user row", async () => {
    await purgeUserContent("u1");
    // The mock prisma surface has no `user.delete` — assert the purge does not
    // attempt any user deletion by confirming only the expected surfaces ran.
    expect(prisma.file.deleteMany).toHaveBeenCalled();
    expect(prisma.folder.deleteMany).toHaveBeenCalled();
  });

  it("counts a File S3 delete failure without aborting the rest", async () => {
    vi.mocked(prisma.file.findMany).mockResolvedValue([
      { objectName: "u1/a.jpg" },
      { objectName: "u1/b.png" },
    ] as never);
    vi.mocked(prisma.file.deleteMany).mockResolvedValue({ count: 2 } as never);
    mockDeleteObject.mockRejectedValueOnce(new Error("s3 down")).mockResolvedValue(undefined);

    const result = await purgeUserContent("u1");

    // Both objects attempted despite the first failing.
    expect(mockDeleteObject).toHaveBeenCalledTimes(2);
    expect(result.s3Errors).toBe(1);
    expect(result.files).toBe(2);
  });
});

// ── cleanupDeactivatedAccounts (A7) ─────────────────────────────────────────────

describe("cleanupDeactivatedAccounts", () => {
  beforeEach(() => {
    vi.mocked(prisma.file.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.file.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.folder.deleteMany).mockResolvedValue({ count: 0 } as never);
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValue([] as never);
  });

  it("selects only accounts deactivated longer than `days`, purges them, notifies, and audits", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en" },
    ] as never);
    vi.mocked(prisma.file.findMany).mockResolvedValue([{ objectName: "u1/a.jpg" }] as never);
    vi.mocked(prisma.file.deleteMany).mockResolvedValue({ count: 1 } as never);

    const summary = await cleanupDeactivatedAccounts({ days: 30 });

    // Query selects deactivated, time-windowed accounts.
    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]?.where as {
      isActive: boolean;
      deactivatedAt: { not: null; lt: Date };
    };
    expect(where.isActive).toBe(false);
    expect(where.deactivatedAt.lt).toBeInstanceOf(Date);

    // Content purged (File S3 object deleted).
    expect(mockDeleteObject).toHaveBeenCalledWith("u1/a.jpg");

    // User row is KEPT (no user.delete on the mock surface) and a notification + audit fire.
    expect(emailService.send).toHaveBeenCalledWith(
      "files_auto_deleted",
      expect.objectContaining({
        to: "u1@example.com",
        userId: "u1",
        data: expect.objectContaining({ reason: "cleanupReason.accountDeactivated" }),
      }),
    );
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ACCOUNT_FILES_CLEANED",
        targetType: "user",
        targetId: "u1",
        ipAddress: "system",
        metadata: expect.objectContaining({ files: 1 }),
      }),
    );

    expect(summary).toEqual({ purgedAccounts: 1, errors: 0 });
  });

  it("isolates a per-account failure without aborting the batch", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en" },
      { id: "u2", email: "u2@example.com", locale: "en" },
    ] as never);
    // First account's purge throws on its File query; second succeeds.
    vi.mocked(prisma.file.findMany)
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue([] as never);

    const summary = await cleanupDeactivatedAccounts({ days: 30 });

    expect(summary.purgedAccounts).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("returns a zero summary when no accounts qualify", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    const summary = await cleanupDeactivatedAccounts({ days: 30 });

    expect(summary).toEqual({ purgedAccounts: 0, errors: 0 });
    expect(emailService.send).not.toHaveBeenCalled();
  });
});

// ── sweepOrphans (A9) ───────────────────────────────────────────────────────────

describe("sweepOrphans", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    // Default: nothing in either table, empty bucket.
    vi.mocked(prisma.file.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.file.delete).mockResolvedValue(undefined as never);
    vi.mocked(prisma.reverseShareFile.delete).mockResolvedValue(undefined as never);
  });

  it("DB→S3: deletes File / ReverseShareFile rows whose S3 object is missing and audits", async () => {
    // DB→S3 phase reads File then ReverseShareFile; S3→DB phase re-reads both.
    vi.mocked(prisma.file.findMany)
      .mockResolvedValueOnce([{ id: "f1", objectName: "u1/missing.bin" }] as never) // DB→S3
      .mockResolvedValueOnce([] as never); // S3→DB known-keys
    vi.mocked(prisma.reverseShareFile.findMany)
      .mockResolvedValueOnce([
        { id: "rf1", objectName: "rs1/missing.bin", reverseShareId: "rs1" },
      ] as never) // DB→S3
      .mockResolvedValueOnce([] as never); // S3→DB known-keys
    mockFileExists.mockResolvedValue(false); // both objects missing

    const summary = await sweepOrphans({ minAgeHours: 24 });

    expect(prisma.file.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
    expect(prisma.reverseShareFile.delete).toHaveBeenCalledWith({ where: { id: "rf1" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ORPHAN_DB_DELETED",
        targetType: "file",
        targetId: "f1",
        ipAddress: "system",
        metadata: { objectName: "u1/missing.bin" },
      }),
    );
    // For a ReverseShareFile orphan the audit targets the PARENT reverse share
    // (which resolves) with the file id + key in metadata.
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ORPHAN_DB_DELETED",
        targetType: "reverse_share",
        targetId: "rs1",
        metadata: { fileId: "rf1", objectName: "rs1/missing.bin" },
      }),
    );
    expect(summary.dbDeleted).toBe(2);
    expect(summary.errors).toBe(0);

    // Asserts the min-age cutoff is now - 24h.
    const fileWhere = vi.mocked(prisma.file.findMany).mock.calls[0][0]?.where as {
      createdAt: { lt: Date };
    };
    expect(fileWhere.createdAt.lt.getTime()).toBe(Date.now() - 24 * 60 * 60 * 1000);
  });

  it("DB→S3: keeps a row whose S3 object still exists", async () => {
    vi.mocked(prisma.file.findMany)
      .mockResolvedValueOnce([{ id: "f1", objectName: "u1/present.bin" }] as never)
      .mockResolvedValueOnce([{ objectName: "u1/present.bin" }] as never);
    mockFileExists.mockResolvedValue(true);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    expect(prisma.file.delete).not.toHaveBeenCalled();
    expect(summary.dbDeleted).toBe(0);
  });

  it("S3→DB: deletes an old object referenced by no DB row and audits", async () => {
    const oldObj = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockListObjects.mockResolvedValue([{ key: "orphan.bin", size: 1, lastModified: oldObj }]);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    expect(mockDeleteObject).toHaveBeenCalledWith("orphan.bin");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ORPHAN_S3_DELETED",
        ipAddress: "system",
        metadata: { key: "orphan.bin" },
      }),
    );
    expect(summary.s3Deleted).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("S3→DB: NEVER deletes an object referenced by File OR ReverseShareFile (multi-reference safety)", async () => {
    const oldObj = new Date(Date.now() - 48 * 60 * 60 * 1000);
    // Known-keys reads (second call to each findMany): one key per table.
    vi.mocked(prisma.file.findMany)
      .mockResolvedValueOnce([] as never) // DB→S3
      .mockResolvedValueOnce([{ objectName: "owned-by-file.bin" }] as never); // known-keys
    vi.mocked(prisma.reverseShareFile.findMany)
      .mockResolvedValueOnce([] as never) // DB→S3
      .mockResolvedValueOnce([{ objectName: "owned-by-rsf.bin" }] as never); // known-keys
    mockListObjects.mockResolvedValue([
      { key: "owned-by-file.bin", size: 1, lastModified: oldObj },
      { key: "owned-by-rsf.bin", size: 1, lastModified: oldObj },
      { key: "truly-orphan.bin", size: 1, lastModified: oldObj },
    ]);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    // Only the unreferenced object is deleted.
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith("truly-orphan.bin");
    expect(summary.s3Deleted).toBe(1);
  });

  it("S3→DB: skips objects younger than the min-age cutoff (boundary)", async () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    mockListObjects.mockResolvedValue([
      // 1 ms younger than the cutoff → protected (in-flight upload).
      { key: "fresh.bin", size: 1, lastModified: new Date(cutoff + 1) },
      // 1 ms older than the cutoff → swept.
      { key: "stale.bin", size: 1, lastModified: new Date(cutoff - 1) },
    ]);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith("stale.bin");
    expect(summary.s3Deleted).toBe(1);
  });

  it("tolerates a single S3 delete failure without aborting the rest", async () => {
    const oldObj = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockListObjects.mockResolvedValue([
      { key: "orphan-a.bin", size: 1, lastModified: oldObj },
      { key: "orphan-b.bin", size: 1, lastModified: oldObj },
    ]);
    mockDeleteObject.mockRejectedValueOnce(new Error("S3 down")).mockResolvedValueOnce(undefined);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    // Both attempted; the first failed.
    expect(mockDeleteObject).toHaveBeenCalledTimes(2);
    expect(summary.s3Deleted).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("tolerates a DB delete failure in the DB→S3 phase and continues", async () => {
    vi.mocked(prisma.file.findMany)
      .mockResolvedValueOnce([
        { id: "f1", objectName: "miss-a.bin" },
        { id: "f2", objectName: "miss-b.bin" },
      ] as never)
      .mockResolvedValueOnce([] as never);
    mockFileExists.mockResolvedValue(false);
    vi.mocked(prisma.file.delete)
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(undefined as never);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    expect(prisma.file.delete).toHaveBeenCalledTimes(2);
    expect(summary.dbDeleted).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("returns a zero summary when there are no orphans on either side", async () => {
    const summary = await sweepOrphans({ minAgeHours: 24 });
    expect(summary).toEqual({ dbDeleted: 0, s3Deleted: 0, multipartAborted: 0, errors: 0 });
  });

  it("multipart: aborts an upload initiated before the cutoff and audits", async () => {
    const oldInit = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockListMultipartUploads.mockResolvedValue([
      { key: "reverse-shares/rs1/big.bin", uploadId: "upload-1", initiated: oldInit },
    ]);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    expect(mockAbortMultipartUpload).toHaveBeenCalledWith("reverse-shares/rs1/big.bin", "upload-1");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ORPHAN_MULTIPART_ABORTED",
        ipAddress: "system",
        targetType: "file",
        metadata: {
          key: "reverse-shares/rs1/big.bin",
          uploadId: "upload-1",
          initiatedAt: oldInit.toISOString(),
        },
      }),
    );
    expect(summary.multipartAborted).toBe(1);
    expect(summary.errors).toBe(0);
  });

  it("multipart: NEVER aborts an upload younger than the min-age cutoff (boundary)", async () => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    mockListMultipartUploads.mockResolvedValue([
      // 1 ms younger than the cutoff → protected (still being assembled).
      { key: "fresh-upload.bin", uploadId: "u-fresh", initiated: new Date(cutoff + 1) },
      // 1 ms older than the cutoff → aborted.
      { key: "stale-upload.bin", uploadId: "u-stale", initiated: new Date(cutoff - 1) },
    ]);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    expect(mockAbortMultipartUpload).toHaveBeenCalledTimes(1);
    expect(mockAbortMultipartUpload).toHaveBeenCalledWith("stale-upload.bin", "u-stale");
    expect(summary.multipartAborted).toBe(1);
  });

  it("multipart: tolerates a single abort failure without aborting the rest", async () => {
    const oldInit = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockListMultipartUploads.mockResolvedValue([
      { key: "a.bin", uploadId: "u-a", initiated: oldInit },
      { key: "b.bin", uploadId: "u-b", initiated: oldInit },
    ]);
    mockAbortMultipartUpload
      .mockRejectedValueOnce(new Error("S3 down"))
      .mockResolvedValueOnce(undefined);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    expect(mockAbortMultipartUpload).toHaveBeenCalledTimes(2);
    expect(summary.multipartAborted).toBe(1);
    expect(summary.errors).toBe(1);
  });

  it("multipart dryRun: lists candidates but aborts nothing and emits no audit", async () => {
    const oldInit = new Date(Date.now() - 48 * 60 * 60 * 1000);
    mockListMultipartUploads.mockResolvedValue([
      { key: "abandoned.bin", uploadId: "u-1", initiated: oldInit },
    ]);

    const summary = await sweepOrphans({ minAgeHours: 24, dryRun: true });

    expect(mockAbortMultipartUpload).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(summary.multipartAborted).toBe(1);
    expect(summary.multipartCandidates).toEqual([
      { key: "abandoned.bin", uploadId: "u-1", initiatedAt: oldInit.toISOString() },
    ]);
  });

  it("S3→DB: NEVER deletes objects referenced by BackgroundImage or Folder (regression)", async () => {
    const oldObj = new Date(Date.now() - 48 * 60 * 60 * 1000);
    // Folder owns a placeholder object; BackgroundImage owns an image + thumbnail.
    vi.mocked(prisma.folder.findMany).mockResolvedValueOnce([
      { objectName: "folder-placeholder.bin" },
    ] as never);
    vi.mocked(prisma.backgroundImage.findMany).mockResolvedValueOnce([
      { s3Key: "backgrounds/bg1.webp", thumbnailS3Key: "backgrounds/bg1_thumb.webp" },
    ] as never);
    mockListObjects.mockResolvedValue([
      { key: "backgrounds/bg1.webp", size: 1, lastModified: oldObj },
      { key: "backgrounds/bg1_thumb.webp", size: 1, lastModified: oldObj },
      { key: "folder-placeholder.bin", size: 1, lastModified: oldObj },
      { key: "truly-orphan.bin", size: 1, lastModified: oldObj },
    ]);

    const summary = await sweepOrphans({ minAgeHours: 24 });

    // Only the truly-unreferenced object is swept; protected objects are kept.
    expect(mockDeleteObject).toHaveBeenCalledTimes(1);
    expect(mockDeleteObject).toHaveBeenCalledWith("truly-orphan.bin");
    expect(mockDeleteObject).not.toHaveBeenCalledWith("backgrounds/bg1.webp");
    expect(mockDeleteObject).not.toHaveBeenCalledWith("backgrounds/bg1_thumb.webp");
    expect(mockDeleteObject).not.toHaveBeenCalledWith("folder-placeholder.bin");
    expect(summary.s3Deleted).toBe(1);
  });

  it("dryRun: computes candidates but deletes nothing and emits no audit events", async () => {
    const oldObj = new Date(Date.now() - 48 * 60 * 60 * 1000);
    // One missing-object DB row (File) and one unreferenced S3 object.
    vi.mocked(prisma.file.findMany)
      .mockResolvedValueOnce([{ id: "f1", objectName: "u1/missing.bin" }] as never) // DB→S3
      .mockResolvedValueOnce([] as never); // known-keys
    mockFileExists.mockResolvedValue(false);
    mockListObjects.mockResolvedValue([{ key: "truly-orphan.bin", size: 1, lastModified: oldObj }]);

    const summary = await sweepOrphans({ minAgeHours: 24, dryRun: true });

    // Nothing deleted, no audit emitted.
    expect(prisma.file.delete).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    expect(logAuditEvent).not.toHaveBeenCalled();

    // Candidates returned with the same counts the real run would report.
    expect(summary.dbDeleted).toBe(1);
    expect(summary.s3Deleted).toBe(1);
    expect(summary.dbCandidates).toEqual([
      { table: "file", id: "f1", objectName: "u1/missing.bin" },
    ]);
    expect(summary.s3Candidates).toEqual(["truly-orphan.bin"]);
    // No incomplete multipart uploads in this scenario.
    expect(summary.multipartAborted).toBe(0);
    expect(summary.multipartCandidates).toEqual([]);
  });
});

// ── enforceQuotaOverage (B2) ────────────────────────────────────────────────────

describe("enforceQuotaOverage", () => {
  /** Build a minimal EffectiveLimits-shaped object exposing only maxTotalStorage. */
  function limits(maxTotalStorage: bigint) {
    return { maxTotalStorage } as never;
  }

  /** A DeletionCandidateFile. */
  function candidate(id: string, objectName: string, size: bigint) {
    return { id, objectName, size };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    // Sensible defaults: no users, nothing to delete, S3 ok.
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.user.update).mockResolvedValue(undefined as never);
    vi.mocked(prisma.file.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.file.delete).mockResolvedValue(undefined as never);
    mockDeleteObject.mockResolvedValue(undefined);
    vi.mocked(quotaService.resolveEffectiveLimits).mockResolvedValue(limits(100n));
    vi.mocked(quotaService.calculateStorageUsed).mockResolvedValue(0n);
    vi.mocked(quotaService.pickDeletionCandidates).mockResolvedValue([]);
    vi.mocked(quotaService.evaluateAndNotifyQuota).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("selects only users whose grace window has elapsed (boundary: just-over vs just-under)", async () => {
    await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    const where = vi.mocked(prisma.user.findMany).mock.calls[0][0]?.where as {
      quotaExceededSince: { not: null; lt: Date };
    };
    // now - 7d
    expect(where.quotaExceededSince.lt.toISOString()).toBe("2026-05-27T00:00:00.000Z");
  });

  it("deletes orphans before inactive-share files, stops at the limit, frees bytes, audits, notifies, clears state", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en", isActive: true },
    ] as never);
    vi.mocked(quotaService.resolveEffectiveLimits).mockResolvedValue(limits(100n));
    // used 160 → bytesToFree 60.
    vi.mocked(quotaService.calculateStorageUsed)
      .mockResolvedValueOnce(160n) // initial
      .mockResolvedValueOnce(60n); // after deletion (160 - 100 freed)
    // pickDeletionCandidates is the authority on order (orphans first, then
    // inactive-share, oldest-first, capped at bytesToFree). The sweep deletes
    // exactly what it returns, in order.
    const cands = [
      candidate("orphan1", "u1/orphan1.bin", 40n),
      candidate("inactive1", "u1/inactive1.bin", 60n),
    ];
    vi.mocked(quotaService.pickDeletionCandidates).mockResolvedValue(cands);
    vi.mocked(prisma.file.findMany).mockResolvedValue([
      { id: "orphan1", name: "Orphan One.bin" },
      { id: "inactive1", name: "Inactive One.bin" },
    ] as never);

    const summary = await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    // pickDeletionCandidates called with the user's bytesToFree and inactiveShareDays.
    expect(quotaService.pickDeletionCandidates).toHaveBeenCalledWith(
      "u1",
      60n,
      30,
      expect.any(Date),
    );

    // Both files deleted DB-before-S3, in candidate order.
    expect(vi.mocked(prisma.file.delete).mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "orphan1" } },
      { where: { id: "inactive1" } },
    ]);
    expect(mockDeleteObject.mock.calls.map((c) => c[0])).toEqual([
      "u1/orphan1.bin",
      "u1/inactive1.bin",
    ]);

    // Accounting.
    expect(summary).toEqual({
      usersProcessed: 1,
      filesDeleted: 2,
      bytesFreed: 100,
      blocked: 0,
      errors: 0,
    });

    // State cleared through the centralized path with recomputed usage.
    expect(quotaService.evaluateAndNotifyQuota).toHaveBeenCalledWith("u1", {
      oldUsed: 160n,
      newUsed: 60n,
    });

    // Audit + notification.
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "QUOTA_FILES_DELETED",
        targetType: "user",
        targetId: "u1",
        ipAddress: "system",
        metadata: { filesDeleted: 2, bytesFreed: 100 },
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      "files_auto_deleted",
      expect.objectContaining({
        to: "u1@example.com",
        userId: "u1",
        data: expect.objectContaining({
          fileNames: ["Orphan One.bin", "Inactive One.bin"],
          reason: "cleanupReason.quotaExceeded",
        }),
      }),
    );
  });

  it("deletes NOTHING and counts the user as blocked when everything is in an active share", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en", isActive: true },
    ] as never);
    vi.mocked(quotaService.resolveEffectiveLimits).mockResolvedValue(limits(100n));
    vi.mocked(quotaService.calculateStorageUsed).mockResolvedValue(160n);
    // No safe candidate — everything is in an active share.
    vi.mocked(quotaService.pickDeletionCandidates).mockResolvedValue([]);

    const summary = await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    expect(prisma.file.delete).not.toHaveBeenCalled();
    expect(mockDeleteObject).not.toHaveBeenCalled();
    // No destructive audit, no clearing of state (user stays over, blocked).
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(quotaService.evaluateAndNotifyQuota).not.toHaveBeenCalled();
    expect(emailService.send).not.toHaveBeenCalled();

    expect(summary).toEqual({
      usersProcessed: 1,
      filesDeleted: 0,
      bytesFreed: 0,
      blocked: 1,
      errors: 0,
    });
  });

  it("tolerates an S3 delete failure: DB row still gone, deletion continues, error counted", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en", isActive: true },
    ] as never);
    vi.mocked(quotaService.resolveEffectiveLimits).mockResolvedValue(limits(100n));
    vi.mocked(quotaService.calculateStorageUsed)
      .mockResolvedValueOnce(150n)
      .mockResolvedValueOnce(60n);
    const cands = [candidate("f1", "u1/f1.bin", 30n), candidate("f2", "u1/f2.bin", 60n)];
    vi.mocked(quotaService.pickDeletionCandidates).mockResolvedValue(cands);
    vi.mocked(prisma.file.findMany).mockResolvedValue([
      { id: "f1", name: "f1.bin" },
      { id: "f2", name: "f2.bin" },
    ] as never);
    // First S3 delete throws; second succeeds.
    mockDeleteObject.mockRejectedValueOnce(new Error("s3 down")).mockResolvedValueOnce(undefined);

    const summary = await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    // Both DB rows deleted despite the first S3 failure (DB-before-S3, tolerant).
    expect(vi.mocked(prisma.file.delete).mock.calls.map((c) => c[0])).toEqual([
      { where: { id: "f1" } },
      { where: { id: "f2" } },
    ]);
    expect(summary.filesDeleted).toBe(2);
    expect(summary.bytesFreed).toBe(90);
    expect(summary.errors).toBe(1);
    // The run still completes: audit + notification emitted.
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "QUOTA_FILES_DELETED" }),
    );
  });

  it("clears quotaExceededSince and skips when the user is already back under the limit", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en", isActive: true },
    ] as never);
    vi.mocked(quotaService.resolveEffectiveLimits).mockResolvedValue(limits(100n));
    // used 80 < limit 100 ⇒ bytesToFree <= 0.
    vi.mocked(quotaService.calculateStorageUsed).mockResolvedValue(80n);

    const summary = await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    expect(quotaService.pickDeletionCandidates).not.toHaveBeenCalled();
    expect(prisma.file.delete).not.toHaveBeenCalled();
    // Cleared centrally (no spurious warning — usage equal old/new).
    expect(quotaService.evaluateAndNotifyQuota).toHaveBeenCalledWith("u1", {
      oldUsed: 80n,
      newUsed: 80n,
    });
    expect(logAuditEvent).not.toHaveBeenCalled();
    expect(summary).toEqual({
      usersProcessed: 1,
      filesDeleted: 0,
      bytesFreed: 0,
      blocked: 0,
      errors: 0,
    });
  });

  it("clears the stale grace clock and skips an unlimited-quota user", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en", isActive: true },
    ] as never);
    vi.mocked(quotaService.resolveEffectiveLimits).mockResolvedValue(limits(0n));

    const summary = await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { quotaExceededSince: null },
    });
    expect(quotaService.pickDeletionCandidates).not.toHaveBeenCalled();
    expect(prisma.file.delete).not.toHaveBeenCalled();
    expect(summary).toEqual({
      usersProcessed: 1,
      filesDeleted: 0,
      bytesFreed: 0,
      blocked: 0,
      errors: 0,
    });
  });

  it("does not email a deactivated owner but still deletes, audits, and clears state", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en", isActive: false },
    ] as never);
    vi.mocked(quotaService.resolveEffectiveLimits).mockResolvedValue(limits(100n));
    vi.mocked(quotaService.calculateStorageUsed)
      .mockResolvedValueOnce(150n)
      .mockResolvedValueOnce(50n);
    vi.mocked(quotaService.pickDeletionCandidates).mockResolvedValue([
      candidate("f1", "u1/f1.bin", 100n),
    ]);
    vi.mocked(prisma.file.findMany).mockResolvedValue([{ id: "f1", name: "f1.bin" }] as never);

    const summary = await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    expect(prisma.file.delete).toHaveBeenCalledWith({ where: { id: "f1" } });
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "QUOTA_FILES_DELETED" }),
    );
    // No email to a deactivated owner.
    expect(emailService.send).not.toHaveBeenCalled();
    expect(summary.filesDeleted).toBe(1);
  });

  it("isolates a per-user failure without aborting the batch", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([
      { id: "u1", email: "u1@example.com", locale: "en", isActive: true },
      { id: "u2", email: "u2@example.com", locale: "en", isActive: true },
    ] as never);
    vi.mocked(quotaService.resolveEffectiveLimits)
      .mockRejectedValueOnce(new Error("limits boom")) // u1 fails outright
      .mockResolvedValueOnce(limits(100n)); // u2 ok
    vi.mocked(quotaService.calculateStorageUsed).mockResolvedValue(0n); // u2: under ⇒ skip
    vi.mocked(quotaService.evaluateAndNotifyQuota).mockResolvedValue(undefined);

    const summary = await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    expect(summary.usersProcessed).toBe(2);
    expect(summary.errors).toBe(1);
  });

  it("returns a zero summary when no users are over the grace window", async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);

    const summary = await enforceQuotaOverage({ graceDays: 7, inactiveShareDays: 30 });

    expect(summary).toEqual({
      usersProcessed: 0,
      filesDeleted: 0,
      bytesFreed: 0,
      blocked: 0,
      errors: 0,
    });
  });
});
