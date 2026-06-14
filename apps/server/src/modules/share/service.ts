import crypto from "node:crypto";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import bcrypt from "bcryptjs";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import type { EmailPayloads } from "../email/catalog.js";
import { emailService } from "../email/service.js";
import { buildShareLink, buildShareManageUrl } from "../email/url-builder.js";
import { FolderService } from "../folder/service.js";
import { type CreateShareInput, ShareResponseSchema, type UpdateShareInput } from "./dto.js";
import { assertShareAccessible, deactivationFields, reactivationFields } from "./lifecycle.js";
import { type IShareRepository, PrismaShareRepository } from "./repository.js";
import { mintShareFileToken } from "./share-file-token.js";
import {
  isSharePasswordLocked,
  recordSharePasswordAttempt,
} from "./share-password-attempts.service.js";

export interface ShareAccessContext {
  trackingToken?: string;
  visitorCookie?: { name?: string; email?: string; recipientId?: string; alias?: string };
  ipAddress?: string;
  userAgent?: string;
  /**
   * Output channel populated by {@link ShareService.getShare}: when access resolves a recipient
   * (via token, or by matching a self-declared cookie email), this carries the recipient id so the
   * route handler can refresh the signed visitor cookie with `recipientId` — letting later
   * downloads inherit the verified identity. Only set when source is `"token"` (a self-declared
   * match is not promoted into the cookie, which would mislabel later downloads as verified).
   */
  out?: { recipientIdForCookie?: string };
}

type ShareWithRelations = Prisma.ShareGetPayload<{
  include: {
    security: true;
    files: true;
    folders: {
      select: {
        id: true;
        name: true;
        description: true;
        objectName: true;
        parentId: true;
        userId: true;
        createdAt: true;
        updatedAt: true;
        _count: { select: { files: true; children: true } };
      };
    };
    recipients: true;
    alias: true;
    creator: {
      select: {
        email: true;
        locale: true;
        isActive: true;
      };
    };
  };
}>;

export class ShareService {
  constructor(private readonly shareRepository: IShareRepository = new PrismaShareRepository()) {}
  private folderService = new FolderService();

  private async formatShareResponse(share: ShareWithRelations | null, isOwner = true) {
    if (!share) throw new NotFoundError("Share not found");

    return {
      ...share,
      createdAt: share.createdAt.toISOString(),
      updatedAt: share.updatedAt.toISOString(),
      expiration: share.expiration?.toISOString() || null,
      lastDownloadedAt: share.lastDownloadedAt?.toISOString() ?? null,
      alias: share.alias
        ? {
            ...share.alias,
            createdAt: share.alias.createdAt.toISOString(),
            updatedAt: share.alias.updatedAt.toISOString(),
          }
        : null,
      maxViews: share.maxViews,
      isActive: share.isActive,
      deactivatedAt: share.deactivatedAt?.toISOString() ?? null,
      deactivationReason: share.deactivationReason ?? null,
      security: {
        hasPassword: !!share.security.password,
      },
      // Non-owner responses (R2 — A4-08) never expose the raw S3 `objectName` (it embeds the
      // owner's userId and was the key the old download bypass abused) nor the owner's `userId`.
      // Each file instead carries an opaque, share-scoped download token resolved server-side by
      // the download endpoints; the owner UI still receives the real objectName for its own flows.
      files:
        share.files?.map((file) => ({
          ...file,
          objectName: isOwner ? file.objectName : mintShareFileToken(share.id, file.id),
          userId: isOwner ? file.userId : "",
          size: file.size.toString(),
          createdAt: file.createdAt.toISOString(),
          updatedAt: file.updatedAt.toISOString(),
        })) || [],
      folders:
        share.folders && share.folders.length > 0
          ? await Promise.all(
              share.folders.map(async (folder) => {
                const totalSize = await this.folderService.calculateFolderSize(
                  folder.id,
                  folder.userId,
                );
                return {
                  ...folder,
                  // Non-owner responses (R2 — A4-08) omit the raw folder objectName and the
                  // owner's userId; folders are not directly downloadable by key (the client
                  // expands them client-side and downloads each file via its token).
                  objectName: isOwner ? folder.objectName : "",
                  userId: isOwner ? folder.userId : "",
                  totalSize: totalSize.toString(),
                  createdAt: folder.createdAt.toISOString(),
                  updatedAt: folder.updatedAt.toISOString(),
                };
              }),
            )
          : [],
      // Strip recipients (including trackingTokens) from non-owner responses
      recipients: isOwner
        ? share.recipients?.map((recipient) => ({
            ...recipient,
            notifiedAt: recipient.notifiedAt?.toISOString() ?? null,
            lastAccessedAt: recipient.lastAccessedAt?.toISOString() ?? null,
            lastDownloadedAt: recipient.lastDownloadedAt?.toISOString() ?? null,
            createdAt: recipient.createdAt.toISOString(),
            updatedAt: recipient.updatedAt.toISOString(),
          })) || []
        : [],
      // Strip owner-only metadata from non-owner responses
      ...(isOwner
        ? {}
        : {
            creatorId: null,
            notifyOnDownload: false,
            inactivityAlertDays: null,
            lastDownloadedAt: null,
            notifiedForExpiring: false,
            notifiedForExpired: false,
            // Lifecycle internals are owner-only. A non-owner only ever reaches
            // this path for an active share, so report the visible (active) state.
            isActive: true,
            deactivatedAt: null,
            deactivationReason: null,
          }),
      // Strip creator from response (internal use only)
      creator: undefined,
    };
  }

