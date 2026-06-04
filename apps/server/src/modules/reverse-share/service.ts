import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { env } from "../../env.js";
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
import { buildReverseShareUploadLink } from "../email/url-builder.js";
import { FileService } from "../file/service.js";
import { assertOwnerActive } from "./assert-owner-active.js";
import {
  type CreateReverseShareInput,
  ReverseShareResponseSchema,
  type UpdateReverseShareInput,
} from "./dto.js";
import { type ReverseShareInternalUpdate, ReverseShareRepository } from "./repository.js";

interface ReverseShareData {
  id: string;
  name: string | null;
  description: string | null;
  expiration: Date | null;
  maxFiles: number | null;
  maxFileSize: bigint | null;
  allowedFileTypes: string | null;
  password: string | null;
  pageLayout: string;
  backgroundImageId: string | null;
  isActive: boolean;
  nameFieldRequired: string;
  emailFieldRequired: string;
  notifyOnUpload: boolean;
  bypassUploadCooldown: boolean;
  createdAt: Date;
  updatedAt: Date;
  creatorId: string;
  files: Array<{
    id: string;
    name: string;
    description: string | null;
    extension: string;
    size: bigint;
    objectName: string;
    uploaderEmail: string | null;
    uploaderName: string | null;
    reverseShareId: string;
    createdAt: Date;
    updatedAt: Date;
  }>;
  alias?: {
    id: string;
    alias: string;
    reverseShareId: string;
    createdAt: Date;
    updatedAt: Date;
  } | null;
  recipients?: Array<{
    id: string;
    email: string;
    name: string | null;
    notifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
}

export class ReverseShareService {
  private reverseShareRepository = new ReverseShareRepository();
  private fileService = new FileService();

  async createReverseShare(data: CreateReverseShareInput, creatorId: string) {
    const reverseShare = await this.reverseShareRepository.create(data, creatorId);
    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(reverseShare));
  }

  async listUserReverseShares(creatorId: string) {
    const reverseShares = await this.reverseShareRepository.findByCreatorId(creatorId);

    const formatted = reverseShares.map((reverseShare: ReverseShareData) =>
      ReverseShareResponseSchema.parse(this.formatReverseShareResponse(reverseShare)),
    );

    return formatted;
  }

