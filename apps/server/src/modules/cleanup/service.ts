import { S3StorageProvider } from "../../providers/s3-storage.provider.js";
import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { t } from "../email/i18n/loader.js";
import { emailService } from "../email/service.js";
import { buildReverseShareManageUrl, buildShareManageUrl } from "../email/url-builder.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

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
 * `inactiveDays`. Deletes the share link (link only), audits, and notifies the
 * creator with `share_auto_deleted` (reason "view limit reached").
 */
export async function cleanupMaxViewsShares(opts: {
  inactiveDays: number;
}): Promise<CleanupSummary> {
  const { inactiveDays } = opts;
  const summary = emptySummary();
  const now = new Date();
  const inactiveBefore = new Date(now.getTime() - inactiveDays * ONE_DAY_MS);
  const log = getLogger();

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
 *  5. Best-effort delete the collected `File` S3 objects. One failure is logged
 *     and counted but never aborts the rest — at most an orphaned S3 object
 *     remains, which the orphan sweep (A9) reclaims later.
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

  // 1. Snapshot the user's File object names before deleting the rows.
  const files = await prisma.file.findMany({
    where: { userId },
    select: { objectName: true },
  });

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

  // 5. Best-effort delete the File S3 objects (DB-before-S3).
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
