import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    share: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    shareSecurity: {
      delete: vi.fn(),
    },
    reverseShare: {
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    reverseShareFile: {
      findMany: vi.fn(),
    },
  },
}));

const { mockDeleteObject } = vi.hoisted(() => ({ mockDeleteObject: vi.fn() }));
vi.mock("../../../providers/s3-storage.provider.js", () => ({
  S3StorageProvider: class {
    deleteObject = mockDeleteObject;
  },
}));

vi.mock("../../audit/service.js", () => ({
  logAuditEvent: vi.fn(),
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
import {
  cleanupExpiredReverseShares,
  cleanupExpiredShares,
  cleanupMaxViewsShares,
  deleteReverseShareWithStorage,
  deleteShareLink,
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
  mockDeleteObject.mockResolvedValue(undefined);
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

// ── cleanupExpiredShares ────────────────────────────────────────────────────────

describe("cleanupExpiredShares", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    // Default: no shares to warn or delete.
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);
    const tx = makeTxClient();
    tx.share.delete.mockResolvedValue({ id: "s1", security: { id: "sec1" } });
    installTxMock(tx);
  });

  it("deletes a share past expiration + grace (just-after boundary)", async () => {
    const now = Date.now();
    // grace = 7 days. A share expired 8 days ago is past the deletion moment.
    const expired = new Date(now - 8 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never) // warn query
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          expiration: expired,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never); // delete query

    const summary = await cleanupExpiredShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(summary.deleted).toBe(1);
    expect(summary.errors).toBe(0);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_AUTO_DELETED",
        ipAddress: "system",
        targetType: "share",
        targetId: "s1",
        metadata: expect.objectContaining({ shareName: "Report", reason: "expired" }),
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      "share_auto_deleted",
      expect.objectContaining({
        to: "u@x.com",
        data: expect.objectContaining({ reason: "cleanupReason.expired" }),
      }),
    );
  });

  it("does NOT delete a share still inside the grace window (just-before boundary)", async () => {
    const now = Date.now();
    // grace = 7 days; expired only 6 days ago → deletion moment is in the future.
    // The delete query uses `expiration < now - grace`, so this share is excluded.
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([] as never) // warn
      .mockResolvedValueOnce([] as never); // delete returns nothing (filtered in SQL)

    const summary = await cleanupExpiredShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(summary.deleted).toBe(0);
    // Assert the delete query window is `now - grace`.
    const deleteCall = vi.mocked(prisma.share.findMany).mock.calls[1][0] as {
      where: { expiration: { lt: Date } };
    };
    expect(deleteCall.where.expiration.lt.getTime()).toBe(now - 7 * ONE_DAY_MS);
  });

  it("warns once and sets the flag only when the email is enqueued", async () => {
    const now = Date.now();
    // grace 7, notify 3: deletion moment within 3 days means expiration in
    // (now-7d, now-4d]. Pick expiration = now - 5d.
    const expiration = new Date(now - 5 * ONE_DAY_MS);
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          expiration,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en" },
        },
      ] as never) // warn query
      .mockResolvedValueOnce([] as never); // delete query

    const summary = await cleanupExpiredShares({ graceDays: 7, notifyDaysBefore: 3 });

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

  it("does NOT set the flag when the warning email is not enqueued (idempotency retry)", async () => {
    const now = Date.now();
    const expiration = new Date(now - 5 * ONE_DAY_MS);
    vi.mocked(emailService.send).mockResolvedValue({ enqueued: false });
    vi.mocked(prisma.share.findMany)
      .mockResolvedValueOnce([
        {
          id: "s1",
          name: "Report",
          expiration,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en" },
        },
      ] as never)
      .mockResolvedValueOnce([] as never);

    const summary = await cleanupExpiredShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(prisma.share.update).not.toHaveBeenCalled();
    expect(summary.warned).toBe(0);
  });

  it("skips the warn phase entirely when notifyDaysBefore is 0", async () => {
    vi.mocked(prisma.share.findMany).mockResolvedValueOnce([] as never); // delete query only

    await cleanupExpiredShares({ graceDays: 7, notifyDaysBefore: 0 });

    // Only the delete query ran (no warn query).
    expect(prisma.share.findMany).toHaveBeenCalledTimes(1);
  });
});

// ── cleanupMaxViewsShares ───────────────────────────────────────────────────────

