import { S3StorageProvider } from "../../providers/s3-storage.provider.js";
import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { t } from "../email/i18n/loader.js";
import { emailService } from "../email/service.js";
import { buildReverseShareManageUrl, buildShareManageUrl } from "../email/url-builder.js";
import type { DeletionCandidateFile } from "../quota/repository.js";
import { quotaService } from "../quota/service.js";
import { ReverseShareRepository } from "../reverse-share/repository.js";
import { AUTO_DELETABLE_REASONS, deactivationFields } from "../share/lifecycle.js";

// Stateless wrapper around prisma — reused so the deactivation sweep persists the
// expired transition through the exact same write as the read-time path.
const reverseShareRepository = new ReverseShareRepository();

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

/** Outcome of a phase-2 deletion sweep (share or reverse share). */
export interface CleanupSummary {
  warned: number;
  deleted: number;
  errors: number;
}

function emptySummary(): CleanupSummary {
  return { warned: 0, deleted: 0, errors: 0 };
}

/** Outcome of a phase-1 deactivation sweep (share or reverse share). */
export interface DeactivationSummary {
  deactivated: number;
  errors: number;
}

function emptyDeactivationSummary(): DeactivationSummary {
  return { deactivated: 0, errors: 0 };
}

/**
 * Resolve a localized, human-readable deletion reason for the
 * `share_auto_deleted` notification, using the recipient's locale. Keeping the
 * reason localized (rather than a raw English word interpolated into the
 * already-localized template) avoids a mixed-language email body.
 */
