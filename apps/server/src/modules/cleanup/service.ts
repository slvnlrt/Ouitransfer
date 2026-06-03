import { S3StorageProvider } from "../../providers/s3-storage.provider.js";
import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { t } from "../email/i18n/loader.js";
import { emailService } from "../email/service.js";
import { buildReverseShareManageUrl, buildShareManageUrl } from "../email/url-builder.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * Sentinel `ipAddress` for audit events emitted by the scheduler rather than a
 * request. Mirrors `AUDIT_RETENTION_CLEANUP` (audit/retention.scheduler.ts).
 */
const SYSTEM_IP = "system";

const UNNAMED_SHARE = "Unnamed share";
const UNNAMED_REVERSE_SHARE = "Unnamed reverse share";

/**
 * Storage provider instance, mirroring `FileService` (file/service.ts) which
 * instantiates `S3StorageProvider` directly. The provider is effectively a
 * stateless client wrapper around the shared S3 client, so a module-level
 * instance is safe and avoids passing it through every call.
 */
const storageProvider = new S3StorageProvider();

// ─── Summary type ─────────────────────────────────────────────────────────────

/** Per-batch outcome returned by every cleanup function for scheduler logging. */
export interface CleanupSummary {
  warned: number;
  deleted: number;
  errors: number;
}

function emptySummary(): CleanupSummary {
  return { warned: 0, deleted: 0, errors: 0 };
}

/**
 * Resolve a localized, human-readable deletion reason for the
 * `share_auto_deleted` notification, using the recipient's locale. Keeping the
 * reason localized (rather than a raw English word interpolated into the
 * already-localized template) avoids a mixed-language email body.
 */
async function resolveReason(
  locale: string,
  kind: "expired" | "viewLimitReached" | "accountDeactivated",
): Promise<string> {
  return t(locale, `cleanupReason.${kind}`);
}

// ─── Deletion helpers ─────────────────────────────────────────────────────────

/**
 * Permanently delete a regular share **link** and everything that exists only
 * to support that link: its `ShareSecurity` row, recipients, visits, and alias.
 *
 * Crucially this NEVER touches the owner's `File`/`Folder` rows or their S3
 * objects — a file lives in the user's file manager and may be referenced by
 * other shares. See the "Data-model clarification" in the 5.2 spec.
 *
 * `ShareRecipient`, `ShareVisit`, and `ShareAlias` all cascade from `Share`
 * (`onDelete: Cascade`). `ShareSecurity`, however, is referenced by `Share`
 * via the `securityId` FK — deleting the share does NOT cascade to it — so the
 * security row is deleted explicitly afterwards to avoid leaving an orphan.
 * The whole operation runs in a transaction so no orphan can survive.
 */
export async function deleteShareLink(shareId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Detach many-to-many file/folder links first so deleting the share never
    // touches the join rows in a way that could cascade to the files themselves.
    await tx.share.update({
      where: { id: shareId },
      data: { files: { set: [] }, folders: { set: [] } },
    });

    const deleted = await tx.share.delete({
      where: { id: shareId },
      include: { security: true },
    });

    // The Share→ShareSecurity FK does not cascade on delete; remove the now
    // unreferenced security row explicitly.
    if (deleted.security) {
      await tx.shareSecurity.delete({ where: { id: deleted.security.id } });
    }
  });
}

/**
 * Permanently delete a reverse share, its `ReverseShareFile` rows (DB cascade),
 * and their underlying S3 objects.
 *
 * Ordering is DB-before-S3: the rows are removed first, then each S3 object is
 * deleted best-effort. A failure deleting one object is logged and does not
 * abort the others — the DB is already consistent, leaving at most an orphaned
 * S3 object which the orphan sweep (A9) will reclaim later.
 *
 * Returns the number of S3 objects that failed to delete.
 */