  async getReverseShareById(id: string, creatorId?: string) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (creatorId && reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to access this reverse share");
    }

    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(reverseShare));
  }

  async getReverseShareForUpload(id: string, password?: string) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (!reverseShare.isActive) {
      throw new AppError(403, "Reverse share is inactive", ErrorCodes.SHARE_INACTIVE);
    }

    // A6 deactivated-owner gate (single source of truth in assert-owner-active).
    assertOwnerActive(reverseShare);

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
      // Persist the expiry deactivation (Phase A.1) so the cleanup sweep can act,
      // then block. Fire-and-forget: read access must not fail if the write does.
      void this.reverseShareRepository
        .markExpiredInactive(reverseShare.id, new Date(reverseShare.expiration))
        .catch((err) => getLogger().error({ err }, "Failed to persist reverse-share expiry"));
      throw new AppError(410, "Reverse share has expired", ErrorCodes.SHARE_EXPIRED);
    }

    if (reverseShare.password) {
      if (!password) {
        throw new AppError(401, "Password required", ErrorCodes.PASSWORD_REQUIRED);
      }
      const isValidPassword = await this.reverseShareRepository.comparePassword(
        password,
        reverseShare.password,
      );
      if (!isValidPassword) {
        throw new AppError(401, "Invalid password", ErrorCodes.INVALID_PASSWORD);
      }
    }

    const currentFileCount = await this.reverseShareRepository.countFilesByReverseShareId(id);

    return {
      id: reverseShare.id,
      name: reverseShare.name,
      description: reverseShare.description,
      maxFiles: reverseShare.maxFiles,
      maxFileSize: reverseShare.maxFileSize ? Number(reverseShare.maxFileSize) : null,
      allowedFileTypes: reverseShare.allowedFileTypes,
      pageLayout: reverseShare.pageLayout,
      backgroundImageId: reverseShare.backgroundImageId,
      hasPassword: !!reverseShare.password,
      currentFileCount,
      nameFieldRequired: reverseShare.nameFieldRequired,
      emailFieldRequired: reverseShare.emailFieldRequired,
    };
  }

  async getReverseShareForUploadByAlias(alias: string, password?: string) {
    const reverseShare = await this.reverseShareRepository.findByAlias(alias);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (!reverseShare.isActive) {
      throw new AppError(403, "Reverse share is inactive", ErrorCodes.SHARE_INACTIVE);
    }

    // A6 deactivated-owner gate (single source of truth in assert-owner-active).
    assertOwnerActive(reverseShare);

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
      // Persist the expiry deactivation (Phase A.1) so the cleanup sweep can act,
      // then block. Fire-and-forget: read access must not fail if the write does.
      void this.reverseShareRepository
        .markExpiredInactive(reverseShare.id, new Date(reverseShare.expiration))
        .catch((err) => getLogger().error({ err }, "Failed to persist reverse-share expiry"));
      throw new AppError(410, "Reverse share has expired", ErrorCodes.SHARE_EXPIRED);
    }

    if (reverseShare.password) {
      if (!password) {
        throw new AppError(401, "Password required", ErrorCodes.PASSWORD_REQUIRED);
      }
      const isValidPassword = await this.reverseShareRepository.comparePassword(
        password,
        reverseShare.password,
      );
      if (!isValidPassword) {
        throw new AppError(401, "Invalid password", ErrorCodes.INVALID_PASSWORD);
      }
    }

    const currentFileCount = await this.reverseShareRepository.countFilesByReverseShareId(
      reverseShare.id,
    );

    return {
      id: reverseShare.id,
      name: reverseShare.name,
      description: reverseShare.description,
      maxFiles: reverseShare.maxFiles,
      maxFileSize: reverseShare.maxFileSize ? Number(reverseShare.maxFileSize) : null,
      allowedFileTypes: reverseShare.allowedFileTypes,
      pageLayout: reverseShare.pageLayout,
      backgroundImageId: reverseShare.backgroundImageId,
      hasPassword: !!reverseShare.password,
      currentFileCount,
      nameFieldRequired: reverseShare.nameFieldRequired,
      emailFieldRequired: reverseShare.emailFieldRequired,
    };
  }

  async updateReverseShare(
    id: string,
    data: Partial<UpdateReverseShareInput>,
    creatorId: string,
    context?: { ipAddress?: string; userAgent?: string },
  ) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to update this reverse share");
    }

    // If expiration is being added or extended, include notification flag reset in the same
    // update to avoid a stale-read window between the two separate writes. Setting an
    // expiration where there was none (oldExp null) also re-arms the warnings.
    const shouldResetNotifications =
      data.expiration &&
      (!reverseShare.expiration || new Date(data.expiration) > reverseShare.expiration);

    const updateData: Partial<UpdateReverseShareInput> & ReverseShareInternalUpdate = {
      ...data,
      ...(shouldResetNotifications && {
        notifiedForExpiring: false,
        notifiedForExpired: false,
        notifiedForPendingDeletion: false,
      }),
    };

    // Reactivation on extend (Phase A.1): mirror the regular-share behaviour. If the
    // reverse share is currently deactivated and the new expiration takes it back into
    // its valid window, bring it active again and clear the deactivation metadata.
    let reactivated = false;
    if (!reverseShare.isActive && data.expiration) {
      const newExpiration = new Date(data.expiration);
      if (newExpiration > new Date()) {
        updateData.isActive = true;
        updateData.deactivatedAt = null;
        updateData.deactivationReason = null;
        updateData.notifiedForPendingDeletion = false;
        reactivated = true;
      }
    }

    const updatedReverseShare = await this.reverseShareRepository.update(id, updateData);

    // A renew-via-extend that revives a deactivated reverse share is a lifecycle
    // transition, so it writes REVERSE_SHARE_REACTIVATED (with `via: "extend"`) on top
    // of the generic REVERSE_SHARE_UPDATE the route emits — mirroring the manual
    // `activateReverseShare` audit so every active⇄deactivated transition is recorded.
    if (reactivated) {
      logAuditEvent({
        action: "REVERSE_SHARE_REACTIVATED",
        userId: creatorId,
        ipAddress: context?.ipAddress ?? "system",
        userAgent: context?.userAgent,
        targetType: "reverse_share",
        targetId: id,
        metadata: { via: "extend" },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
    }

    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(updatedReverseShare));
  }

  async deleteReverseShare(id: string, creatorId: string) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to delete this reverse share");
    }

    for (const file of reverseShare.files) {
      try {
        await this.fileService.deleteObject(file.objectName);
      } catch (error) {
        getLogger().error({ err: error, objectName: file.objectName }, "Failed to delete file");
      }
    }

    const deletedReverseShare = await this.reverseShareRepository.delete(id);
    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(deletedReverseShare));
  }

  async getFileInfo(fileId: string, creatorId: string) {
    const file = await this.reverseShareRepository.findFileById(fileId);
    if (!file) {
      throw new NotFoundError("File not found");
    }

    if (file.reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to access this file");
    }

    return {
      id: file.id,
      name: file.name,
      size: file.size,
      objectName: file.objectName,
      extension: file.extension,
    };
  }

  async downloadReverseShareFile(
    fileId: string,
    creatorId: string,
    _requestContext?: { protocol: string; host: string },
  ) {
    const file = await this.reverseShareRepository.findFileById(fileId);
    if (!file) {
      throw new NotFoundError("File not found");
    }

    if (file.reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to download this file");
    }

    const fileName = file.name;
    const expires = env.PRESIGNED_GET_URL_EXPIRATION;

    // Import storage config to check if using internal or external S3
    const { isInternalStorage } = await import("../../config/storage.config.js");

    if (isInternalStorage) {
      // Internal storage: Use frontend proxy (much simpler!)
      const url = `/api/files/download?objectName=${encodeURIComponent(file.objectName)}`;
      return { url, expiresIn: expires };
    } else {
      // External S3: Use presigned URLs directly (more efficient, no backend proxy)
      const url = await this.fileService.getPresignedGetUrl(file.objectName, expires, fileName);
      return { url, expiresIn: expires };
    }
  }

  async deleteReverseShareFile(fileId: string, creatorId: string) {
    const file = await this.reverseShareRepository.findFileById(fileId);
    if (!file) {
      throw new NotFoundError("File not found");
    }

    if (file.reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to delete this file");
    }

    await this.fileService.deleteObject(file.objectName);

    const deletedFile = await this.reverseShareRepository.deleteFile(fileId);
    return this.formatFileResponse(deletedFile);
  }

  /** Resolve the DB id for a reverse share from its alias. Returns null if not found. */
  async getIdByAlias(alias: string): Promise<string | null> {
    const reverseShare = await this.reverseShareRepository.findByAlias(alias);
    return reverseShare?.id ?? null;
  }

  async checkPassword(id: string, password: string) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (!reverseShare.password) {
      return { valid: true };
    }

    const isValid = await this.reverseShareRepository.comparePassword(
      password,
      reverseShare.password,
    );
    return { valid: isValid };
  }

  async updatePassword(id: string, password: string | null, creatorId: string) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to update this reverse share");
    }

    const updatedReverseShare = await this.reverseShareRepository.update(id, { password });
    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(updatedReverseShare));
  }

  async activateReverseShare(id: string, creatorId: string) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to activate this reverse share");
    }

    // Phase A.1: reactivating clears the deactivation metadata and re-arms the
    // pending-deletion warning, mirroring the regular-share resume. The audit event
    // (REVERSE_SHARE_REACTIVATED) is emitted by the route with the real request IP.
    const updatedReverseShare = await this.reverseShareRepository.update(id, {
      isActive: true,
      deactivatedAt: null,
      deactivationReason: null,
      notifiedForPendingDeletion: false,
    });

    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(updatedReverseShare));
  }

  async deactivateReverseShare(id: string, creatorId: string) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to deactivate this reverse share");
    }

    // Phase A.1: a manual deactivation stamps reason `manual` so the cleanup sweep
    // never auto-deletes it (the owner chose to pause it, not retire it). The audit
    // event (REVERSE_SHARE_DEACTIVATED) is emitted by the route with the real request IP.
    const updatedReverseShare = await this.reverseShareRepository.update(id, {
      isActive: false,
      deactivatedAt: new Date(),
      deactivationReason: "manual",
    });

    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(updatedReverseShare));
  }

  async createOrUpdateAlias(reverseShareId: string, alias: string, userId: string) {
    const reverseShare = await this.reverseShareRepository.findById(reverseShareId);

    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (reverseShare.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this reverse share");
    }

    const existingAlias = await prisma.reverseShareAlias.findUnique({
      where: { alias },
    });

    if (existingAlias && existingAlias.reverseShareId !== reverseShareId) {
      throw new ConflictError("Alias already in use");
    }

    const reverseShareAlias = await prisma.reverseShareAlias.upsert({
      where: { reverseShareId },
      create: { reverseShareId, alias },
      update: { alias },
    });

    return {
      ...reverseShareAlias,
      createdAt: reverseShareAlias.createdAt.toISOString(),
      updatedAt: reverseShareAlias.updatedAt.toISOString(),
    };
  }

  async updateReverseShareFile(
    fileId: string,
    data: { name?: string; description?: string | null },
    creatorId: string,
  ) {
    const file = await this.reverseShareRepository.findFileById(fileId);
    if (!file) {
      throw new NotFoundError("File not found");
    }

    if (file.reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to edit this file");
    }

    const updateData = { ...data };
    if (data.name) {
      const originalExtension = file.extension;
      const nameWithoutExtension = data.name.replace(/\.[^/.]+$/, "");
      const extensionWithDot = originalExtension.startsWith(".")
        ? originalExtension
        : `.${originalExtension}`;
      updateData.name = `${nameWithoutExtension}${extensionWithDot}`;
    }

    const updatedFile = await this.reverseShareRepository.updateFile(fileId, updateData);
    return this.formatFileResponse(updatedFile);
  }

  async getReverseShareMetadataByAlias(alias: string) {
    const reverseShare = await this.reverseShareRepository.findByAlias(alias);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    // Check if reverse share is expired
    const isExpired = reverseShare.expiration
      ? new Date(reverseShare.expiration) < new Date()
      : false;

    // Check if inactive
    const isInactive = !reverseShare.isActive;

    const totalFiles = reverseShare.files?.length || 0;
    const hasPassword = !!reverseShare.password;

    return {
      name: reverseShare.name,
      description: reverseShare.description,
      totalFiles,
      hasPassword,
      isExpired,
      isInactive,
      maxFiles: reverseShare.maxFiles,
      nameFieldRequired: reverseShare.nameFieldRequired,
      emailFieldRequired: reverseShare.emailFieldRequired,
    };
  }

  async addRecipients(
    reverseShareId: string,
    userId: string,
    recipients: Array<{ email: string; name?: string }>,
  ) {
    const reverseShare = await this.reverseShareRepository.findById(reverseShareId);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }
    if (reverseShare.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this reverse share");
    }

    try {
      await this.reverseShareRepository.addRecipients(reverseShareId, recipients);
    } catch (error: unknown) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: string }).code === "P2002"
      ) {
        throw new ConflictError("One or more recipients already exist on this reverse share");
      }
      throw error;
    }
    const updated = await this.reverseShareRepository.findById(reverseShareId);
    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(updated!));
  }

  async removeRecipients(reverseShareId: string, userId: string, emails: string[]) {
    const reverseShare = await this.reverseShareRepository.findById(reverseShareId);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }
    if (reverseShare.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to update this reverse share");
    }

    await this.reverseShareRepository.removeRecipients(reverseShareId, emails);
    const updated = await this.reverseShareRepository.findById(reverseShareId);
    return ReverseShareResponseSchema.parse(this.formatReverseShareResponse(updated!));
  }

  async notifyRecipients(
    reverseShareId: string,
    userId: string,
    selectedEmails?: string[],
  ): Promise<{ notifiedRecipients: string[] }> {
    const reverseShare = await this.reverseShareRepository.findById(reverseShareId);

    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (reverseShare.creatorId !== userId) {
      throw new ForbiddenError("Unauthorized to access this reverse share");
    }

    if (!reverseShare.recipients || reverseShare.recipients.length === 0) {
      throw new ValidationError("No recipients found for this reverse share");
    }

    if (selectedEmails && selectedEmails.length === 0) {
      throw new ValidationError("selectedEmails must not be empty when provided");
    }

    // Filter to selected emails if provided
    let recipientsToNotify = reverseShare.recipients;
    if (selectedEmails?.length) {
      const emailSet = new Set(selectedEmails.map((e) => e.trim().toLowerCase()));
      recipientsToNotify = reverseShare.recipients.filter((r) =>
        emailSet.has(r.email.toLowerCase()),
      );

      if (recipientsToNotify.length === 0) {
        throw new ValidationError(
          "None of the selected emails match this reverse share's recipients",
        );
      }
    }

    // Build upload link server-side
    const reverseShareAlias = reverseShare.alias?.alias;
    if (!reverseShareAlias) {
      throw new ValidationError("Reverse share must have an alias before sending notifications");
    }
    const reverseShareLink = await buildReverseShareUploadLink(reverseShareAlias);

    // Get sender info
    const user = await prisma.user.findUnique({ where: { id: userId } });
    const senderName = user?.firstName
      ? `${user.firstName} ${user.lastName ?? ""}`.trim()
      : (user?.username ?? "Someone");

    const notifiedRecipients: string[] = [];

    for (const recipient of recipientsToNotify) {
      try {
        const result = await emailService.send("reverse_share_invitation", {
          to: recipient.email,
          locale: user?.locale ?? "en",
          relatedId: reverseShare.id,
          data: {
            senderName,
            reverseShareName: reverseShare.name ?? "File upload request",
            reverseShareLink,
            hasPassword: !!reverseShare.password,
            expiresAt: reverseShare.expiration?.toISOString(),
          },
        });

        if (result.enqueued) {
          await prisma.reverseShareRecipient.update({
            where: { id: recipient.id },
            data: { notifiedAt: new Date() },
          });

          notifiedRecipients.push(recipient.email);
        }
      } catch (error) {
        getLogger().error(
          { err: error, email: recipient.email },
          "Failed to queue reverse share invitation",
        );
      }
    }

    return { notifiedRecipients };
  }

  private formatReverseShareResponse(reverseShare: ReverseShareData) {
    const result = {
      id: reverseShare.id,
      name: reverseShare.name,
      description: reverseShare.description,
      expiration: reverseShare.expiration?.toISOString() || null,
      maxFiles: reverseShare.maxFiles,
      maxFileSize: reverseShare.maxFileSize ? Number(reverseShare.maxFileSize) : null,
      allowedFileTypes: reverseShare.allowedFileTypes,
      pageLayout: reverseShare.pageLayout,
      backgroundImageId: reverseShare.backgroundImageId,
      isActive: reverseShare.isActive,
      hasPassword: !!reverseShare.password,
      createdAt: reverseShare.createdAt.toISOString(),
      updatedAt: reverseShare.updatedAt.toISOString(),
      creatorId: reverseShare.creatorId,
      files: (reverseShare.files || []).map((file) => ({
        id: file.id,
        name: file.name,
        description: file.description,
        extension: file.extension,
        size: file.size.toString(),
        objectName: file.objectName,
        uploaderEmail: file.uploaderEmail,
        uploaderName: file.uploaderName,
        reverseShareId: file.reverseShareId,
        createdAt: file.createdAt.toISOString(),
        updatedAt: file.updatedAt.toISOString(),
      })),
      alias: reverseShare.alias
        ? {
            id: reverseShare.alias.id,
            alias: reverseShare.alias.alias,
            reverseShareId: reverseShare.alias.reverseShareId,
            createdAt: reverseShare.alias.createdAt.toISOString(),
            updatedAt: reverseShare.alias.updatedAt.toISOString(),
          }
        : null,
      recipients: (reverseShare.recipients || []).map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        notifiedAt: r.notifiedAt?.toISOString() || null,
        createdAt: r.createdAt.toISOString(),
      })),
      nameFieldRequired: reverseShare.nameFieldRequired,
      emailFieldRequired: reverseShare.emailFieldRequired,
      notifyOnUpload: reverseShare.notifyOnUpload,
      bypassUploadCooldown: reverseShare.bypassUploadCooldown,
    };

    return result;
  }

  private formatFileResponse(file: {
    id: string;
    name: string;
    description: string | null;
    extension: string;
    size: bigint;
    objectName: string;
    uploaderEmail: string | null;
    uploaderName: string | null;
    reverseShareId: string;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: file.id,
      name: file.name,
      description: file.description,
      extension: file.extension,
      size: file.size.toString(),
      objectName: file.objectName,
      uploaderEmail: file.uploaderEmail,
      uploaderName: file.uploaderName,
      reverseShareId: file.reverseShareId,
      createdAt: file.createdAt.toISOString(),
      updatedAt: file.updatedAt.toISOString(),
    };
  }
}
