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
      };
    };
  };
}>;

export class ShareService {
  constructor(private readonly shareRepository: IShareRepository = new PrismaShareRepository()) {}
  private folderService = new FolderService();

  private async formatShareResponse(share: ShareWithRelations | null) {
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
      recipients:
        share.recipients?.map((recipient) => ({
          ...recipient,
          notifiedAt: recipient.notifiedAt?.toISOString() ?? null,
          lastAccessedAt: recipient.lastAccessedAt?.toISOString() ?? null,
          createdAt: recipient.createdAt.toISOString(),
          updatedAt: recipient.updatedAt.toISOString(),
        })) || [],
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

    // Check if identification is required before allowing access
    if (share.nameFieldRequired === "REQUIRED" || share.emailFieldRequired === "REQUIRED") {
      const hasTrackingToken = !!context?.trackingToken;
      const hasCookie = !!context?.visitorCookie;

      let tokenSatisfiesRequirements = false;
      if (hasTrackingToken) {
        const recipient = await prisma.shareRecipient.findUnique({
          where: { trackingToken: context!.trackingToken },
        });
        tokenSatisfiesRequirements =
          (share.nameFieldRequired !== "REQUIRED" || !!recipient?.name) &&
          (share.emailFieldRequired !== "REQUIRED" || !!recipient?.email);
      }

      if (!tokenSatisfiesRequirements && !hasCookie) {
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

    // Record visitor tracking for non-owner access
    let recipientId: string | undefined;
    let visitorName: string | undefined;
    let visitorEmail: string | undefined;

    if (context?.trackingToken) {
      const recipient = await prisma.shareRecipient.findUnique({
        where: { trackingToken: context.trackingToken },
      });
      if (recipient && recipient.shareId === share.id) {
        recipientId = recipient.id;
        visitorEmail = recipient.email;
        visitorName = recipient.name ?? undefined;
        // Update recipient access stats
        await prisma.shareRecipient.update({
          where: { id: recipient.id },
          data: { lastAccessedAt: new Date(), accessCount: { increment: 1 } },
        });
      }
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
    if (share.creatorId && share.creator?.email) {
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
            ipAddress: context?.ipAddress,
            accessedAt: new Date().toISOString(),
          },
        })
        .catch((err) => getLogger().error({ err }, "Failed to send share_accessed notification"));
    }

    // Update view count in memory to avoid a second DB round-trip
    const updatedShare = { ...share, views: share.views + 1 };
    return ShareResponseSchema.parse(await this.formatShareResponse(updatedShare));
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
      await prisma.$transaction(async (tx) => {
        const existing = await tx.shareRecipient.findMany({ where: { shareId } });
        const existingByEmail = new Map(existing.map((r) => [r.email, r]));
        const newEmailSet = new Set(recipients);

        // Remove recipients no longer in the list
        const toRemove = existing.filter((r) => !newEmailSet.has(r.email));
        if (toRemove.length > 0) {
          await tx.shareRecipient.deleteMany({
            where: { shareId, id: { in: toRemove.map((r) => r.id) } },
          });
        }

        // Add new recipients with tracking tokens
        const toAdd = recipients.filter((email) => !existingByEmail.has(email));
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

    // If expiration is being extended, reset notifiedForExpiration to allow re-notification
    if (shareData.expiration && share.expiration) {
      const newExp = new Date(shareData.expiration);
      if (newExp > share.expiration) {
        updateData.notifiedForExpiration = false;
      }
    }

    await this.shareRepository.updateShare(shareId, updateData);
    const shareWithRelations = await this.shareRepository.findShareById(shareId);

    return await this.formatShareResponse(shareWithRelations);
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

  async addRecipients(shareId: string, userId: string, emails: string[]) {
    const share = await this.shareRepository.findShareById(shareId);
    if (!share) {
      throw new NotFoundError("Share not found");
    }

    if (share.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this share");
    }

    await this.shareRepository.addRecipients(shareId, emails);
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
    shareLink: string,
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

    // Filter to selected emails if provided
    let recipientsToNotify = share.recipients;
    if (selectedEmails?.length) {
      const emailSet = new Set(selectedEmails);
      recipientsToNotify = share.recipients.filter((r) => emailSet.has(r.email));
    }

    // Get sender info
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const senderName = user?.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : (user?.username ?? "Someone");

    const notifiedRecipients: string[] = [];

    for (const recipient of recipientsToNotify) {
      // Ensure tracking token exists (backfill for pre-existing recipients)
      let trackingToken = recipient.trackingToken;
      if (!trackingToken) {
        trackingToken = crypto.randomBytes(24).toString("base64url");
        await prisma.shareRecipient.update({
          where: { id: recipient.id },
          data: { trackingToken },
        });
      }

      const personalizedLink = `${shareLink}?t=${trackingToken}`;
      try {
        await emailService.send("share_invitation", {
          to: recipient.email,
          locale: user?.locale ?? "en",
          data: {
            senderName,
            shareName: share.name ?? "Shared files",
            shareLink: personalizedLink,
            hasPassword: !!share.security?.password,
            expiresAt: share.expiration?.toISOString(),
          },
        });

        // Track notification time
        await prisma.shareRecipient.update({
          where: { id: recipient.id },
          data: { notifiedAt: new Date() },
        });

        notifiedRecipients.push(recipient.email);
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