export async function deleteReverseShareWithStorage(reverseShareId: string): Promise<number> {
  const files = await prisma.reverseShareFile.findMany({
    where: { reverseShareId },
    select: { objectName: true },
  });

  // DB first — cascade removes the ReverseShareFile rows.
  await prisma.reverseShare.delete({ where: { id: reverseShareId } });

  let s3Errors = 0;
  for (const file of files) {
    try {
      await storageProvider.deleteObject(file.objectName);
    } catch (err) {
      s3Errors++;
      getLogger().error(
        { err, reverseShareId, objectName: file.objectName },
        "Failed to delete reverse-share S3 object during cleanup",
      );
    }
  }
  return s3Errors;
}

// ─── Expired shares (A2 + A5 warning) ──────────────────────────────────────────

/**
 * Clean up expired regular shares.
 *
 * - **Warn**: for shares whose deletion moment (`expiration + graceDays`) is
 *   within `notifyDaysBefore` and that have not yet been warned, send a
 *   `share_pending_deletion` email and set `notifiedForPendingDeletion` — but
 *   only when the email was actually enqueued, so a no-op send (SMTP disabled,
 *   preference off) leaves the flag clear for a later retry.
 * - **Delete**: for shares past `expiration + graceDays`, delete the share link
 *   (link only — never the owner's files), audit `SHARE_AUTO_DELETED`, and
 *   notify the creator with `share_auto_deleted` (reason "expired").
 *
 * Each item is wrapped so a single failure increments `errors` without aborting
 * the batch.
 */
export async function cleanupExpiredShares(opts: {
  graceDays: number;
  notifyDaysBefore: number;
}): Promise<CleanupSummary> {
  const { graceDays, notifyDaysBefore } = opts;
  const summary = emptySummary();
  const now = new Date();
  const graceMs = graceDays * ONE_DAY_MS;
  const log = getLogger();

  // ── Warn phase ──
  // Deletion moment = expiration + grace. We warn when that moment is within
  // notifyDaysBefore of now (and not yet reached), i.e.
  //   expiration ∈ (now - grace, now - grace + notifyDaysBefore]
  if (notifyDaysBefore > 0) {
    const warnLowerExpiration = new Date(now.getTime() - graceMs);
    const warnUpperExpiration = new Date(now.getTime() - graceMs + notifyDaysBefore * ONE_DAY_MS);

    const toWarn = await prisma.share.findMany({
      where: {
        expiration: { not: null, gt: warnLowerExpiration, lte: warnUpperExpiration },
        notifiedForPendingDeletion: false,
        creatorId: { not: null },
        creator: { isActive: true },
      },
      include: { creator: { select: { id: true, email: true, locale: true } } },
    });

    for (const share of toWarn) {
      if (!share.creator || !share.creatorId || !share.expiration) continue;
      try {
        const deletionAt = new Date(share.expiration.getTime() + graceMs);
        const shareManageUrl = await buildShareManageUrl(share.id);
        const result = await emailService.send("share_pending_deletion", {
          to: share.creator.email,
          locale: share.creator.locale ?? "en",
          userId: share.creatorId,
          relatedId: share.id,
          data: {
            shareName: share.name ?? UNNAMED_SHARE,
            deletionAt: deletionAt.toISOString(),
            shareManageUrl,
          },
        });
        if (result.enqueued) {
          await prisma.share.update({
            where: { id: share.id },
            data: { notifiedForPendingDeletion: true },
          });
          summary.warned++;
        }
      } catch (err) {
        summary.errors++;
        log.error({ err, shareId: share.id }, "Failed to warn for pending share deletion");
      }
    }
  }

  // ── Delete phase ──
  const deleteBefore = new Date(now.getTime() - graceMs);
  const toDelete = await prisma.share.findMany({
    where: { expiration: { not: null, lt: deleteBefore } },
    include: { creator: { select: { id: true, email: true, locale: true, isActive: true } } },
  });

  for (const share of toDelete) {
    try {
      const shareName = share.name ?? UNNAMED_SHARE;
      await deleteShareLink(share.id);
      summary.deleted++;

      await logAuditEvent({
        userId: share.creatorId ?? undefined,
        action: "SHARE_AUTO_DELETED",
        ipAddress: SYSTEM_IP,
        targetType: "share",
        targetId: share.id,
        metadata: { shareName, reason: "expired" },
      });

      // Notify the creator (only if still active — a deactivated owner's shares
      // are already blocked; notifying them is noise).
      if (share.creator && share.creatorId && share.creator.isActive) {
        const locale = share.creator.locale ?? "en";
        await emailService.send("share_auto_deleted", {
          to: share.creator.email,
          locale,
          userId: share.creatorId,
          relatedId: share.id,
          data: { shareName, reason: await resolveReason(locale, "expired") },
        });
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, shareId: share.id }, "Failed to clean up expired share");
    }
  }

  return summary;
}