async function resolveReason(
  locale: string,
  kind: "expired" | "viewLimitReached" | "accountDeactivated" | "quotaExceeded",
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

// ─── Phase 1: deactivate ended shares (expired / maxViews) ─────────────────────

/**
 * Deactivation sweep for regular shares (Phase A.1, phase 1).
 *
 * Persists the `active → deactivated` transition for shares whose lifecycle has
 * ended but which the read path never observed (a share that is never accessed
 * again after expiring, or whose maxViews was reached without a final read that
 * could have persisted it). This is the backstop that guarantees every ended
 * share eventually becomes `isActive=false` with a `deactivationReason`, so the
 * deletion sweep can later act on it.
 *
 * Three cases, all idempotent / race-safe via compare-and-set on `isActive`
 * (and on the reason for the upgrade case):
 *
 *  1. **Active + expired** (`isActive=true AND expiration < now`) →
 *     `deactivationFields("expired", expiration)`. `deactivatedAt` is stamped at
 *     the expiration instant so the deletion grace is measured from the real end,
 *     identical to the read-time {@link markExpiredInactive} shape.
 *  2. **Active + maxViews reached** (`isActive=true AND maxViews != null AND
 *     views >= maxViews`) → `deactivationFields("max_views")` (`deactivatedAt =
 *     now`, since the limit was hit "now" from the sweep's point of view; the
 *     read path stamps it precisely when it can). Expired-and-maxed shares are
 *     handled by case 1 first (expired takes precedence — `deactivatedAt` =
 *     expiration is the earlier, correct anchor).
 *  3. **Manual pause that has since expired** (`isActive=false AND reason="manual"
 *     AND expiration < now`) → upgrade the reason to `expired` and reset
 *     `deactivatedAt` to the expiration instant, moving the share into the
 *     auto-deletable set. (A manual pause is otherwise never auto-deleted.)
 *
 * The deactivation notice (`share_expired` / `share_max_views_reached`) is sent
 * once, guarded by the existing `notifiedForExpired` / `notifiedForMaxViews`
 * flags (compare-and-set, flag flipped only when the email is actually enqueued),
 * and a `SHARE_DEACTIVATED` audit event records the reason. Each share is wrapped
 * so a single failure increments `errors` without aborting the batch.
 */
export async function deactivateEndedShares(): Promise<DeactivationSummary> {
  const summary = emptyDeactivationSummary();
  const now = new Date();
  const log = getLogger();

  // ── Case 1: active + expired ──
  const expiredActive = await prisma.share.findMany({
    where: { isActive: true, expiration: { not: null, lt: now } },
    include: { creator: { select: { id: true, email: true, locale: true, isActive: true } } },
  });
  for (const share of expiredActive) {
    if (!share.expiration) continue;
    try {
      const updated = await prisma.share.updateMany({
        where: { id: share.id, isActive: true },
        data: deactivationFields("expired", share.expiration),
      });
      if (updated.count === 0) continue; // Already deactivated by a racing path.
      summary.deactivated++;

      await logAuditEvent({
        userId: share.creatorId ?? undefined,
        action: "SHARE_DEACTIVATED",
        ipAddress: SYSTEM_IP,
        targetType: "share",
        targetId: share.id,
        metadata: { shareName: share.name ?? UNNAMED_SHARE, reason: "expired" },
      });

      if (!share.notifiedForExpired) {
        await sendShareDeactivationNotice(share, "expired", share.expiration);
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, shareId: share.id }, "Failed to deactivate expired share");
    }
  }

  // ── Case 2: active + maxViews reached ──
  // `views >= maxViews` is a field-to-field comparison Prisma cannot express, so
  // filter `maxViews != null` (and not already expired-handled) in SQL and apply
  // the comparison in JS.
  const maxViewsCandidates = await prisma.share.findMany({
    where: {
      isActive: true,
      maxViews: { not: null },
      OR: [{ expiration: null }, { expiration: { gte: now } }],
    },
    include: { creator: { select: { id: true, email: true, locale: true, isActive: true } } },
  });
  for (const share of maxViewsCandidates) {
    if (share.maxViews === null || share.views < share.maxViews) continue;
    try {
      const updated = await prisma.share.updateMany({
        where: { id: share.id, isActive: true },
        data: deactivationFields("max_views"),
      });
      if (updated.count === 0) continue;
      summary.deactivated++;

      await logAuditEvent({
        userId: share.creatorId ?? undefined,
        action: "SHARE_DEACTIVATED",
        ipAddress: SYSTEM_IP,
        targetType: "share",
        targetId: share.id,
        metadata: { shareName: share.name ?? UNNAMED_SHARE, reason: "max_views" },
      });

      if (!share.notifiedForMaxViews) {
        await sendShareDeactivationNotice(share, "max_views");
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, shareId: share.id }, "Failed to deactivate max-views share");
    }
  }

  // ── Case 3: manual pause that has since expired → upgrade to "expired" ──
  const expiredManual = await prisma.share.findMany({
    where: {
      isActive: false,
      deactivationReason: "manual",
      expiration: { not: null, lt: now },
    },
    include: { creator: { select: { id: true, email: true, locale: true, isActive: true } } },
  });
  for (const share of expiredManual) {
    if (!share.expiration) continue;
    try {
      // Compare-and-set on the reason so we never clobber a concurrent resume
      // (which would set reason back to null / the share active again).
      const updated = await prisma.share.updateMany({
        where: { id: share.id, isActive: false, deactivationReason: "manual" },
        // Re-anchor `deactivatedAt` to the expiration instant so grace counts
        // from the real end, not the earlier manual-pause moment.
        data: { deactivatedAt: share.expiration, deactivationReason: "expired" },
      });
      if (updated.count === 0) continue;
      summary.deactivated++;

      await logAuditEvent({
        userId: share.creatorId ?? undefined,
        action: "SHARE_DEACTIVATED",
        ipAddress: SYSTEM_IP,
        targetType: "share",
        targetId: share.id,
        metadata: {
          shareName: share.name ?? UNNAMED_SHARE,
          reason: "expired",
          upgradedFrom: "manual",
        },
      });

      if (!share.notifiedForExpired) {
        await sendShareDeactivationNotice(share, "expired", share.expiration);
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, shareId: share.id }, "Failed to upgrade manual pause to expired");
    }
  }

  return summary;
}

/**
 * Send the one-time deactivation notice for a share and flip the matching
 * `notifiedFor*` flag — only when the email was actually enqueued, with a
 * compare-and-set so a concurrent send cannot duplicate it. A deactivated owner
 * is skipped (their shares are already blocked; notifying them is noise).
 */
