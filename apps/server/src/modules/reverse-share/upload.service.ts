import crypto from "node:crypto";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { env } from "../../env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { sanitizeFilename } from "../../utils/sanitize-filename.js";
import { isMimeTypeConsistent } from "../../utils/validate-file-content.js";
import { validateObjectName } from "../../utils/validate-object-name.js";
import { logAuditEvent } from "../audit/service.js";
import { EmailService } from "../email/service.js";
import { FileService } from "../file/service.js";
import { quotaService } from "../quota/service.js";
import { UserService } from "../user/service.js";
import type { UploadToReverseShareInput } from "./dto.js";
import { ReverseShareRepository } from "./repository.js";

type ReverseShareWithCreator = Prisma.ReverseShareGetPayload<{
  include: {
    creator: { select: { id: true; firstName: true; lastName: true; email: true } };
    files: true;
    alias: true;
  };
}>;

export class ReverseShareUploadService {
  private reverseShareRepository = new ReverseShareRepository();
  private fileService = new FileService();
  private emailService = new EmailService();
  private userService = new UserService();

  private uploadSessions = new Map<
    string,
    {
      reverseShareId: string;
      uploaderName: string;
      uploaderEmail?: string;
      files: string[];
      timeout: NodeJS.Timeout | null;
    }
  >();

  async getPresignedUrl(id: string, filename: string, extension: string, password?: string) {
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

    // Generate objectName server-side to prevent path injection / overwrite attacks
    const sanitizedFilename = sanitizeFilename(filename);
    const objectName = `reverse-shares/${id}/${Date.now()}-${crypto.randomUUID()}-${sanitizedFilename}.${extension}`;

    const expires = env.PRESIGNED_URL_EXPIRATION;

    // Import storage config to check if using internal or external S3
    const { isInternalStorage } = await import("../../config/storage.config.js");

    if (isInternalStorage) {
      // Internal storage: Use backend proxy for uploads (127.0.0.1 not accessible from client)
      // Note: This would need request context, but reverse-shares are typically used by external users
      // For now, we'll use presigned URLs and handle the error on the client side
      const url = await this.fileService.getPresignedPutUrl(objectName, expires);
      return { url, objectName, expiresIn: expires };
    } else {
      // External S3: Use presigned URLs directly (more efficient)
      const url = await this.fileService.getPresignedPutUrl(objectName, expires);
      return { url, objectName, expiresIn: expires };
    }
  }

  async getPresignedUrlByAlias(
    alias: string,
    filename: string,
    extension: string,
    password?: string,
  ) {
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

    // Generate objectName server-side to prevent path injection / overwrite attacks
    // Use the resolved reverseShare.id (not the alias) as the namespace
    const sanitizedFilename = sanitizeFilename(filename);
    const objectName = `reverse-shares/${reverseShare.id}/${Date.now()}-${crypto.randomUUID()}-${sanitizedFilename}.${extension}`;

    const expires = env.PRESIGNED_URL_EXPIRATION;

    // Import storage config to check if using internal or external S3
    const { isInternalStorage } = await import("../../config/storage.config.js");

    if (isInternalStorage) {
      // Internal storage: Use backend proxy for uploads (127.0.0.1 not accessible from client)
      // Note: This would need request context, but reverse-shares are typically used by external users
      // For now, we'll use presigned URLs and handle the error on the client side
      const url = await this.fileService.getPresignedPutUrl(objectName, expires);
      return { url, objectName, expiresIn: expires };
    } else {
      // External S3: Use presigned URLs directly (more efficient)
      const url = await this.fileService.getPresignedPutUrl(objectName, expires);
      return { url, objectName, expiresIn: expires };
    }
  }