// ─── Max-views shares (A4) ─────────────────────────────────────────────────────

/**
 * Clean up shares that have reached their `maxViews` cap and have seen no
 * further activity for `inactiveDays`.
 *
 * A share qualifies when `maxViews != null && views >= maxViews` and its last
 * activity (`lastDownloadedAt`, falling back to `updatedAt`) is older than
 * `inactiveDays`. Mirrors {@link cleanupExpiredShares}:
 *
 * - **Warn**: for maxViews-reached shares whose deletion moment
 *   (`(lastDownloadedAt ?? updatedAt) + inactiveDays`) is within
 *   `notifyDaysBefore` and that have not yet been warned, send a
 *   `share_pending_deletion` email and set `notifiedForPendingDeletion` — but
 *   only when the email was actually enqueued (spec A5: warn before A2–A4).
 * - **Delete**: deletes the share link (link only), audits, and notifies the
 *   creator with `share_auto_deleted` (reason "view limit reached").
 */
export async function cleanupMaxViewsShares(opts: {
  inactiveDays: number;
  notifyDaysBefore: number;
}): Promise<CleanupSummary> {
  const { inactiveDays, notifyDaysBefore } = opts;
  const summary = emptySummary();
  const now = new Date();
  const inactiveMs = inactiveDays * ONE_DAY_MS;
  const inactiveBefore = new Date(now.getTime() - inactiveMs);
  const log = getLogger();

  // The "last activity" anchor used for both the warn window and deletion is
  // `lastDownloadedAt ?? updatedAt`. Deletion moment = anchor + inactiveDays.
  const lastActivity = (share: { lastDownloadedAt: Date | null; updatedAt: Date }): Date =>
    share.lastDownloadedAt ?? share.updatedAt;

  // ── Warn phase ──
  // We warn when the deletion moment is within notifyDaysBefore of now (and not
  // yet reached), i.e. anchor ∈ (now - inactive, now - inactive + notifyDaysBefore].
  if (notifyDaysBefore > 0) {
    const warnLower = new Date(now.getTime() - inactiveMs);
    const warnUpper = new Date(now.getTime() - inactiveMs + notifyDaysBefore * ONE_DAY_MS);

    // `views >= maxViews` is a field-to-field comparison Prisma cannot express,
    // so filter `maxViews != null` in SQL and apply it in JS below.
    const warnCandidates = await prisma.share.findMany({
      where: {
        maxViews: { not: null },
        notifiedForPendingDeletion: false,
        creatorId: { not: null },
        creator: { isActive: true },
        OR: [
          { lastDownloadedAt: { not: null, gt: warnLower, lte: warnUpper } },
          { lastDownloadedAt: null, updatedAt: { gt: warnLower, lte: warnUpper } },
        ],
      },
      include: { creator: { select: { id: true, email: true, locale: true } } },
    });

    for (const share of warnCandidates) {
      if (share.maxViews === null || share.views < share.maxViews) continue;
      if (!share.creator || !share.creatorId) continue;
      try {
        const deletionAt = new Date(lastActivity(share).getTime() + inactiveMs);
        const shareManageUrl = await buildShareManageUrl(share.id);
        const result = await emailService.send("share_pending_deletion", {
          to: share.creator.email,
          locale: share.creator.locale ?? "en",
          userId: share.creatorId,
          relatedId: share.id,
          data: {
            shareName: share.name ?? UNNAMED_SHARE,
            deletionAt: deletionAt.toISOString(),
            shareManageUrl,
          },
        });
        if (result.enqueued) {
          await prisma.share.update({
            where: { id: share.id },
            data: { notifiedForPendingDeletion: true },
          });
          summary.warned++;
        }
      } catch (err) {
        summary.errors++;
        log.error(
          { err, shareId: share.id },
          "Failed to warn for pending max-views share deletion",
        );
      }
    }
  }

  // ── Delete phase ──
  // `views >= maxViews` cannot be expressed directly in a Prisma `where`
  // (field-to-field comparison), so filter `maxViews != null` in SQL and apply
  // the comparison in JS.
  const candidates = await prisma.share.findMany({
    where: {
      maxViews: { not: null },
      OR: [
        { lastDownloadedAt: { not: null, lt: inactiveBefore } },
        { lastDownloadedAt: null, updatedAt: { lt: inactiveBefore } },
      ],
    },
    include: { creator: { select: { id: true, email: true, locale: true, isActive: true } } },
  });

  for (const share of candidates) {
    if (share.maxViews === null || share.views < share.maxViews) continue;

    try {
      const shareName = share.name ?? UNNAMED_SHARE;
      await deleteShareLink(share.id);
      summary.deleted++;

      await logAuditEvent({
        userId: share.creatorId ?? undefined,
        action: "SHARE_AUTO_DELETED",
        ipAddress: SYSTEM_IP,
        targetType: "share",
        targetId: share.id,
        metadata: { shareName, reason: "view limit reached" },
      });

      if (share.creator && share.creatorId && share.creator.isActive) {
        const locale = share.creator.locale ?? "en";
        await emailService.send("share_auto_deleted", {
          to: share.creator.email,
          locale,
          userId: share.creatorId,
          relatedId: share.id,
          data: { shareName, reason: await resolveReason(locale, "viewLimitReached") },
        });
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, shareId: share.id }, "Failed to clean up max-views share");
    }
  }

  return summary;
}

