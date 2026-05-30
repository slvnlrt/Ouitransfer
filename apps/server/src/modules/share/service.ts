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
import { emailService } from "../email/service.js";
import { buildShareLink, buildShareManageUrl } from "../email/url-builder.js";
import { FolderService } from "../folder/service.js";
import { type CreateShareInput, ShareResponseSchema, type UpdateShareInput } from "./dto.js";
import { type IShareRepository, PrismaShareRepository } from "./repository.js";

export interface ShareAccessContext {
  trackingToken?: string;
  visitorCookie?: { name?: string; email?: string; alias?: string };
  ipAddress?: string;
  userAgent?: string;
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
      security: {
        hasPassword: !!share.security.password,
      },
      files:
        share.files?.map((file) => ({
          ...file,
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
          }),
      // Strip creator from response (internal use only)
      creator: undefined,
    };
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

    if ((!files || files.length === 0) && (!folders || folders.length === 0)) {
      throw new ValidationError("At least one file or folder must be selected to create a share");
    }

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
      return ShareResponseSchema.parse(await this.formatShareResponse(share));
    }

    if (share.expiration && new Date() > new Date(share.expiration)) {
      throw new AppError(410, "Share has expired", ErrorCodes.SHARE_EXPIRED);
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

    const incremented = await this.shareRepository.incrementViewsAtomic(
      shareId,
      share.maxViews ?? null,
    );
    if (!incremented) {
      throw new AppError(410, "Share has reached maximum views", ErrorCodes.MAX_VIEWS_REACHED);
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

    if (resolvedRecipient) {
      recipientId = resolvedRecipient.id;
      visitorEmail = resolvedRecipient.email;
      visitorName = resolvedRecipient.name ?? undefined;
      // Update recipient access stats
      await prisma.shareRecipient.update({
        where: { id: resolvedRecipient.id },
        data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
      });
    }

    // Or from identification cookie (Batch 9 will wire this)
    if (!recipientId && context?.visitorCookie) {
      visitorName = context.visitorCookie.name;
      visitorEmail = context.visitorCookie.email;
    }

    // Fire and forget — don't block the response
    prisma.shareVisit
      .create({
        data: {
          shareId: share.id,
          recipientId,
          visitorName,
          visitorEmail,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          action: "access",
        },
      })
      .catch((err) => getLogger().error({ err }, "Failed to create ShareVisit"));

    // Trigger share_accessed notification (fire-and-forget)
    // Skip notification when creator account is deactivated (consistent with scheduler checks)
    if (share.creatorId && share.creator?.email && share.creator?.isActive !== false) {
      emailService
        .send("share_accessed", {
          to: share.creator.email,
          locale: share.creator.locale ?? "en",
          userId: share.creatorId,
          shareId: share.id,
          data: {
            shareName: share.name ?? "Unnamed share",
            visitorName,
            visitorEmail,
            accessedAt: new Date().toISOString(),
          },
        })
        .catch((err) => getLogger().error({ err }, "Failed to send share_accessed notification"));
    }

    // Trigger share_max_views_reached notification when the share just hit its limit
    const newViewCount = share.views + 1;
    if (
      share.maxViews !== null &&
      newViewCount >= share.maxViews &&
      !share.notifiedForMaxViews &&
      share.creatorId &&
      share.creator?.email &&
      share.creator?.isActive !== false
    ) {
      // Set flag first to prevent duplicate sends (fire-and-forget)
      prisma.share
        .update({
          where: { id: shareId },
          data: { notifiedForMaxViews: true },
        })
        .then(() =>
          buildShareManageUrl(shareId).then((shareManageUrl) =>
            emailService
              .send("share_max_views_reached", {
                to: share.creator!.email,
                locale: share.creator!.locale ?? "en",
                userId: share.creatorId!,
                relatedId: shareId,
                data: {
                  shareName: share.name ?? "Unnamed share",
                  maxViews: share.maxViews!,
                  shareManageUrl,
                },
              })
              .catch((err) =>
                getLogger().error({ err }, "Failed to send share_max_views_reached notification"),
              ),
          ),
        )
        .catch((err) => getLogger().error({ err }, "Failed to update notifiedForMaxViews flag"));
    }

    // Update view count in memory to avoid a second DB round-trip
    const updatedShare = { ...share, views: newViewCount };
    return ShareResponseSchema.parse(await this.formatShareResponse(updatedShare, false));
  }

  async updateShare(shareId: string, data: Omit<UpdateShareInput, "id">, userId: string) {
    const { password, maxViews, recipients, ...shareData } = data;

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
      // Normalize emails for consistent matching
      const normalizedRecipients = recipients.map((e) => e.trim().toLowerCase());

      await prisma.$transaction(async (tx) => {
        const existing = await tx.shareRecipient.findMany({ where: { shareId } });
        const existingByEmail = new Map(existing.map((r) => [r.email, r]));
        const newEmailSet = new Set(normalizedRecipients);

        // Remove recipients no longer in the list
        const toRemove = existing.filter((r) => !newEmailSet.has(r.email));
        if (toRemove.length > 0) {
          await tx.shareRecipient.deleteMany({
            where: { shareId, id: { in: toRemove.map((r) => r.id) } },
          });
        }

        // Add new recipients with tracking tokens
        const toAdd = normalizedRecipients.filter((email) => !existingByEmail.has(email));
        for (const email of toAdd) {
          const trackingToken = crypto.randomBytes(24).toString("base64url");
          await tx.shareRecipient.create({ data: { shareId, email, trackingToken } });
        }
        // Existing recipients are untouched — tokens, notifiedAt, stats preserved
      });
    }

    const updateData: Partial<Parameters<typeof this.shareRepository.updateShare>[1]> = {
      ...shareData,
      maxViews: maxViews !== undefined ? maxViews : undefined,
      expiration: shareData.expiration ? new Date(shareData.expiration) : null,
    };

    // Reset notification flags when expiration is added or extended (allows re-notification)
    const newExp = shareData.expiration ? new Date(shareData.expiration) : null;
    const oldExp = share.expiration;
    if (newExp && (!oldExp || newExp > oldExp)) {
      updateData.notifiedForExpiring = false;
      updateData.notifiedForExpired = false;
    }

    // Reset maxViews notification flag when maxViews is increased (allows re-notification)
    if (maxViews !== undefined) {
      const oldMax = share.maxViews;
      if (maxViews === null || (oldMax !== null && maxViews > oldMax)) {
        updateData.notifiedForMaxViews = false;
      }
    }

    await this.shareRepository.updateShare(shareId, updateData);
    const shareWithRelations = await this.shareRepository.findShareById(shareId);

    return ShareResponseSchema.parse(await this.formatShareResponse(shareWithRelations));
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
      const existingFiles = await this.shareRepository.findFilesByIds(fileIds);
      const notFoundFiles = fileIds.filter((id) => !existingFiles.some((file) => file.id === id));

      if (notFoundFiles.length > 0) {
        throw new NotFoundError(`Files not found: ${notFoundFiles.join(", ")}`);
      }

      await this.shareRepository.addFilesToShare(shareId, fileIds);
    }

    if (folderIds.length > 0) {
      const existingFolders = await this.shareRepository.findFoldersByIds(folderIds);
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

  async getShareMetadataByAlias(alias: string) {
    const share = await this.shareRepository.findShareByAlias(alias);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    // Check if share is expired
    const isExpired = share.expiration ? new Date(share.expiration) < new Date() : false;

    // Check if max views reached
    const isMaxViewsReached = share.maxViews !== null ? share.views >= share.maxViews : false;

    const totalFiles = share.files?.length || 0;
    const totalFolders = share.folders?.length || 0;
    const hasPassword = !!share.security.password;

    return {
      name: share.name,
      description: share.description,
      totalFiles,
      totalFolders,
      hasPassword,
      isExpired,
      isMaxViewsReached,
      nameFieldRequired: share.nameFieldRequired,
      emailFieldRequired: share.emailFieldRequired,
    };
  }
}