async function sendShareDeactivationNotice(
  share: {
    id: string;
    name: string | null;
    maxViews: number | null;
    creatorId: string | null;
    creator: { email: string; locale: string | null; isActive: boolean } | null;
  },
  reason: "expired" | "max_views",
  expiredAt?: Date,
): Promise<void> {
  if (!share.creatorId || !share.creator?.email || !share.creator.isActive) return;
  const locale = share.creator.locale ?? "en";
  const shareManageUrl = await buildShareManageUrl(share.id);

  if (reason === "expired") {
    const result = await emailService.send("share_expired", {
      to: share.creator.email,
      locale,
      userId: share.creatorId,
      relatedId: share.id,
      data: {
        shareName: share.name ?? UNNAMED_SHARE,
        expiredAt: (expiredAt ?? new Date()).toISOString(),
        shareManageUrl,
      },
    });
    if (result.enqueued) {
      await prisma.share.updateMany({
        where: { id: share.id, notifiedForExpired: false },
        data: { notifiedForExpired: true },
      });
    }
    return;
  }

  const result = await emailService.send("share_max_views_reached", {
    to: share.creator.email,
    locale,
    userId: share.creatorId,
    relatedId: share.id,
    data: {
      shareName: share.name ?? UNNAMED_SHARE,
      maxViews: share.maxViews ?? 0,
      shareManageUrl,
    },
  });
  if (result.enqueued) {
    await prisma.share.updateMany({
      where: { id: share.id, notifiedForMaxViews: false },
      data: { notifiedForMaxViews: true },
    });
  }
}

// ─── Phase 2: delete deactivated shares (after grace) ──────────────────────────

/**
 * Deletion sweep for regular shares (Phase A.1, phase 2).
 *
 * Acts only on shares that the deactivation sweep (or the read path) has already
 * moved to `isActive=false` with an **auto-deletable** reason
 * ({@link AUTO_DELETABLE_REASONS}: `expired` / `max_views`). Manual pauses
 * (`reason="manual"`) are deliberately excluded from BOTH the warn and the delete
 * phase — the owner asked for the share to stay; it is only ever deleted if the
 * deactivation sweep upgrades it to `expired`.
 *
 * Grace is measured uniformly from `deactivatedAt`: a share is deleted once
 * `deactivatedAt < now - graceDays`. The warning fires when the deletion moment
 * (`deactivatedAt + grace`) is within `notifyDaysBefore`.
 *
 * - **Warn**: `share_pending_deletion`; `notifiedForPendingDeletion` is flipped
 *   only when the email was actually enqueued (so a no-op send retries later).
 * - **Delete**: `deleteShareLink` (link only — never the owner's files), audit
 *   `SHARE_AUTO_DELETED`, and notify with `share_auto_deleted`.
 *
 * Each item is wrapped so a single failure increments `errors` without aborting
 * the batch.
 */
export async function deleteDeactivatedShares(opts: {
  graceDays: number;
  notifyDaysBefore: number;
}): Promise<CleanupSummary> {
  const { graceDays, notifyDaysBefore } = opts;
  const summary = emptySummary();
  const now = new Date();
  const graceMs = graceDays * ONE_DAY_MS;
  const log = getLogger();
  const autoDeletable = [...AUTO_DELETABLE_REASONS];

  // ── Warn phase ──
  // Deletion moment = deactivatedAt + grace. Warn when that moment is within
  // notifyDaysBefore of now (and not yet reached), i.e.
  //   deactivatedAt ∈ (now - grace, now - grace + notifyDaysBefore]
  if (notifyDaysBefore > 0) {
    const warnLower = new Date(now.getTime() - graceMs);
    const warnUpper = new Date(now.getTime() - graceMs + notifyDaysBefore * ONE_DAY_MS);

    const toWarn = await prisma.share.findMany({
      where: {
        isActive: false,
        deactivationReason: { in: autoDeletable },
        deactivatedAt: { not: null, gt: warnLower, lte: warnUpper },
        notifiedForPendingDeletion: false,
        creatorId: { not: null },
        creator: { isActive: true },
      },
      include: { creator: { select: { id: true, email: true, locale: true } } },
    });

    for (const share of toWarn) {
      if (!share.creator || !share.creatorId || !share.deactivatedAt) continue;
      try {
        const deletionAt = new Date(share.deactivatedAt.getTime() + graceMs);
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
    where: {
      isActive: false,
      deactivationReason: { in: autoDeletable },
      deactivatedAt: { not: null, lt: deleteBefore },
    },
    include: { creator: { select: { id: true, email: true, locale: true, isActive: true } } },
  });

  for (const share of toDelete) {
    try {
      const shareName = share.name ?? UNNAMED_SHARE;
      // Localized reason mirrors the deactivation reason.
      const reasonKey = share.deactivationReason === "max_views" ? "viewLimitReached" : "expired";
      await deleteShareLink(share.id);
      summary.deleted++;

      await logAuditEvent({
        userId: share.creatorId ?? undefined,
        action: "SHARE_AUTO_DELETED",
        ipAddress: SYSTEM_IP,
        targetType: "share",
        targetId: share.id,
        metadata: { shareName, reason: share.deactivationReason ?? "expired" },
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
          data: { shareName, reason: await resolveReason(locale, reasonKey) },
        });
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, shareId: share.id }, "Failed to delete deactivated share");
    }
  }

  return summary;
}