// ─── Expired reverse shares (A3 + A5 warning) ──────────────────────────────────

/**
 * Clean up expired reverse shares. Mirrors {@link cleanupExpiredShares} but the
 * deletion path frees storage: it removes the `ReverseShareFile` rows (DB
 * cascade) and their S3 objects via {@link deleteReverseShareWithStorage}.
 *
 * - **Warn** with `reverse_share_pending_deletion`.
 * - **Delete** then audit `REVERSE_SHARE_AUTO_DELETED` and notify the creator
 *   with `reverse_share_auto_deleted`.
 */
export async function cleanupExpiredReverseShares(opts: {
  graceDays: number;
  notifyDaysBefore: number;
}): Promise<CleanupSummary> {
  const { graceDays, notifyDaysBefore } = opts;
  const summary = emptySummary();
  const now = new Date();
  const graceMs = graceDays * ONE_DAY_MS;
  const log = getLogger();

  // ── Warn phase ──
  if (notifyDaysBefore > 0) {
    const warnLowerExpiration = new Date(now.getTime() - graceMs);
    const warnUpperExpiration = new Date(now.getTime() - graceMs + notifyDaysBefore * ONE_DAY_MS);

    const toWarn = await prisma.reverseShare.findMany({
      where: {
        expiration: { not: null, gt: warnLowerExpiration, lte: warnUpperExpiration },
        notifiedForPendingDeletion: false,
        creator: { isActive: true },
      },
      include: { creator: { select: { id: true, email: true, locale: true } } },
    });

    for (const rs of toWarn) {
      if (!rs.expiration) continue;
      try {
        const deletionAt = new Date(rs.expiration.getTime() + graceMs);
        const reverseShareManageUrl = await buildReverseShareManageUrl(rs.id);
        const result = await emailService.send("reverse_share_pending_deletion", {
          to: rs.creator.email,
          locale: rs.creator.locale ?? "en",
          userId: rs.creatorId,
          relatedId: rs.id,
          data: {
            reverseShareName: rs.name ?? UNNAMED_REVERSE_SHARE,
            deletionAt: deletionAt.toISOString(),
            reverseShareManageUrl,
          },
        });
        if (result.enqueued) {
          await prisma.reverseShare.update({
            where: { id: rs.id },
            data: { notifiedForPendingDeletion: true },
          });
          summary.warned++;
        }
      } catch (err) {
        summary.errors++;
        log.error(
          { err, reverseShareId: rs.id },
          "Failed to warn for pending reverse-share deletion",
        );
      }
    }
  }

  // ── Delete phase ──
  const deleteBefore = new Date(now.getTime() - graceMs);
  const toDelete = await prisma.reverseShare.findMany({
    where: { expiration: { not: null, lt: deleteBefore } },
    include: { creator: { select: { id: true, email: true, locale: true, isActive: true } } },
  });

  for (const rs of toDelete) {
    try {
      const reverseShareName = rs.name ?? UNNAMED_REVERSE_SHARE;
      const s3Errors = await deleteReverseShareWithStorage(rs.id);
      // Failing S3 objects do not block deletion (orphan sweep reclaims them),
      // but they are surfaced in the summary for observability.
      summary.errors += s3Errors;
      summary.deleted++;

      await logAuditEvent({
        userId: rs.creatorId,
        action: "REVERSE_SHARE_AUTO_DELETED",
        ipAddress: SYSTEM_IP,
        targetType: "reverse_share",
        targetId: rs.id,
        metadata: { reverseShareName, reason: "expired", s3Errors },
      });

      if (rs.creator.isActive) {
        await emailService.send("reverse_share_auto_deleted", {
          to: rs.creator.email,
          locale: rs.creator.locale ?? "en",
          userId: rs.creatorId,
          relatedId: rs.id,
          data: {
            reverseShareName,
            deletedAt: now.toISOString(),
          },
        });
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, reverseShareId: rs.id }, "Failed to clean up expired reverse share");
    }
  }

  return summary;
}