  /**
   * Fire-and-forget notification to the share creator, with standard guards.
   * Skips silently when creator is missing, has no email, or is deactivated.
   * Returns the send result so callers can perform post-send work (e.g. flag updates).
   */
  private async notifyShareCreator<T extends keyof EmailPayloads>(
    share: {
      id: string;
      creatorId: string | null;
      creator?: { email: string; locale: string | null; isActive: boolean } | null;
    },
    type: T,
    buildData: (shareManageUrl: string) => EmailPayloads[T],
  ): Promise<{ enqueued: boolean; reason?: "invalid_payload" } | null> {
    if (!share.creatorId || !share.creator?.email || share.creator.isActive === false) return null;
    try {
      const shareManageUrl = await buildShareManageUrl(share.id);
      return await emailService.send(type, {
        to: share.creator.email,
        locale: share.creator.locale ?? "en",
        userId: share.creatorId,
        relatedId: share.id,
        data: buildData(shareManageUrl),
      });
    } catch (err) {
      getLogger().error({ err }, `Failed to send ${type} notification`);
      return null;
    }
  }

  async createShare(data: CreateShareInput, userId: string) {
    const { password, maxViews, files, folders, ...shareData } = data;

    if (files && files.length > 0) {
      const existingFiles = await prisma.file.findMany({
        where: {
          id: { in: files },
          userId: userId,
        },
      });
      const notFoundFiles = files.filter((id) => !existingFiles.some((file) => file.id === id));
      if (notFoundFiles.length > 0) {
        throw new NotFoundError(`Files not found or access denied: ${notFoundFiles.join(", ")}`);
      }
    }

    if (folders && folders.length > 0) {
      const existingFolders = await prisma.folder.findMany({
        where: {
          id: { in: folders },
          userId: userId,
        },
      });
      const notFoundFolders = folders.filter(
        (id) => !existingFolders.some((folder) => folder.id === id),
      );
      if (notFoundFolders.length > 0) {
        throw new NotFoundError(
          `Folders not found or access denied: ${notFoundFolders.join(", ")}`,
        );
      }
    }

    // Empty shares are intentionally allowed — a share can be created up front and have
    // files/folders added later via "manage files".

    const security = await prisma.shareSecurity.create({
      data: {
        password: password ? await bcrypt.hash(password, 10) : null,
      },
    });

    const share = await this.shareRepository.createShare({
      ...shareData,
      files,
      folders,
      maxViews: maxViews ?? null,
      securityId: security.id,
      creatorId: userId,
    });

    const shareWithRelations = await this.shareRepository.findShareById(share.id);
    return ShareResponseSchema.parse(await this.formatShareResponse(shareWithRelations));
  }