// ─── Phase 1: deactivate ended reverse shares (expired) ────────────────────────

/**
 * Deactivation sweep for reverse shares (Phase A.1, phase 1).
 *
 * Persists the `active → deactivated` transition for reverse shares whose
 * `expiration` has passed but which the read/upload path never observed. Reuses
 * the read-time {@link markExpiredInactive} repository write (compare-and-set on
 * `isActive`, `deactivatedAt` stamped at the expiration instant), sends the
 * one-time `reverse_share_expired` notice (guarded by `notifiedForExpired`), and
 * audits `REVERSE_SHARE_DEACTIVATED`. (Reverse shares have no maxViews concept,
 * so expiry is the only automatic trigger.)
 *
 * Each reverse share is wrapped so a single failure increments `errors` without
 * aborting the batch.
 */
export async function deactivateEndedReverseShares(): Promise<DeactivationSummary> {
  const summary = emptyDeactivationSummary();
  const now = new Date();
  const log = getLogger();

  const expiredActive = await prisma.reverseShare.findMany({
    where: { isActive: true, expiration: { not: null, lt: now } },
    include: { creator: { select: { id: true, email: true, locale: true, isActive: true } } },
  });

  for (const rs of expiredActive) {
    if (!rs.expiration) continue;
    try {
      // markExpiredInactive guards on `isActive: true` and stamps deactivatedAt
      // at the expiration instant — identical to the read-path write (single source
      // of truth: the read path and this sweep call the same repository method).
      const updatedCount = await reverseShareRepository.markExpiredInactive(rs.id, rs.expiration);
      if (updatedCount === 0) continue; // Already deactivated by a racing path.
      summary.deactivated++;

      await logAuditEvent({
        userId: rs.creatorId,
        action: "REVERSE_SHARE_DEACTIVATED",
        ipAddress: SYSTEM_IP,
        targetType: "reverse_share",
        targetId: rs.id,
        metadata: { reverseShareName: rs.name ?? UNNAMED_REVERSE_SHARE, reason: "expired" },
      });

      if (!rs.notifiedForExpired && rs.creator.isActive) {
        const result = await emailService.send("reverse_share_expired", {
          to: rs.creator.email,
          locale: rs.creator.locale ?? "en",
          userId: rs.creatorId,
          relatedId: rs.id,
          data: {
            reverseShareName: rs.name ?? UNNAMED_REVERSE_SHARE,
            expiredAt: rs.expiration.toISOString(),
          },
        });
        if (result.enqueued) {
          await prisma.reverseShare.updateMany({
            where: { id: rs.id, notifiedForExpired: false },
            data: { notifiedForExpired: true },
          });
        }
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, reverseShareId: rs.id }, "Failed to deactivate expired reverse share");
    }
  }

  return summary;
}

// ─── Phase 2: delete deactivated reverse shares (after grace) ──────────────────

/**
 * Deletion sweep for reverse shares (Phase A.1, phase 2). Mirrors
 * {@link deleteDeactivatedShares} but the deletion frees storage: it removes the
 * `ReverseShareFile` rows (DB cascade) and their S3 objects via
 * {@link deleteReverseShareWithStorage}.
 *
 * Acts only on reverse shares `isActive=false` with an auto-deletable reason
 * (`expired`); manual pauses are excluded from warn and delete. Grace is measured
 * uniformly from `deactivatedAt`.
 *
 * - **Warn** with `reverse_share_pending_deletion`.
 * - **Delete** then audit `REVERSE_SHARE_AUTO_DELETED` and notify with
 *   `reverse_share_auto_deleted`.
 */