// ─── Account content purge (A7 + A8 shared helper) ─────────────────────────────

/** Per-user purge outcome: row counts removed plus best-effort S3 failures. */
export interface PurgeUserContentResult {
  files: number;
  shares: number;
  reverseShares: number;
  folders: number;
  s3Errors: number;
}

/**
 * Remove **all** content owned by a user: their regular shares (link only),
 * reverse shares (+ their files and S3 objects), and their file-manager
 * `File`/`Folder` rows together with the files' S3 objects.
 *
 * This is the shared engine behind both the full account-deletion cascade (A8,
 * which deletes the user row afterwards) and the delayed deactivated-account
 * cleanup (A7, which keeps the user row). It does **not** touch the `User` row,
 * so it is safe to call whether or not the caller later deletes that row.
 *
 * Deletion order (DB-before-S3 throughout):
 *  1. Collect the user's `File.objectName`s (before any deletion).
 *  2. Delete each of the user's shares via {@link deleteShareLink} — this is
 *     essential because `Share.creatorId` is `onDelete: SetNull`, so a later
 *     `user.delete()` would otherwise *orphan* the shares rather than remove
 *     them. Doing it here guarantees nothing dangles.
 *  3. Delete each reverse share via {@link deleteReverseShareWithStorage}, which
 *     removes the `ReverseShareFile` rows (DB cascade) and best-effort deletes
 *     their S3 objects.
 *  4. Delete the user's `File` and `Folder` rows.
 *  5. Best-effort delete the collected `File` and `Folder` S3 objects. One
 *     failure is logged and counted but never aborts the rest — at most an
 *     orphaned S3 object remains, which the orphan sweep (A9) reclaims later.
 */
