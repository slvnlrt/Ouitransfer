import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    $transaction: vi.fn(),
    user: {
      findMany: vi.fn(),
    },
    file: {
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    folder: {
      deleteMany: vi.fn(),
    },
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
  cleanupDeactivatedAccounts,
  cleanupExpiredReverseShares,
  cleanupExpiredShares,
  cleanupMaxViewsShares,
  deleteReverseShareWithStorage,
  deleteShareLink,
  purgeUserContent,
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
