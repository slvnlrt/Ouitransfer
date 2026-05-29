import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { env } from "../../env.js";
import { prisma } from "../../shared/prisma.js";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { FileService } from "../file/service.js";
import {
  type CreateReverseShareInput,
  ReverseShareResponseSchema,
  type UpdateReverseShareInput,
} from "./dto.js";
import { ReverseShareRepository } from "./repository.js";

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

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
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

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
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

  async updateReverseShare(id: string, data: Partial<UpdateReverseShareInput>, creatorId: string) {
    const reverseShare = await this.reverseShareRepository.findById(id);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to update this reverse share");
    }

    // If expiration is being extended, include notification flag reset in the same update
    // to avoid a stale-read window between the two separate writes.
    const shouldResetNotifications =
      data.expiration &&
      reverseShare.expiration &&
      new Date(data.expiration) > reverseShare.expiration;

    const updateData = shouldResetNotifications
      ? { ...data, notifiedForExpiring: false, notifiedForExpired: false }
      : data;

    const updatedReverseShare = await this.reverseShareRepository.update(
      id,
      // biome-ignore lint/suspicious/noExplicitAny: notification flags are valid ReverseShare fields not in the DTO input type
      updateData as any,
    );

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

    const updatedReverseShare = await this.reverseShareRepository.update(id, { isActive: true });
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

    const updatedReverseShare = await this.reverseShareRepository.update(id, { isActive: false });
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
    };
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
      nameFieldRequired: reverseShare.nameFieldRequired,
      emailFieldRequired: reverseShare.emailFieldRequired,
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