export async function purgeUserContent(userId: string): Promise<PurgeUserContentResult> {
  const log = getLogger();
  const result: PurgeUserContentResult = {
    files: 0,
    shares: 0,
    reverseShares: 0,
    folders: 0,
    s3Errors: 0,
  };

  // 1. Snapshot the user's File and Folder object names before deleting rows.
  //    Both are real S3 keys (File.objectName, Folder.objectName).
  const [files, folders] = await Promise.all([
    prisma.file.findMany({ where: { userId }, select: { objectName: true } }),
    prisma.folder.findMany({
      where: { userId },
      select: { objectName: true },
    }),
  ]);

  // 2. Delete the user's shares (link only). Done explicitly so the SetNull FK
  //    never orphans them when the user row is later removed.
  const shares = await prisma.share.findMany({
    where: { creatorId: userId },
    select: { id: true },
  });
  for (const share of shares) {
    await deleteShareLink(share.id);
    result.shares++;
  }

  // 3. Delete the user's reverse shares (DB rows + their S3 objects).
  const reverseShares = await prisma.reverseShare.findMany({
    where: { creatorId: userId },
    select: { id: true },
  });
  for (const rs of reverseShares) {
    result.s3Errors += await deleteReverseShareWithStorage(rs.id);
    result.reverseShares++;
  }

  // 4. Delete the user's file-manager rows (DB first).
  const deletedFiles = await prisma.file.deleteMany({ where: { userId } });
  result.files = deletedFiles.count;
  const deletedFolders = await prisma.folder.deleteMany({ where: { userId } });
  result.folders = deletedFolders.count;

  // 5. Best-effort delete the File and Folder S3 objects (DB-before-S3).
  for (const file of files) {
    try {
      await storageProvider.deleteObject(file.objectName);
    } catch (err) {
      result.s3Errors++;
      log.error(
        { err, userId, objectName: file.objectName },
        "Failed to delete user File S3 object during purge",
      );
    }
  }
  for (const folder of folders) {
    if (!folder.objectName) continue;
    try {
      await storageProvider.deleteObject(folder.objectName);
    } catch (err) {
      result.s3Errors++;
      log.error(
        { err, userId, objectName: folder.objectName },
        "Failed to delete user Folder S3 object during purge",
      );
    }
  }

  return result;
}

// ─── Deactivated-account cleanup (A7) ──────────────────────────────────────────

/** Outcome of the deactivated-account cleanup pass. */
export interface DeactivatedAccountsCleanupSummary {
  purgedAccounts: number;
  errors: number;
}

/**
 * Delete the content of accounts that have stayed deactivated for at least
 * `days` days, **keeping the user row** (the account can still be reactivated;
 * only its stored content is reclaimed).
 *
 * Selects users with `isActive === false && deactivatedAt != null` whose
 * `deactivatedAt` is older than `now - days`. For each, {@link purgeUserContent}
 * removes their shares / reverse shares / files (+ S3), then a `files_auto_deleted`
 * notification is sent and an `ACCOUNT_FILES_CLEANED` audit event is logged.
 *
 * This function does **not** check the `accountDeactivationCleanupEnabled` flag —
 * that opt-in gate is enforced by the scheduler (Batch 6) before this is called.
 * Each account is isolated: one failure increments `errors` without aborting the
 * batch.
 */
export async function cleanupDeactivatedAccounts(opts: {
  days: number;
}): Promise<DeactivatedAccountsCleanupSummary> {
  const { days } = opts;
  const summary: DeactivatedAccountsCleanupSummary = { purgedAccounts: 0, errors: 0 };
  const log = getLogger();
  const cutoff = new Date(Date.now() - days * ONE_DAY_MS);

  const accounts = await prisma.user.findMany({
    where: {
      isActive: false,
      deactivatedAt: { not: null, lt: cutoff },
    },
    select: { id: true, email: true, locale: true },
  });

  for (const account of accounts) {
    try {
      const counts = await purgeUserContent(account.id);
      summary.purgedAccounts++;

      const locale = account.locale ?? "en";
      await emailService.send("files_auto_deleted", {
        to: account.email,
        locale,
        userId: account.id,
        data: {
          fileNames: [],
          reason: await resolveReason(locale, "accountDeactivated"),
        },
      });

      await logAuditEvent({
        userId: account.id,
        action: "ACCOUNT_FILES_CLEANED",
        ipAddress: SYSTEM_IP,
        targetType: "user",
        targetId: account.id,
        metadata: {
          files: counts.files,
          shares: counts.shares,
          reverseShares: counts.reverseShares,
          folders: counts.folders,
          s3Errors: counts.s3Errors,
          reason: "account deactivated",
        },
      });
    } catch (err) {
      summary.errors++;
      log.error({ err, userId: account.id }, "Failed to clean up deactivated account content");
    }
  }

  return summary;
}

// ─── Orphan sweep (A9) ──────────────────────────────────────────────────────────