  async getShare(
    shareId: string,
    password?: string,
    userId?: string,
    context?: ShareAccessContext,
  ) {
    const share = await this.shareRepository.findShareById(shareId);

    if (!share) {
      throw new NotFoundError("Share not found");
    }

    const isOwner = !!(userId && share.creatorId === userId);
    // Note: If the share owner accesses while logged out, they are treated as an anonymous
    // visitor. This is intentional per spec (Section 5). Do not attempt to infer ownership
    // via cookies or fingerprints.

    if (isOwner) {
      // Owner self-access via the management UI (share-details modal) — do NOT record a visit.
      // The modal calls GET /shares/:shareId on every open and on every invalidateShare()
      // (edit name/description, refresh trigger), so tracking it fills the activity log with
      // self-referential noise that drowns real visitor activity. The owner-download path also
      // does not track owners, so skipping here restores access/download consistency.
      return ShareResponseSchema.parse(await this.formatShareResponse(share));
    }

    // Share-lifecycle access gate (owner-inactive, persisted deactivation, defensive
    // date-based expiry, max-views reached). Single source of truth shared with the file
    // download path (R2 — A4-02) so the read gate and the byte-retrieval gate can never
    // diverge. The owner's own access is already returned above, so they are never blocked
    // from managing their own paused/expired/maxed share. The atomic maxViews increment
    // below still runs to advance/persist the counter for the read path.
    assertShareAccessible(share);

    // Per-share password brute-force protection (R2 — A4-03). Before evaluating the password
    // gate, reject if this share's password attempts are currently locked out. Keyed by share,
    // so IP rotation cannot bypass it (mirrors the email-only login lockout).
    if (share.security?.password) {
      const lockIp = context?.ipAddress ?? "unknown";
      const lock = await isSharePasswordLocked("share", share.id, lockIp);
      if (lock.locked) {
        throw new AppError(
          429,
          `Too many password attempts. Try again in ${lock.remainingMinutes} minutes.`,
          ErrorCodes.SHARE_LOCKED,
          { remainingMinutes: lock.remainingMinutes },
        );
      }
    }

    if (share.security?.password && !password) {
      if (context?.ipAddress) {
        logAuditEvent({
          action: "SHARE_PASSWORD_FAILED",
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          targetType: "share",
          targetId: shareId,
          metadata: { reason: "no_password_supplied" },
        }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      }
      throw new AppError(401, "Password required", ErrorCodes.PASSWORD_REQUIRED);
    }

    if (share.security?.password && password) {
      const isPasswordValid = await bcrypt.compare(password, share.security.password);
      if (!isPasswordValid) {
        await recordSharePasswordAttempt("share", share.id, context?.ipAddress ?? "unknown", false);
        if (context?.ipAddress) {
          logAuditEvent({
            action: "SHARE_PASSWORD_FAILED",
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            targetType: "share",
            targetId: shareId,
          }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
        }
        throw new AppError(401, "Invalid password", ErrorCodes.INVALID_PASSWORD);
      }
      // Successful password — reset the per-share failure counter.
      await recordSharePasswordAttempt("share", share.id, context?.ipAddress ?? "unknown", true);
      if (context?.ipAddress) {
        logAuditEvent({
          action: "SHARE_PASSWORD_VERIFIED",
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          targetType: "share",
          targetId: shareId,
        }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      }
    }

    // Hoist the recipient lookup: resolve the tracking-token recipient once and reuse
    // below for both the identification gate and the visit-tracking update (avoids two
    // round-trips to the database for the same query).
    let resolvedRecipient: Awaited<ReturnType<typeof prisma.shareRecipient.findUnique>> | null =
      null;
    if (context?.trackingToken) {
      const candidate = await prisma.shareRecipient.findUnique({
        where: { trackingToken: context.trackingToken },
      });
      // Only accept the recipient if they belong to this share
      if (candidate && candidate.shareId === share.id) {
        resolvedRecipient = candidate;
      }
    }

    // Check if identification is required before allowing access
    if (share.nameFieldRequired === "REQUIRED" || share.emailFieldRequired === "REQUIRED") {
      const hasCookie = !!context?.visitorCookie;

      const tokenSatisfiesRequirements =
        !!resolvedRecipient &&
        (share.nameFieldRequired !== "REQUIRED" || !!resolvedRecipient.name) &&
        (share.emailFieldRequired !== "REQUIRED" || !!resolvedRecipient.email);

      // FIX 3: Re-validate cookie content against current share requirements
      let cookieSatisfiesRequirements = false;
      if (hasCookie) {
        const cookie = context!.visitorCookie!;
        cookieSatisfiesRequirements =
          (share.nameFieldRequired !== "REQUIRED" || !!cookie.name) &&
          (share.emailFieldRequired !== "REQUIRED" || !!cookie.email);
      }

      if (!tokenSatisfiesRequirements && !cookieSatisfiesRequirements) {
        throw new AppError(403, "Identification required", ErrorCodes.IDENTIFICATION_REQUIRED);
      }
    }

    const { incremented, newViews } = await this.shareRepository.incrementViewsAtomic(
      shareId,
      share.maxViews ?? null,
    );
    if (!incremented) {
      throw new AppError(410, "Share has reached maximum views", ErrorCodes.MAX_VIEWS_REACHED);
    }

    // maxViews transition (Phase A.1): when this access is the one that hits the
    // limit, persist the deactivation so the read gate above blocks subsequent
    // visitors and Batch 3's deletion sweep can act. Race-safe: the atomic
    // increment only lets `views < maxViews` advance, so exactly one request
    // observes `newViews === maxViews` as the hitting request. The compare-and-set
    // (`isActive: true` guard) is idempotent — it never clobbers an earlier
    // deactivatedAt set by a manual pause or the scheduler.
    if (share.maxViews !== null && newViews >= share.maxViews && share.isActive) {
      await prisma.share
        .updateMany({
          where: { id: shareId, isActive: true },
          data: deactivationFields("max_views"),
        })
        .catch((err) => getLogger().error({ err }, "Failed to persist maxViews deactivation"));
    }

    if (context?.ipAddress) {
      logAuditEvent({
        action: "SHARE_ACCESS",
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        targetType: "share",
        targetId: shareId,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
    }

    // Record visitor tracking for non-owner access — reuse the already-resolved recipient
    let recipientId: string | undefined;
    let visitorName: string | undefined;
    let visitorEmail: string | undefined;
    let visitUserId: string | undefined;
    // How the recipient was attributed on this access visit (mirrored on the download path):
    // "token" = verified via personalized ?t= link; "self_declared" = matched the identification
    // cookie email; "authenticated_user" = logged-in Ouitransfer user (JWT-backed, no token/cookie
    // match); null = anonymous / unmatched.
    let identificationSource: "token" | "self_declared" | "authenticated_user" | undefined;

    if (resolvedRecipient) {
      recipientId = resolvedRecipient.id;
      visitorEmail = resolvedRecipient.email;
      visitorName = resolvedRecipient.name ?? undefined;
      identificationSource = "token";
      // Promote the verified recipient into the signed cookie so later downloads (which never
      // see the ?t= token) inherit this token-verified identity.
      if (context?.out) {
        context.out.recipientIdForCookie = resolvedRecipient.id;
      }
      // Update recipient access stats
      await prisma.shareRecipient.update({
        where: { id: resolvedRecipient.id },
        data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
      });
    }

    // Or from identification cookie
    if (!recipientId && context?.visitorCookie) {
      visitorName = context.visitorCookie.name;
      visitorEmail = context.visitorCookie.email;

      // Lot C — close the NULL gap: a self-identified visitor whose declared email matches a
      // recipient of THIS share is linked too (best-effort, spoofable → always "self_declared",
      // never promoted into the cookie as a verified identity). Guard on email: the cookie can be
      // name-only.
      const declaredEmail = context.visitorCookie.email?.trim().toLowerCase();
      if (declaredEmail) {
        const selfDeclared = await prisma.shareRecipient.findUnique({
          where: { shareId_email: { shareId: share.id, email: declaredEmail } },
        });
        if (selfDeclared) {
          recipientId = selfDeclared.id;
          identificationSource = "self_declared";
          await prisma.shareRecipient.update({
            where: { id: selfDeclared.id },
            data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
          });
        }
      }
    }

    // Authenticated fallback: if no recipientId was attributed but the visitor is a logged-in
    // Ouitransfer user, record their verified identity. Precedence:
    //   token → self_declared/cookie (matched recipient) → authenticated_user → anonymous (null)
    // A matched cookie (recipientId set via self_declared) still takes precedence — the
    // !recipientId guard above ensures that. An UNMATCHED cookie (no recipientId) no longer
    // blocks this path: a verified JWT identity must win over a stale/unmatched sv_ cookie.
    // The early-return above ensures we never reach here for the owner.
    if (!recipientId && userId) {
      const authenticatedUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true, email: true },
      });
      if (authenticatedUser) {
        visitUserId = userId;
        identificationSource = "authenticated_user";
        visitorName = authenticatedUser.username;
        visitorEmail = authenticatedUser.email;
      }
    }

    // Fire and forget — don't block the response.
    // Await visit insert before notification: if the visit record fails,
    // don't notify the owner about a visit that was never recorded.
    (async () => {
      try {
        await prisma.shareVisit.create({
          data: {
            shareId: share.id,
            userId: visitUserId,
            recipientId,
            visitorName,
            visitorEmail,
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent,
            action: "access",
            identificationSource,
          },
        });
      } catch (err) {
        getLogger().error({ err }, "Failed to create ShareVisit");
        return; // Don't notify — the visit was never recorded
      }

      // Trigger share_accessed notification
      await this.notifyShareCreator(share, "share_accessed", (shareManageUrl) => ({
        shareName: share.name ?? "Unnamed share",
        visitorName,
        visitorEmail,
        accessedAt: new Date().toISOString(),
        shareManageUrl,
      }));
    })().catch(() => {});

    // Trigger share_max_views_reached notification when the share just hit its limit.
    // Uses the actual post-increment `newViews` from the atomic operation (not a snapshot).
    // Flag is set AFTER email enqueue succeeds, with compare-and-set to prevent duplicates.
    if (share.maxViews !== null && newViews >= share.maxViews && !share.notifiedForMaxViews) {
      (async () => {
        const result = await this.notifyShareCreator(
          share,
          "share_max_views_reached",
          (shareManageUrl) => ({
            shareName: share.name ?? "Unnamed share",
            maxViews: share.maxViews!,
            shareManageUrl,
          }),
        );
        if (result?.enqueued) {
          // Compare-and-set: only flip flag if still false (prevents duplicate sends)
          await prisma.share.updateMany({
            where: { id: shareId, notifiedForMaxViews: false },
            data: { notifiedForMaxViews: true },
          });
        }
      })().catch(() => {});
    }

    // Use actual post-increment view count from the atomic operation
    const updatedShare = { ...share, views: newViews };
    return ShareResponseSchema.parse(await this.formatShareResponse(updatedShare, false));
  }

  async updateShare(
    shareId: string,
    data: Omit<UpdateShareInput, "id">,
    userId: string,
    context?: ShareAccessContext,
  ) {
    const { password, maxViews, recipients, expiration, ...shareData } = data;

    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    if (password) {
      await this.shareRepository.updateShareSecurity(share.securityId, {
        password: await bcrypt.hash(password, 10),
      });
    }

    if (recipients !== undefined) {
      // Normalize mixed-format recipients (string | {email, name?}) to {email, name?}
      const normalizedRecipients = recipients.map((r) => {
        if (typeof r === "string") {
          return { email: r.trim().toLowerCase(), name: undefined as string | undefined };
        }
        return { email: r.email.trim().toLowerCase(), name: r.name };
      });

      await prisma.$transaction(async (tx) => {
        const existing = await tx.shareRecipient.findMany({ where: { shareId } });
        const existingByEmail = new Map(existing.map((rec) => [rec.email, rec]));
        const newEmailSet = new Set(normalizedRecipients.map((r) => r.email));

        // Remove recipients no longer in the list
        const toRemove = existing.filter((rec) => !newEmailSet.has(rec.email));
        if (toRemove.length > 0) {
          await tx.shareRecipient.deleteMany({
            where: { shareId, id: { in: toRemove.map((rec) => rec.id) } },
          });
        }

        // Add new recipients with tracking tokens (and optional name)
        const toAdd = normalizedRecipients.filter((r) => !existingByEmail.has(r.email));
        for (const { email, name } of toAdd) {
          const trackingToken = crypto.randomBytes(24).toString("base64url");
          await tx.shareRecipient.create({
            data: { shareId, email, trackingToken, name: name ?? null },
          });
        }
        // Existing recipients are untouched — tokens, notifiedAt, stats preserved
      });
    }

    // Note: Toggling notifyOnDownload does not reset notification cooldowns.
    // The standard 15-minute cooldown still applies after toggling.
    const updateData: Partial<Parameters<typeof this.shareRepository.updateShare>[1]> = {
      ...shareData,
      maxViews: maxViews !== undefined ? maxViews : undefined,
      // Only touch expiration if it was explicitly included in the payload.
      // undefined = not sent (preserve existing value), null-ish string = clear, valid string = set.
      ...(expiration !== undefined && {
        expiration: expiration ? new Date(expiration) : null,
      }),
    };

    // Reset notification flags when expiration is added or extended (allows re-notification)
    const newExp =
      expiration !== undefined ? (expiration ? new Date(expiration) : null) : undefined;
    const oldExp = share.expiration;
    if (newExp && (!oldExp || newExp > oldExp)) {
      updateData.notifiedForExpiring = false;
      updateData.notifiedForExpired = false;
      // Extending expiration moves the pending-deletion window, so re-arm the warning.
      updateData.notifiedForPendingDeletion = false;
    }

    // Reset maxViews notification flag when maxViews is increased (allows re-notification)
    if (maxViews !== undefined) {
      const oldMax = share.maxViews;
      if (maxViews === null || (oldMax !== null && maxViews > oldMax)) {
        updateData.notifiedForMaxViews = false;
        // Raising/clearing maxViews can take the share back under its threshold,
        // so a previously-armed pending-deletion warning should re-arm too.
        updateData.notifiedForPendingDeletion = false;
      }
    }

    // Reactivation on extend (Phase A.1): if the share is currently deactivated and
    // the update extends `expiration` / raises-or-clears `maxViews` such that it is
    // valid again, bring it back to active and clear the deactivation metadata. A
    // share that is still expired or still maxed after the update stays deactivated
    // (read-time gate stays closed) — the owner must extend it for real to revive it.
    let reactivated = false;
    if (!share.isActive) {
      // Effective values after this update (undefined = unchanged → keep existing).
      const effectiveExpiration = newExp !== undefined ? newExp : share.expiration;
      const effectiveMaxViews = maxViews !== undefined ? maxViews : share.maxViews;

      const stillExpired = !!effectiveExpiration && new Date() > new Date(effectiveExpiration);
      const stillMaxed = effectiveMaxViews !== null && share.views >= effectiveMaxViews;

      if (!stillExpired && !stillMaxed) {
        Object.assign(updateData, reactivationFields());
        reactivated = true;
      }
    }

    await this.shareRepository.updateShare(shareId, updateData);

    // A renew-via-extend that revives a deactivated share is a lifecycle transition,
    // so it writes SHARE_REACTIVATED (with `via: "extend"`) on top of the generic
    // SHARE_UPDATE the route emits — mirroring the manual `resumeShare` audit so the
    // activity log records every active⇄deactivated transition uniformly.
    if (reactivated) {
      logAuditEvent({
        action: "SHARE_REACTIVATED",
        userId,
        ipAddress: context?.ipAddress ?? "system",
        userAgent: context?.userAgent,
        targetType: "share",
        targetId: shareId,
        metadata: { via: "extend" },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
    }

    const shareWithRelations = await this.shareRepository.findShareById(shareId);

    return ShareResponseSchema.parse(await this.formatShareResponse(shareWithRelations));
  }

  /**
   * Manually pause a share (owner action, Phase A.1). Sets the share inactive with
   * reason `manual` and stamps `deactivatedAt`. Manual pauses are never auto-deleted
   * by the cleanup sweep. Idempotent on the audit metadata — pausing an
   * already-paused share simply refreshes `deactivatedAt`.
   *
   * @param shareId  the share to pause
   * @param ownerId  the authenticated user; must own the share
   * @param context  optional request context for the audit event (ip / user-agent)
   */
  async pauseShare(shareId: string, ownerId: string, context?: ShareAccessContext) {
    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }
    if (share.creatorId !== ownerId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    await this.shareRepository.updateShare(shareId, deactivationFields("manual"));

    logAuditEvent({
      action: "SHARE_DEACTIVATED",
      userId: ownerId,
      ipAddress: context?.ipAddress ?? "system",
      userAgent: context?.userAgent,
      targetType: "share",
      targetId: shareId,
      metadata: { reason: "manual" },
    }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

    const updated = await this.shareRepository.findShareById(shareId);
    return ShareResponseSchema.parse(await this.formatShareResponse(updated));
  }

  /**
   * Manually resume a paused share (owner action, Phase A.1). Clears the
   * deactivation metadata and re-arms the pending-deletion warning. Refuses to
   * resume a share that would still be expired or maxed — those cannot be revived
   * without extending `expiration` / raising `maxViews` (read-time stays blocked),
   * so resuming them would be a no-op that misleads the owner.
   *
   * @param shareId  the share to resume
   * @param ownerId  the authenticated user; must own the share
   * @param context  optional request context for the audit event (ip / user-agent)
   */
  async resumeShare(shareId: string, ownerId: string, context?: ShareAccessContext) {
    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }
    if (share.creatorId !== ownerId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    // Cannot truly revive a share that is still past its limits — the read-time
    // gate would block it again immediately. The owner must extend it instead.
    const stillExpired = !!share.expiration && new Date() > new Date(share.expiration);
    const stillMaxed = share.maxViews !== null && share.views >= share.maxViews;
    if (stillExpired || stillMaxed) {
      throw new ValidationError(
        "Cannot resume a share that is still expired or has reached its view limit; extend it instead",
      );
    }

    await this.shareRepository.updateShare(shareId, reactivationFields());

    logAuditEvent({
      action: "SHARE_REACTIVATED",
      userId: ownerId,
      ipAddress: context?.ipAddress ?? "system",
      userAgent: context?.userAgent,
      targetType: "share",
      targetId: shareId,
    }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

    const updated = await this.shareRepository.findShareById(shareId);
    return ShareResponseSchema.parse(await this.formatShareResponse(updated));
  }

  async deleteShare(id: string) {
    const share = await this.shareRepository.findShareById(id);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    await prisma.$transaction(async (tx) => {
      await tx.share.update({
        where: { id },
        data: {
          files: {
            set: [],
          },
        },
      });

      const deletedShare = await tx.share.delete({
        where: { id },
        include: {
          security: true,
          files: true,
        },
      });

      if (deletedShare.security) {
        await tx.shareSecurity.delete({
          where: { id: deletedShare.security.id },
        });
      }
    });

    // Return the pre-deletion share data (already fetched with all relations)
    return ShareResponseSchema.parse(await this.formatShareResponse(share));
  }

  async listUserShares(userId: string) {
    const shares = await this.shareRepository.findSharesByUserId(userId);
    return await Promise.all(shares.map(async (share) => await this.formatShareResponse(share)));
  }

  async updateSharePassword(shareId: string, userId: string, password: string | null) {
    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    await this.shareRepository.updateShareSecurity(share.security.id, {
      password: password ? await bcrypt.hash(password, 10) : null,
    });

    const updated = await this.shareRepository.findShareById(shareId);
    return ShareResponseSchema.parse(await this.formatShareResponse(updated));
  }

  async addItemsToShare(shareId: string, userId: string, fileIds: string[], folderIds: string[]) {
    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    if (fileIds.length > 0) {
      // Scope to the caller (R2 — A2-01): only the caller's own files may be added. A file
      // owned by another user is "not found", so it can never be IDOR-connected to this share.
      const existingFiles = await this.shareRepository.findFilesByIds(fileIds, userId);
      const notFoundFiles = fileIds.filter((id) => !existingFiles.some((file) => file.id === id));

      if (notFoundFiles.length > 0) {
        throw new NotFoundError(`Files not found: ${notFoundFiles.join(", ")}`);
      }

      await this.shareRepository.addFilesToShare(shareId, fileIds);
    }

    if (folderIds.length > 0) {
      const existingFolders = await this.shareRepository.findFoldersByIds(folderIds, userId);
      const notFoundFolders = folderIds.filter(
        (id) => !existingFolders.some((folder) => folder.id === id),
      );

      if (notFoundFolders.length > 0) {
        throw new NotFoundError(`Folders not found: ${notFoundFolders.join(", ")}`);
      }

      await this.shareRepository.addFoldersToShare(shareId, folderIds);
    }

    const updated = await this.shareRepository.findShareById(shareId);
    return ShareResponseSchema.parse(await this.formatShareResponse(updated));
  }

  async removeItemsFromShare(
    shareId: string,
    userId: string,
    fileIds: string[],
    folderIds: string[],
  ) {
    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    if (fileIds.length > 0) {
      await this.shareRepository.removeFilesFromShare(shareId, fileIds);
    }

    if (folderIds.length > 0) {
      await this.shareRepository.removeFoldersFromShare(shareId, folderIds);
    }

    const updated = await this.shareRepository.findShareById(shareId);
    return ShareResponseSchema.parse(await this.formatShareResponse(updated));
  }

  async findShareById(id: string) {
    const share = await this.shareRepository.findShareById(id);
    if (!share) {
      throw new NotFoundError("Share not found");
    }
    return share;
  }

  async addRecipients(
    shareId: string,
    userId: string,
    recipients: Array<{ email: string; name?: string | null }>,
  ) {
    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    await this.shareRepository.addRecipients(shareId, recipients);
    const updated = await this.shareRepository.findShareById(shareId);
    return ShareResponseSchema.parse(await this.formatShareResponse(updated));
  }

  async removeRecipients(shareId: string, userId: string, emails: string[]) {
    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    await this.shareRepository.removeRecipients(shareId, emails);
    const updated = await this.shareRepository.findShareById(shareId);
    return ShareResponseSchema.parse(await this.formatShareResponse(updated));
  }

  async createOrUpdateAlias(shareId: string, alias: string, userId: string) {
    const share = await this.findShareById(shareId);

    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    const existingAlias = await prisma.shareAlias.findUnique({
      where: { alias },
    });

    if (existingAlias && existingAlias.shareId !== shareId) {
      throw new ConflictError("Alias already in use");
    }

    const shareAlias = await prisma.shareAlias.upsert({
      where: { shareId },
      create: { shareId, alias },
      update: { alias },
    });

    return {
      ...shareAlias,
      createdAt: shareAlias.createdAt.toISOString(),
      updatedAt: shareAlias.updatedAt.toISOString(),
    };
  }

  async getShareByAlias(
    alias: string,
    password?: string,
    userId?: string,
    context?: ShareAccessContext,
  ) {
    const shareAlias = await prisma.shareAlias.findUnique({
      where: { alias },
      select: { shareId: true },
    });

    if (!shareAlias) {
      throw new NotFoundError("Share not found");
    }

    return this.getShare(shareAlias.shareId, password, userId, context);
  }

  async notifyRecipients(
    shareId: string,
    userId: string,
    selectedEmails?: string[],
  ): Promise<{ notifiedRecipients: string[] }> {
    const share = await this.shareRepository.findShareById(shareId);

    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to access this share");
    }

    if (!share.recipients || share.recipients.length === 0) {
      throw new ValidationError("No recipients found for this share");
    }

    // FIX 10: Empty selectedEmails array is nonsensical — "notify zero specific people"
    if (selectedEmails && selectedEmails.length === 0) {
      throw new ValidationError("selectedEmails must not be empty when provided");
    }

    // Filter to selected emails if provided (normalize for case-insensitive matching)
    let recipientsToNotify = share.recipients;
    if (selectedEmails?.length) {
      const emailSet = new Set(selectedEmails.map((e) => e.trim().toLowerCase()));
      recipientsToNotify = share.recipients.filter((r) => emailSet.has(r.email.toLowerCase()));

      // FIX 10: If selectedEmails were provided but none matched, report an error
      if (recipientsToNotify.length === 0) {
        throw new ValidationError("None of the selected emails match this share's recipients");
      }
    }

    // Build share link server-side (FIX 7: prevents phishing via client-supplied URLs)
    const shareAlias = share.alias?.alias;
    if (!shareAlias) {
      throw new ValidationError("Share must have an alias before sending notifications");
    }
    const baseShareLink = await buildShareLink(shareAlias);

    // Get sender info
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const senderName = user?.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : (user?.username ?? "Someone");

    const notifiedRecipients: string[] = [];

    // Sequential per-recipient to avoid SQLite contention. Acceptable at current scale.
    // For large recipient lists, consider Promise.allSettled with bounded concurrency.
    for (const recipient of recipientsToNotify) {
      // NOTE: email send + notifiedAt update are NOT wrapped in a transaction. On partial failure:
      // - Send without notifiedAt: email queued but UI shows "not notified" — acceptable since
      //   the email will be delivered and the user can re-trigger notification
      // SQLite's single-writer nature limits concurrent corruption risk.

      // Tracking tokens are generated at recipient creation time (createShare, addRecipients).
      const { trackingToken } = recipient;

      // Append tracking token to the base share link for personalized recipient tracking
      const personalizedLink = trackingToken
        ? `${baseShareLink}?t=${trackingToken}`
        : baseShareLink;
      try {
        // userId intentionally omitted — invitations are to external recipients who have no
        // account. Adding userId would trigger the preference cascade for a type that's not
        // configurable, which is unnecessary overhead.
        const result = await emailService.send("share_invitation", {
          to: recipient.email,
          // External recipients don't have an account, so we can't read their locale.
          // Use the sender's locale as the best available signal — it's more likely to be
          // correct for same-organization sharing than always defaulting to English.
          // Per-recipient locale requires adding a locale field to ShareRecipient model.
          locale: user?.locale ?? "en",
          relatedId: share.id,
          data: {
            senderName,
            shareName: share.name ?? "Shared files",
            shareLink: personalizedLink,
            hasPassword: !!share.security?.password,
            expiresAt: share.expiration?.toISOString(),
          },
        });

        if (result.enqueued) {
          // Track notification time only when email was actually enqueued
          await prisma.shareRecipient.update({
            where: { id: recipient.id },
            data: { notifiedAt: new Date() },
          });

          notifiedRecipients.push(recipient.email);
        }
      } catch (error) {
        getLogger().error(
          { err: error, email: recipient.email },
          "Failed to queue share invitation",
        );
      }
    }

    return { notifiedRecipients };
  }

  /**
   * Sends a manual download reminder (feature 8.3, lot B) to recipients who were already
   * notified but have NOT downloaded yet (`notifiedAt != null && lastDownloadedAt == null`).
   * A reminder is a follow-up to a prior invitation — a recipient who has never been notified
   * is not "reminded" (use the initial notify flow for those). There is no scheduler — this is
   * triggered by the share creator on demand.
   *
   * The pending set always mirrors the "Pending" badge (Batch 2 / I2 / R-6):
   * `recipients.filter(notifiedAt != null && lastDownloadedAt == null)`. An optional
   * `selectedEmails` filter narrows the set further, but is always intersected with the
   * pending set — a recipient who already downloaded (or was never notified) is never reminded,
   * even if passed explicitly. If no recipient is pending the call is a no-op
   * (`{ remindedRecipients: [] }`), not an error, so the UI can disable the button without
   * special-casing the response.
   *
   * Reuses the same personalized `?t=trackingToken` link building as {@link notifyRecipients}
   * and updates `notifiedAt` on successfully reminded recipients. The `share_download_reminder`
   * email type is sent WITHOUT `userId` (external recipients have no account/preference row).
   * SMTP gating happens inside `emailService.send`: when SMTP is off, nothing is enqueued and
   * the returned list is empty.
   */
  async remindNonDownloaders(
    shareId: string,
    userId: string,
    selectedEmails?: string[],
  ): Promise<{ remindedRecipients: string[] }> {
    const share = await this.shareRepository.findShareById(shareId);

    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to access this share");
    }

    if (!share.recipients || share.recipients.length === 0) {
      throw new ValidationError("No recipients found for this share");
    }

    if (selectedEmails && selectedEmails.length === 0) {
      throw new ValidationError("selectedEmails must not be empty when provided");
    }

    // Pending = recipients already notified who have not downloaded yet — mirrors the "Pending"
    // badge and the web "Remind (N)" count (Batch 2 / I2 / R-6). A reminder is a follow-up, so a
    // never-notified recipient is excluded here (the creator notifies them first instead).
    let pendingRecipients = share.recipients.filter(
      (r) => r.notifiedAt != null && r.lastDownloadedAt == null,
    );

    // Intersect with the optional subset filter; a downloaded recipient is never reminded.
    if (selectedEmails?.length) {
      const emailSet = new Set(selectedEmails.map((e) => e.trim().toLowerCase()));
      pendingRecipients = pendingRecipients.filter((r) => emailSet.has(r.email.toLowerCase()));
    }

    // No-op (not an error) when nobody is pending — the UI disables the button in this case.
    if (pendingRecipients.length === 0) {
      return { remindedRecipients: [] };
    }

    const shareAlias = share.alias?.alias;
    if (!shareAlias) {
      throw new ValidationError("Share must have an alias before sending reminders");
    }
    const baseShareLink = await buildShareLink(shareAlias);

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const senderName = user?.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : (user?.username ?? "Someone");

    const remindedRecipients: string[] = [];

    // Sequential per-recipient to avoid SQLite contention (same rationale as notifyRecipients).
    for (const recipient of pendingRecipients) {
      const { trackingToken } = recipient;
      const personalizedLink = trackingToken
        ? `${baseShareLink}?t=${trackingToken}`
        : baseShareLink;
      try {
        // userId intentionally omitted — external recipients have no account/preference row,
        // and share_download_reminder is non-configurable (cf. notifyRecipients rationale).
        const result = await emailService.send("share_download_reminder", {
          to: recipient.email,
          locale: user?.locale ?? "en",
          relatedId: share.id,
          data: {
            senderName,
            shareName: share.name ?? "Shared files",
            shareLink: personalizedLink,
            hasPassword: !!share.security?.password,
            expiresAt: share.expiration?.toISOString(),
          },
        });

        if (result.enqueued) {
          await prisma.shareRecipient.update({
            where: { id: recipient.id },
            data: { notifiedAt: new Date() },
          });

          remindedRecipients.push(recipient.email);
        }
      } catch (error) {
        getLogger().error(
          { err: error, email: recipient.email },
          "Failed to queue share download reminder",
        );
      }
    }

    return { remindedRecipients };
  }

  async getShareMetadataByAlias(alias: string) {
    const share = await this.shareRepository.findShareByAlias(alias);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    // Owner-inactive shares are treated as non-existent (R2 — A4-06): mirror the read path's
    // OWNER_INACTIVE gate, but for this lightweight/OG endpoint we return a flat 404 rather than
    // leaking that the alias exists at all.
    if (share.creator && share.creator.isActive === false) {
      throw new NotFoundError("Share not found");
    }

    // Compute lifecycle state from the DATE (A4-14), not only the persisted `isActive` flag, so a
    // not-yet-swept expired share still reports closed. `manual` pauses are reflected via isActive.
    const isExpired =
      (share.expiration ? new Date(share.expiration) < new Date() : false) ||
      (!share.isActive && share.deactivationReason === "expired");
    const isMaxViewsReached =
      (share.maxViews !== null ? share.views >= share.maxViews : false) ||
      (!share.isActive && share.deactivationReason === "max_views");
    const isPaused = !share.isActive && share.deactivationReason === "manual";
    const isClosed = isExpired || isMaxViewsReached || isPaused || !share.isActive;

    const totalFiles = share.files?.length || 0;
    const totalFolders = share.folders?.length || 0;
    const hasPassword = !!share.security.password;

    // Withhold name/description for closed shares (R2 — A4-06): the frontend only needs the
    // closed-state flags (isExpired / isMaxViewsReached / isActive) to render the right message;
    // it must not be able to read the share's title/description after it has been closed.
    return {
      name: isClosed ? null : share.name,
      description: isClosed ? null : share.description,
      totalFiles,
      totalFolders,
      hasPassword,
      isActive: share.isActive,
      isExpired,
      isMaxViewsReached,
      nameFieldRequired: share.nameFieldRequired,
      emailFieldRequired: share.emailFieldRequired,
    };
  }
}