describe("cleanupMaxViewsShares", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    const tx = makeTxClient();
    tx.share.delete.mockResolvedValue({ id: "s1", security: { id: "sec1" } });
    installTxMock(tx);
  });

  it("deletes a maxViews-reached share that has been inactive long enough", async () => {
    const now = Date.now();
    vi.mocked(prisma.share.findMany).mockResolvedValue([
      {
        id: "s1",
        name: "Report",
        views: 10,
        maxViews: 10,
        lastDownloadedAt: new Date(now - 40 * ONE_DAY_MS),
        updatedAt: new Date(now - 40 * ONE_DAY_MS),
        creatorId: "u1",
        creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
      },
    ] as never);

    const summary = await cleanupMaxViewsShares({ inactiveDays: 30 });

    expect(summary.deleted).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "SHARE_AUTO_DELETED",
        metadata: expect.objectContaining({ reason: "view limit reached" }),
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      "share_auto_deleted",
      expect.objectContaining({
        data: expect.objectContaining({ reason: "cleanupReason.viewLimitReached" }),
      }),
    );
  });

  it("skips a share that reached maxViews but is below the view cap (boundary)", async () => {
    const now = Date.now();
    vi.mocked(prisma.share.findMany).mockResolvedValue([
      {
        id: "s1",
        name: "Report",
        views: 9, // below cap
        maxViews: 10,
        lastDownloadedAt: new Date(now - 40 * ONE_DAY_MS),
        updatedAt: new Date(now - 40 * ONE_DAY_MS),
        creatorId: "u1",
        creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
      },
    ] as never);

    const summary = await cleanupMaxViewsShares({ inactiveDays: 30 });

    expect(summary.deleted).toBe(0);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it("uses the inactivity window of `now - inactiveDays` in the query", async () => {
    const now = Date.now();
    vi.mocked(prisma.share.findMany).mockResolvedValue([] as never);

    await cleanupMaxViewsShares({ inactiveDays: 30 });

    const call = vi.mocked(prisma.share.findMany).mock.calls[0][0] as {
      where: { OR: { lastDownloadedAt?: { lt: Date }; updatedAt?: { lt: Date } }[] };
    };
    const cutoff = now - 30 * ONE_DAY_MS;
    expect(call.where.OR[0].lastDownloadedAt?.lt.getTime()).toBe(cutoff);
    expect(call.where.OR[1].updatedAt?.lt.getTime()).toBe(cutoff);
  });
});

// ── cleanupExpiredReverseShares ─────────────────────────────────────────────────

describe("cleanupExpiredReverseShares", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T00:00:00.000Z"));
    vi.mocked(prisma.reverseShare.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.reverseShare.delete).mockResolvedValue({ id: "rs1" } as never);
  });

  it("deletes an expired reverse share with its S3 objects and audits", async () => {
    const now = Date.now();
    const expired = new Date(now - 8 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany)
      .mockResolvedValueOnce([] as never) // warn
      .mockResolvedValueOnce([
        {
          id: "rs1",
          name: "Inbox",
          expiration: expired,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never); // delete
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([{ objectName: "o1" }] as never);

    const summary = await cleanupExpiredReverseShares({ graceDays: 7, notifyDaysBefore: 3 });

    expect(summary.deleted).toBe(1);
    expect(mockDeleteObject).toHaveBeenCalledWith("o1");
    expect(logAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "REVERSE_SHARE_AUTO_DELETED",
        ipAddress: "system",
        targetType: "reverse_share",
        targetId: "rs1",
      }),
    );
    expect(emailService.send).toHaveBeenCalledWith(
      "reverse_share_auto_deleted",
      expect.objectContaining({ to: "u@x.com" }),
    );
  });

  it("tolerates S3 best-effort failure: still deletes and counts the error", async () => {
    const now = Date.now();
    const expired = new Date(now - 8 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([
        {
          id: "rs1",
          name: "Inbox",
          expiration: expired,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en", isActive: true },
        },
      ] as never);
    vi.mocked(prisma.reverseShareFile.findMany).mockResolvedValue([{ objectName: "o1" }] as never);
    mockDeleteObject.mockRejectedValueOnce(new Error("S3 down"));

    const summary = await cleanupExpiredReverseShares({ graceDays: 7, notifyDaysBefore: 3 });

    // Deletion still counts; the failed S3 object is surfaced as an error.
    expect(summary.deleted).toBe(1);
    expect(summary.errors).toBe(1);
    // The reverse share was still removed from the DB.
    expect(prisma.reverseShare.delete).toHaveBeenCalledWith({ where: { id: "rs1" } });
  });

  it("warns once before deletion and sets the flag only when enqueued", async () => {
    const now = Date.now();
    const expiration = new Date(now - 5 * ONE_DAY_MS);
    vi.mocked(prisma.reverseShare.findMany)
      .mockResolvedValueOnce([
        {
          id: "rs1",
          name: "Inbox",
          expiration,
          creatorId: "u1",
          creator: { id: "u1", email: "u@x.com", locale: "en" },
        },
      ] as never) // warn
      .mockResolvedValueOnce([] as never); // delete

    const summary = await cleanupExpiredReverseShares({ graceDays: 7, notifyDaysBefore: 3 });

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