/** Outcome of a bidirectional orphan sweep. */
export interface OrphanSweepSummary {
  /** DB rows removed because their S3 object was missing (count actually deleted, or candidate count in a dry run). */
  dbDeleted: number;
  /** S3 objects removed because no DB row references them (count actually deleted, or candidate count in a dry run). */
  s3Deleted: number;
  /** Per-item failures (DB or S3); one failure never aborts the sweep. */
  errors: number;
  /**
   * Dry-run only: the identifiers of the DB rows that *would* be deleted
   * (their S3 object is missing). One entry per candidate row.
   */
  dbCandidates?: Array<{ table: "file" | "reverse_share_file"; id: string; objectName: string }>;
  /**
   * Dry-run only: the S3 object keys that *would* be deleted (no referencing
   * DB row, older than the cutoff).
   */
  s3Candidates?: string[];
}

/**
 * Reconcile S3 and the database in both directions, deleting orphans on each
 * side. The two S3-object-owning tables are `File` (file-manager files) and
 * `ReverseShareFile` (uploads to reverse shares).
 *
 * A **min-age guard** (`minAgeHours`) protects in-flight uploads in both
 * directions: only rows/objects older than `now - minAgeHours` are considered,
 * so a file whose DB row exists but whose S3 object has not yet been finalized
 * (or vice-versa) during an active upload is never mistaken for an orphan.
 *
 * **DB → S3**: for each `File`/`ReverseShareFile` row created before the cutoff
 * whose object is missing in S3 (`fileExists` → false), the DB row is deleted
 * and an `ORPHAN_DB_DELETED` audit event is logged.
 *
 * **S3 → DB**: every object in the bucket is listed once; an in-memory set of
 * all known `objectName`s is built from **every** S3-key-bearing table. Any
 * object older than the cutoff whose key is **not** in that set is deleted and
 * an `ORPHAN_S3_DELETED` audit event is logged. Building the known-keys set
 * from the DB up front guarantees an object referenced by *any* row — in any of
 * those tables — is never deleted (correctness-critical).
 *
 * **Known-keys registry (S3-owning tables).** `listObjects()` enumerates the
 * **whole** bucket with no prefix, so the known-keys union MUST include every
 * table that stores an S3 object key, or those objects will be wrongly swept as
 * orphans. The complete registry is:
 *   - `File.objectName`            (file-manager files, `<userId>/...`)
 *   - `ReverseShareFile.objectName`(reverse-share uploads, `reverse-shares/...`)
 *   - `Folder.objectName`          (folder placeholder objects)
 *   - `BackgroundImage.s3Key`      (`backgrounds/<id>.webp`)
 *   - `BackgroundImage.thumbnailS3Key` (`backgrounds/<id>_thumb.webp`)
 * Any future table that persists an S3 key MUST be added here.
 *
 * Scale note (Phase A): the known-keys set is held entirely in memory. For the
 * self-hosted, single-tenant target this is more than sufficient; a future
 * very-large-bucket optimization could stream keys or query the DB per object,
 * but that is explicitly out of scope here.
 *
 * Every deletion is wrapped so a single failure increments `errors` without
 * aborting the sweep.
 *
 * When `dryRun` is true nothing is deleted and no audit events are emitted: the
 * summary's `dbDeleted`/`s3Deleted` report the candidate counts and
 * `dbCandidates`/`s3Candidates` list the identifiers that *would* be removed.
 *
 * This function does **not** check `autoCleanupOrphansEnabled` — that opt-in
 * gate is enforced by the scheduler (Batch 6), which also supplies
 * `minAgeHours` from `autoCleanupOrphanMinAgeHours`.
 */