export async function deleteDeactivatedReverseShares(opts: {
  graceDays: number;
  notifyDaysBefore: number;
}): Promise<CleanupSummary> {
  const { graceDays, notifyDaysBefore } = opts;
  const summary = emptySummary();
  const now = new Date();
  const graceMs = graceDays * ONE_DAY_MS;
  const log = getLogger();
  const autoDeletable = [...AUTO_DELETABLE_REASONS];

  // ── Warn phase ──
  if (notifyDaysBefore > 0) {
    const warnLower = new Date(now.getTime() - graceMs);
    const warnUpper = new Date(now.getTime() - graceMs + notifyDaysBefore * ONE_DAY_MS);

    const toWarn = await prisma.reverseShare.findMany({
      where: {
        isActive: false,
        deactivationReason: { in: autoDeletable },
        deactivatedAt: { not: null, gt: warnLower, lte: warnUpper },
        notifiedForPendingDeletion: false,
        creator: { isActive: true },
      },
      include: { creator: { select: { id: true, email: true, locale: true } } },
    });

    for (const rs of toWarn) {
      if (!rs.deactivatedAt) continue;
      try {
        const deletionAt = new Date(rs.deactivatedAt.getTime() + graceMs);
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
    where: {
      isActive: false,
      deactivationReason: { in: autoDeletable },
      deactivatedAt: { not: null, lt: deleteBefore },
    },
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
        metadata: { reverseShareName, reason: rs.deactivationReason ?? "expired", s3Errors },
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
      log.error({ err, reverseShareId: rs.id }, "Failed to delete deactivated reverse share");
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

// ─── Quota overage smart deletion (B2) ─────────────────────────────────────────

/** Outcome of the opt-in quota-overage smart-deletion sweep (5.2 Phase B B2). */
export interface QuotaOverageSummary {
  /** Users whose grace window has elapsed and were evaluated this run. */
  usersProcessed: number;
  /** Total `File` rows deleted across all processed users. */
  filesDeleted: number;
  /** Total bytes freed (sum of the deleted files' sizes). */
  bytesFreed: number;
  /**
   * Users left blocked: their grace had elapsed and they were still over the
   * limit, but no safe deletion candidate existed (everything is in an active
   * share), so NOTHING was deleted — they simply stay blocked at the hard limit.
   */
  blocked: number;
  /** Best-effort S3 delete failures; one never aborts the rest of the sweep. */
  errors: number;
}

/**
 * Permanently delete a single user-manager `File` for the quota smart-deletion
 * sweep: the DB row first (DB-before-S3), then a best-effort S3 object delete.
 *
 * Mirrors the File-deletion approach used by {@link purgeUserContent} (delete the
 * `File` row, best-effort `deleteObject`). Deleting the `File` row automatically
 * detaches it from any `ShareFiles` / folder links it was part of (the join rows
 * cascade) — a share left empty as a result is **not** removed (§7); it is simply
 * left empty.
 *
 * Returns whether the S3 object delete failed (the DB row is always gone on
 * return — an S3 failure leaves at most an orphan that the A9 sweep reclaims).
 */
async function deleteUserFileWithStorage(
  file: DeletionCandidateFile,
  userId: string,
): Promise<{ s3Failed: boolean }> {
  // DB first so the row never survives an S3 failure (DB-before-S3).
  await prisma.file.delete({ where: { id: file.id } });
  try {
    await storageProvider.deleteObject(file.objectName);
    return { s3Failed: false };
  } catch (err) {
    getLogger().error(
      { err, userId, objectName: file.objectName },
      "Failed to delete user File S3 object during quota smart-deletion",
    );
    return { s3Failed: true };
  }
}

/**
 * Opt-in quota-overage smart-deletion sweep (5.2 Phase B B2).
 *
 * For every user whose usage has stayed over their hard limit longer than the
 * grace window (`quotaExceededSince < now - graceDays`), free space by deleting
 * the user's own files in the **safe order** computed by
 * {@link QuotaService.pickDeletionCandidates} — orphan uploads (in no share)
 * oldest-first, then files whose every referencing share has been inactive for
 * ≥ `inactiveShareDays`, oldest-first — until projected usage is back under the
 * limit. The candidate list is already capped at `bytesToFree` AND can never
 * contain a file that is in an active (recently-used) share, so deleting all of
 * it is correct and respects the never-delete-active-share invariant.
 *
 * If there is **no** safe candidate (everything the user owns is in an active
 * share), NOTHING is deleted: the user is counted as `blocked` and simply stays
 * at the hard limit for new direct uploads. Conservative by design — data safety
 * over storage economy.
 *
 * Per user (isolated try/catch — one failure increments `errors`, never aborts
 * the batch):
 *  1. Resolve the effective limit. Unlimited (`0n`) ⇒ defensively clear the stale
 *     `quotaExceededSince` and skip.
 *  2. `bytesToFree = used - limit`. If ≤ 0 the user is already under (a drop the
 *     event path missed) ⇒ clear `quotaExceededSince` via the centralized path
 *     and skip.
 *  3. Pick candidates. Empty ⇒ `blocked++`, no deletion, no destructive audit.
 *  4. Else delete each candidate (DB-before-S3, S3 failures counted in `errors`
 *     but never fatal), accumulating `filesDeleted` / `bytesFreed`.
 *  5. Recompute usage and call `evaluateAndNotifyQuota` so `quotaExceededSince`
 *     is cleared centrally when back under the limit (it never sends a spurious
 *     warning here — usage only ever drops). Emit a `QUOTA_FILES_DELETED` audit
 *     event and a `files_auto_deleted` notification (with the deleted file names)
 *     to the owner.
 *
 * The opt-in `quotaSmartDeletionEnabled` gate is enforced by the scheduler before
 * this is called (mirroring A7/A9); this function performs the work unconditionally.
 */
export async function enforceQuotaOverage(opts: {
  graceDays: number;
  inactiveShareDays: number;
  now?: Date;
}): Promise<QuotaOverageSummary> {
  const { graceDays, inactiveShareDays } = opts;
  const now = opts.now ?? new Date();
  const summary: QuotaOverageSummary = {
    usersProcessed: 0,
    filesDeleted: 0,
    bytesFreed: 0,
    blocked: 0,
    errors: 0,
  };
  const log = getLogger();
  const cutoff = new Date(now.getTime() - graceDays * ONE_DAY_MS);

  const users = await prisma.user.findMany({
    where: { quotaExceededSince: { not: null, lt: cutoff } },
    select: { id: true, email: true, locale: true, isActive: true },
  });

  for (const user of users) {
    try {
      summary.usersProcessed++;

      const [limits, used] = await Promise.all([
        quotaService.resolveEffectiveLimits(user.id),
        quotaService.calculateStorageUsed(user.id),
      ]);
      const limit = limits.maxTotalStorage;

      // Unlimited limit ⇒ the grace clock is stale; clear it and move on.
      if (limit <= 0n) {
        await prisma.user.update({
          where: { id: user.id },
          data: { quotaExceededSince: null },
        });
        continue;
      }

      const bytesToFree = used - limit;
      if (bytesToFree <= 0n) {
        // Already back under the limit (a drop the event path missed). Clear the
        // grace clock through the centralized path so all state stays consistent.
        await quotaService.evaluateAndNotifyQuota(user.id, { oldUsed: used, newUsed: used });
        continue;
      }

      const candidates = await quotaService.pickDeletionCandidates(
        user.id,
        bytesToFree,
        inactiveShareDays,
        now,
      );

      // No safe candidate ⇒ leave the user blocked at the hard limit. Never
      // delete active-share content; no deletion, no destructive audit.
      if (candidates.length === 0) {
        summary.blocked++;
        continue;
      }

      // Capture names before deletion so the notification can list them (the
      // candidates only carry id/objectName/size).
      const candidateIds = candidates.map((c) => c.id);
      const named = await prisma.file.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true },
      });
      const nameById = new Map(named.map((f) => [f.id, f.name]));

      let freed = 0n;
      let deletedCount = 0;
      const deletedNames: string[] = [];
      for (const candidate of candidates) {
        const { s3Failed } = await deleteUserFileWithStorage(candidate, user.id);
        if (s3Failed) summary.errors++;
        freed += candidate.size;
        deletedCount++;
        const name = nameById.get(candidate.id);
        if (name) deletedNames.push(name);
      }
      summary.filesDeleted += deletedCount;
      summary.bytesFreed += Number(freed);

      // Recompute usage and clear `quotaExceededSince` centrally when back under
      // the limit. Usage only ever drops here, so this never sends a spurious
      // warning — it just reconciles state (and may clear the grace clock).
      const usedAfter = await quotaService.calculateStorageUsed(user.id);
      await quotaService.evaluateAndNotifyQuota(user.id, { oldUsed: used, newUsed: usedAfter });

      await logAuditEvent({
        userId: user.id,
        action: "QUOTA_FILES_DELETED",
        ipAddress: SYSTEM_IP,
        targetType: "user",
        targetId: user.id,
        metadata: { filesDeleted: deletedCount, bytesFreed: Number(freed) },
      });

      // Notify the owner (skip deactivated accounts — consistent with the other
      // notifiers; a deactivated user's content is handled by A7 anyway).
      if (user.isActive) {
        const locale = user.locale ?? "en";
        await emailService.send("files_auto_deleted", {
          to: user.email,
          locale,
          userId: user.id,
          data: {
            fileNames: deletedNames,
            reason: await resolveReason(locale, "quotaExceeded"),
          },
        });
      }
    } catch (err) {
      summary.errors++;
      log.error({ err, userId: user.id }, "Failed to enforce quota overage for user");
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
  /**
   * Incomplete/abandoned multipart uploads aborted because they were initiated
   * before the min-age cutoff (count actually aborted, or candidate count in a
   * dry run).
   */
  multipartAborted: number;
  /** Per-item failures (DB, S3, or multipart); one failure never aborts the sweep. */
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
  /**
   * Dry-run only: the incomplete multipart uploads that *would* be aborted
   * (initiated before the cutoff). One entry per candidate upload.
   */
  multipartCandidates?: Array<{ key: string; uploadId: string; initiatedAt: string }>;
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
 * **Incomplete multipart uploads**: `ListObjectsV2` (the S3→DB phase) only sees
 * *finalized* objects, so the parts of a multipart upload that was initiated but
 * never completed or aborted (e.g. a large reverse-share upload where the browser
 * was closed) are invisible to it and would linger in S3 forever. This third
 * phase enumerates incomplete multipart uploads via
 * {@link StorageProvider.listMultipartUploads} and aborts each one whose
 * `initiated` timestamp is older than the cutoff — discarding its parts and
 * reclaiming the storage. The same `minAgeHours` guard protects in-flight uploads
 * (a multipart upload younger than the cutoff is still being assembled). Each real
 * abort logs an `ORPHAN_MULTIPART_ABORTED` audit event.
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
 * When `dryRun` is true nothing is deleted or aborted and no audit events are
 * emitted: the summary's `dbDeleted`/`s3Deleted`/`multipartAborted` report the
 * candidate counts and `dbCandidates`/`s3Candidates`/`multipartCandidates` list
 * the identifiers that *would* be removed.
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
  const summary: OrphanSweepSummary = {
    dbDeleted: 0,
    s3Deleted: 0,
    multipartAborted: 0,
    errors: 0,
  };
  const log = getLogger();
  const cutoff = new Date(Date.now() - minAgeHours * ONE_HOUR_MS);

  const dbCandidates: NonNullable<OrphanSweepSummary["dbCandidates"]> = [];
  const s3Candidates: string[] = [];
  const multipartCandidates: NonNullable<OrphanSweepSummary["multipartCandidates"]> = [];

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

  // ── Incomplete multipart uploads: abort those initiated before the cutoff ──
  // These are invisible to `listObjects` above (it only lists finalized objects),
  // so they are reconciled separately. The min-age guard protects an upload that
  // is still being assembled (initiated within `minAgeHours`).
  const incompleteUploads = await storageProvider.listMultipartUploads();
  for (const upload of incompleteUploads) {
    if (upload.initiated >= cutoff) continue;
    try {
      if (dryRun) {
        multipartCandidates.push({
          key: upload.key,
          uploadId: upload.uploadId,
          initiatedAt: upload.initiated.toISOString(),
        });
        summary.multipartAborted++;
        continue;
      }
      await storageProvider.abortMultipartUpload(upload.key, upload.uploadId);
      summary.multipartAborted++;
      await logAuditEvent({
        action: "ORPHAN_MULTIPART_ABORTED",
        ipAddress: SYSTEM_IP,
        targetType: "file",
        metadata: {
          key: upload.key,
          uploadId: upload.uploadId,
          initiatedAt: upload.initiated.toISOString(),
        },
      });
    } catch (err) {
      summary.errors++;
      log.error(
        { err, key: upload.key, uploadId: upload.uploadId },
        "Failed to abort incomplete multipart upload",
      );
    }
  }

  if (dryRun) {
    summary.dbCandidates = dbCandidates;
    summary.s3Candidates = s3Candidates;
    summary.multipartCandidates = multipartCandidates;
  }

  return summary;
}