  async registerFileUpload(
    reverseShareId: string,
    fileData: UploadToReverseShareInput,
    password?: string,
    context?: { ipAddress: string; userAgent?: string },
  ) {
    const reverseShare = await this.reverseShareRepository.findById(reverseShareId);
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

    // Layer 1: MIME/extension consistency check
    if (!isMimeTypeConsistent(fileData.mimeType, fileData.extension)) {
      throw new ValidationError("File type does not match the declared extension");
    }

    // Validate objectName belongs to this reverse share's namespace
    validateObjectName(fileData.objectName, `reverse-shares/${reverseShareId}`);

    if (reverseShare.maxFiles) {
      const currentFileCount =
        await this.reverseShareRepository.countFilesByReverseShareId(reverseShareId);
      if (currentFileCount >= reverseShare.maxFiles) {
        throw new ForbiddenError("Maximum number of files reached");
      }
    }

    if (reverseShare.maxFileSize && BigInt(fileData.size) > reverseShare.maxFileSize) {
      throw new ValidationError("File size exceeds limit");
    }

    if (reverseShare.allowedFileTypes) {
      const allowedTypes = reverseShare.allowedFileTypes
        .split(",")
        .map((type) => type.trim().toLowerCase());
      if (!allowedTypes.includes(fileData.extension.toLowerCase())) {
        throw new ValidationError("File type not allowed");
      }
    }

    const file = await this.reverseShareRepository.createFile(reverseShareId, {
      ...fileData,
      size: BigInt(fileData.size),
    });

    if (context) {
      logAuditEvent({
        action: "REVERSE_SHARE_UPLOAD",
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        targetType: "reverse_share",
        targetId: reverseShareId,
        metadata: {
          fileName: fileData.name,
          fileSize: fileData.size,
          uploaderEmail: fileData.uploaderEmail ?? undefined,
          uploaderName: fileData.uploaderName ?? undefined,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
    }

    this.addFileToUploadSession(reverseShare, fileData);

    return this.formatFileResponse(file);
  }

  async registerFileUploadByAlias(
    alias: string,
    fileData: UploadToReverseShareInput,
    password?: string,
    context?: { ipAddress: string; userAgent?: string },
  ) {
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

    // Layer 1: MIME/extension consistency check
    if (!isMimeTypeConsistent(fileData.mimeType, fileData.extension)) {
      throw new ValidationError("File type does not match the declared extension");
    }

    // Validate objectName belongs to this reverse share's namespace (use reverseShare.id, not alias)
    validateObjectName(fileData.objectName, `reverse-shares/${reverseShare.id}`);

    if (reverseShare.maxFiles) {
      const currentFileCount = await this.reverseShareRepository.countFilesByReverseShareId(
        reverseShare.id,
      );
      if (currentFileCount >= reverseShare.maxFiles) {
        throw new ForbiddenError("Maximum number of files reached");
      }
    }

    if (reverseShare.maxFileSize && BigInt(fileData.size) > reverseShare.maxFileSize) {
      throw new ValidationError("File size exceeds limit");
    }

    if (reverseShare.allowedFileTypes) {
      const allowedTypes = reverseShare.allowedFileTypes
        .split(",")
        .map((type) => type.trim().toLowerCase());
      if (!allowedTypes.includes(fileData.extension.toLowerCase())) {
        throw new ValidationError("File type not allowed");
      }
    }

    const file = await this.reverseShareRepository.createFile(reverseShare.id, {
      ...fileData,
      size: BigInt(fileData.size),
    });

    if (context) {
      logAuditEvent({
        action: "REVERSE_SHARE_UPLOAD",
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        targetType: "reverse_share",
        targetId: reverseShare.id,
        metadata: {
          fileName: fileData.name,
          fileSize: fileData.size,
          uploaderEmail: fileData.uploaderEmail ?? undefined,
          uploaderName: fileData.uploaderName ?? undefined,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
    }

    this.addFileToUploadSession(reverseShare, fileData);

    return this.formatFileResponse(file);
  }

  async copyReverseShareFileToUserFiles(fileId: string, creatorId: string) {
    const file = await this.reverseShareRepository.findFileById(fileId);
    if (!file) {
      throw new NotFoundError("File not found");
    }

    if (file.reverseShare.creatorId !== creatorId) {
      throw new ForbiddenError("Unauthorized to copy this file");
    }

    const limits = await quotaService.resolveEffectiveLimits(creatorId);

    // Per-file size check (skip if unlimited)
    if (limits.maxFileSize > 0n && file.size > limits.maxFileSize) {
      const maxSizeMB = Number(limits.maxFileSize) / (1024 * 1024);
      throw new AppError(
        400,
        `File size exceeds the maximum allowed size of ${maxSizeMB.toFixed(0)}MB`,
        ErrorCodes.FILE_SIZE_EXCEEDED,
        { maxSizeMB: maxSizeMB.toFixed(0) },
      );
    }

    // Total storage check (skip if unlimited)
    if (limits.maxTotalStorage > 0n) {
      const currentStorage = await quotaService.calculateStorageUsed(creatorId);
      if (currentStorage + file.size > limits.maxTotalStorage) {
        const availableSpace = Number(limits.maxTotalStorage - currentStorage) / (1024 * 1024);
        throw new AppError(
          400,
          `Insufficient storage space. You have ${availableSpace.toFixed(2)}MB available`,
          ErrorCodes.INSUFFICIENT_STORAGE,
          { availableSpaceMB: availableSpace.toFixed(2) },
        );
      }
    }

    const newObjectName = `${creatorId}/${Date.now()}-${file.name}`;

    // Copy file using S3 presigned URLs
    const fileSizeMB = Number(file.size) / (1024 * 1024);
    const _needsStreaming = fileSizeMB > 100;

    const downloadUrl = await this.fileService.getPresignedGetUrl(file.objectName, 300);
    const uploadUrl = await this.fileService.getPresignedPutUrl(newObjectName, 300);

    let retries = 0;
    const maxRetries = 3;
    let success = false;

    while (retries < maxRetries && !success) {
      try {
        const response = await fetch(downloadUrl, {
          signal: AbortSignal.timeout(600000), // 10 minutes timeout
        });

        if (!response.ok) {
          throw new Error(`Failed to download file: ${response.statusText}`);
        }

        if (!response.body) {
          throw new Error("No response body received");
        }

        const uploadOptions: RequestInit & { duplex: string } = {
          method: "PUT",
          body: response.body,
          duplex: "half",
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Length": file.size.toString(),
          },
          signal: AbortSignal.timeout(9600000), // 160 minutes timeout
        };

        const uploadResponse = await fetch(uploadUrl, uploadOptions);

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          throw new Error(`Failed to upload file: ${uploadResponse.statusText} - ${errorText}`);
        }

        success = true;
      } catch (error: unknown) {
        retries++;

        if (retries >= maxRetries) {
          const message = error instanceof Error ? error.message : String(error);
          getLogger().error({ maxRetries, error: message }, "File copy exhausted retries");
          throw new AppError(500, "File copy failed", ErrorCodes.COPY_FAILED);
        }

        const delay = Math.min(1000 * 2 ** (retries - 1), 10_000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    const newFileRecord = await prisma.file.create({
      data: {
        name: file.name,
        description: file.description || `Copied from: ${file.reverseShare.name || "Unnamed"}`,
        extension: file.extension,
        size: file.size,
        objectName: newObjectName,
        userId: creatorId,
      },
    });

    return {
      id: newFileRecord.id,
      name: newFileRecord.name,
      description: newFileRecord.description,
      extension: newFileRecord.extension,
      size: newFileRecord.size.toString(),
      objectName: newFileRecord.objectName,
      userId: newFileRecord.userId,
      createdAt: newFileRecord.createdAt.toISOString(),
      updatedAt: newFileRecord.updatedAt.toISOString(),
    };
  }

  private generateSessionKey(reverseShareId: string, uploaderIdentifier: string): string {
    return `${reverseShareId}-${uploaderIdentifier}`;
  }

  private async sendBatchFileUploadNotification(
    reverseShare: Pick<ReverseShareWithCreator, "creatorId" | "name">,
    uploaderName: string,
    fileNames: string[],
  ) {
    try {
      const creator = await this.userService.getUserById(reverseShare.creatorId);
      const reverseShareName = reverseShare.name || "Unnamed Reverse Share";
      const fileCount = fileNames.length;
      const fileList = fileNames.join(", ");

      await this.emailService.sendReverseShareBatchFileNotification(
        creator.email,
        reverseShareName,
        fileCount,
        fileList,
        uploaderName,
      );
    } catch (error) {
      getLogger().error({ err: error }, "Failed to send reverse share batch file notification");
    }
  }

  private addFileToUploadSession(
    reverseShare: Pick<ReverseShareWithCreator, "id" | "creatorId" | "name">,
    fileData: UploadToReverseShareInput,
  ) {
    const uploaderIdentifier = fileData.uploaderEmail || fileData.uploaderName || "anonymous";
    const sessionKey = this.generateSessionKey(reverseShare.id, uploaderIdentifier);
    const uploaderName = fileData.uploaderName || "Someone";

    const existingSession = this.uploadSessions.get(sessionKey);
    if (existingSession) {
      if (existingSession.timeout !== null) clearTimeout(existingSession.timeout);
      existingSession.files.push(fileData.name);
    } else {
      this.uploadSessions.set(sessionKey, {
        reverseShareId: reverseShare.id,
        uploaderName,
        uploaderEmail: fileData.uploaderEmail,
        files: [fileData.name],
        timeout: null,
      });
    }

    const session = this.uploadSessions.get(sessionKey)!;
    session.timeout = setTimeout(async () => {
      await this.sendBatchFileUploadNotification(reverseShare, session.uploaderName, session.files);
      this.uploadSessions.delete(sessionKey);
    }, 5000);
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