export async function sweepOrphans(opts: {
  minAgeHours: number;
  dryRun?: boolean;
}): Promise<OrphanSweepSummary> {
  const { minAgeHours, dryRun = false } = opts;
  const summary: OrphanSweepSummary = { dbDeleted: 0, s3Deleted: 0, errors: 0 };
  const log = getLogger();
  const cutoff = new Date(Date.now() - minAgeHours * ONE_HOUR_MS);

  const dbCandidates: NonNullable<OrphanSweepSummary["dbCandidates"]> = [];
  const s3Candidates: string[] = [];

  // ── DB → S3: rows whose S3 object is missing ──
  const files = await prisma.file.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, objectName: true },
  });
  for (const file of files) {
    try {
      if (await storageProvider.fileExists(file.objectName)) continue;
      if (dryRun) {
        dbCandidates.push({ table: "file", id: file.id, objectName: file.objectName });
        summary.dbDeleted++;
        continue;
      }
      await prisma.file.delete({ where: { id: file.id } });
      summary.dbDeleted++;
      await logAuditEvent({
        action: "ORPHAN_DB_DELETED",
        ipAddress: SYSTEM_IP,
        targetType: "file",
        targetId: file.id,
        metadata: { objectName: file.objectName },
      });
    } catch (err) {
      summary.errors++;
      log.error(
        { err, fileId: file.id, objectName: file.objectName },
        "Failed to sweep orphan File DB row",
      );
    }
  }

  const reverseShareFiles = await prisma.reverseShareFile.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, objectName: true, reverseShareId: true },
  });
  for (const rsFile of reverseShareFiles) {
    try {
      if (await storageProvider.fileExists(rsFile.objectName)) continue;
      if (dryRun) {
        dbCandidates.push({
          table: "reverse_share_file",
          id: rsFile.id,
          objectName: rsFile.objectName,
        });
        summary.dbDeleted++;
        continue;
      }
      await prisma.reverseShareFile.delete({ where: { id: rsFile.id } });
      summary.dbDeleted++;
      await logAuditEvent({
        action: "ORPHAN_DB_DELETED",
        ipAddress: SYSTEM_IP,
        // No `reverse_share_file` audit target type exists; point at the parent
        // reverse share (which resolves) and keep the file id + key in metadata.
        targetType: "reverse_share",
        targetId: rsFile.reverseShareId,
        metadata: { fileId: rsFile.id, objectName: rsFile.objectName },
      });
    } catch (err) {
      summary.errors++;
      log.error(
        { err, reverseShareFileId: rsFile.id, objectName: rsFile.objectName },
        "Failed to sweep orphan ReverseShareFile DB row",
      );
    }
  }

  // ── S3 → DB: objects with no referencing row ──
  // Build the union of every known object key from EVERY S3-key-bearing table
  // first (see the registry in the doc comment above), so an object referenced
  // by any row is never deleted. The DB rows are re-read here (rather than
  // reusing the lists above) because the DB→S3 phase may have removed some, and
  // so that rows created after the cutoff — which we did not sweep — still
  // protect their objects.
  const [allFiles, allReverseShareFiles, allFolders, allBackgrounds] = await Promise.all([
    prisma.file.findMany({ select: { objectName: true } }),
    prisma.reverseShareFile.findMany({ select: { objectName: true } }),
    prisma.folder.findMany({ select: { objectName: true } }),
    prisma.backgroundImage.findMany({ select: { s3Key: true, thumbnailS3Key: true } }),
  ]);
  const knownKeys = new Set<string>();
  for (const f of allFiles) knownKeys.add(f.objectName);
  for (const f of allReverseShareFiles) knownKeys.add(f.objectName);
  for (const folder of allFolders) {
    if (folder.objectName) knownKeys.add(folder.objectName);
  }
  for (const bg of allBackgrounds) {
    if (bg.s3Key) knownKeys.add(bg.s3Key);
    if (bg.thumbnailS3Key) knownKeys.add(bg.thumbnailS3Key);
  }

  const objects = await storageProvider.listObjects();
  for (const object of objects) {
    if (object.lastModified >= cutoff) continue;
    if (knownKeys.has(object.key)) continue;
    try {
      if (dryRun) {
        s3Candidates.push(object.key);
        summary.s3Deleted++;
        continue;
      }
      await storageProvider.deleteObject(object.key);
      summary.s3Deleted++;
      await logAuditEvent({
        action: "ORPHAN_S3_DELETED",
        ipAddress: SYSTEM_IP,
        metadata: { key: object.key },
      });
    } catch (err) {
      summary.errors++;
      log.error({ err, key: object.key }, "Failed to sweep orphan S3 object");
    }
  }

  if (dryRun) {
    summary.dbCandidates = dbCandidates;
    summary.s3Candidates = s3Candidates;
  }

  return summary;
}
