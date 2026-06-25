import crypto from "node:crypto";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { env } from "../../env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { sanitizeFilename } from "../../utils/sanitize-filename.js";
import { assertUploadedContentValid } from "../../utils/validate-file-content.js";
import { validateObjectName } from "../../utils/validate-object-name.js";
import { logAuditEvent } from "../audit/service.js";
import { getConfigValue } from "../config/service.js";
import { emailService } from "../email/service.js";
import { FileService } from "../file/service.js";
import { quotaService } from "../quota/service.js";
import { assertOwnerActive } from "./assert-owner-active.js";
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

  private uploadSessions = new Map<
    string,
    {
      reverseShareId: string;
      reverseShareCreatorId: string;
      reverseShareName: string | null;
      uploaderName: string | null;
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

    // A6 deactivated-owner gate (single source of truth in assert-owner-active).
    assertOwnerActive(reverseShare);

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
      // Persist the expiry deactivation (Phase A.1) so the cleanup sweep can act,
      // then block. Fire-and-forget: the upload entry point must not fail if the write does.
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

    // A6 deactivated-owner gate (single source of truth in assert-owner-active).
    assertOwnerActive(reverseShare);

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
      // Persist the expiry deactivation (Phase A.1) so the cleanup sweep can act,
      // then block. Fire-and-forget: the upload entry point must not fail if the write does.
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

    // A6 deactivated-owner gate (single source of truth in assert-owner-active).
    assertOwnerActive(reverseShare);

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
      // Persist the expiry deactivation (Phase A.1) so the cleanup sweep can act,
      // then block. Fire-and-forget: the upload entry point must not fail if the write does.
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

    // Validate objectName belongs to this reverse share's namespace (do this
    // first so content validation only ever reads an in-namespace key).
    validateObjectName(fileData.objectName, `reverse-shares/${reverseShareId}`);

    // Full two-layer content validation (A3-02), matching the direct-upload path:
    // dangerous-extension denylist + MIME/extension consistency + magic-byte
    // verification, failing closed on an unverifiable/missing object.
    await assertUploadedContentValid(
      {
        objectName: fileData.objectName,
        extension: fileData.extension,
        mimeType: fileData.mimeType,
      },
      (key) => this.fileService.getObjectHead(key),
      getLogger(),
    );

    // Reconcile the client-declared size against the real stored object size
    // (A3-08) so quota/maxFileSize cannot be defeated with an understated size.
    const uploadSize = await this.fileService.getObjectSize(fileData.objectName);
    if (BigInt(fileData.size) !== uploadSize) {
      throw new ValidationError("Declared file size does not match the uploaded object");
    }

    if (reverseShare.maxFiles) {
      const currentFileCount =
        await this.reverseShareRepository.countFilesByReverseShareId(reverseShareId);
      if (currentFileCount >= reverseShare.maxFiles) {
        throw new ForbiddenError("Maximum number of files reached");
      }
    }

    if (reverseShare.maxFileSize && uploadSize > reverseShare.maxFileSize) {
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

    // B3 owner-quota enforcement (soft by default; hard when disabled).
    const usedBefore = await this.enforceReverseShareQuota(reverseShare.creatorId, uploadSize);

    const file = await this.reverseShareRepository.createFile(reverseShareId, {
      ...fileData,
      size: uploadSize,
    });

    // 8.3 lot D: best-effort per-recipient upload tracking. Fire-and-forget —
    // a self-declared uploaderEmail matching a known recipient bumps that
    // recipient's stats. Never blocks or breaks the upload.
    this.trackRecipientUpload(reverseShareId, fileData.uploaderEmail);

    // B1 threshold warnings: evaluate the owner's usage transition after the
    // file exists. Fire-and-forget — never blocks the upload, never throws.
    // When the upload lands the owner in the overage zone (allowed but over the
    // limit), evaluateAndNotifyQuota emits quota_exceeded + admin_quota_alert
    // once, deduped by quotaExceededSince.
    if (usedBefore !== null) {
      void quotaService.evaluateAndNotifyQuota(reverseShare.creatorId, {
        oldUsed: usedBefore,
        newUsed: usedBefore + uploadSize,
      });
    }

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

    // A6 deactivated-owner gate (single source of truth in assert-owner-active).
    assertOwnerActive(reverseShare);

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
      // Persist the expiry deactivation (Phase A.1) so the cleanup sweep can act,
      // then block. Fire-and-forget: the upload entry point must not fail if the write does.
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

    // Validate objectName belongs to this reverse share's namespace (use
    // reverseShare.id, not alias) before reading its content.
    validateObjectName(fileData.objectName, `reverse-shares/${reverseShare.id}`);

    // Full two-layer content validation (A3-02), matching the direct-upload path.
    await assertUploadedContentValid(
      {
        objectName: fileData.objectName,
        extension: fileData.extension,
        mimeType: fileData.mimeType,
      },
      (key) => this.fileService.getObjectHead(key),
      getLogger(),
    );

    // Reconcile the client-declared size against the real stored object size (A3-08).
    const uploadSize = await this.fileService.getObjectSize(fileData.objectName);
    if (BigInt(fileData.size) !== uploadSize) {
      throw new ValidationError("Declared file size does not match the uploaded object");
    }

    if (reverseShare.maxFiles) {
      const currentFileCount = await this.reverseShareRepository.countFilesByReverseShareId(
        reverseShare.id,
      );
      if (currentFileCount >= reverseShare.maxFiles) {
        throw new ForbiddenError("Maximum number of files reached");
      }
    }

    if (reverseShare.maxFileSize && uploadSize > reverseShare.maxFileSize) {
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

    // B3 owner-quota enforcement (soft by default; hard when disabled).
    const usedBefore = await this.enforceReverseShareQuota(reverseShare.creatorId, uploadSize);

    const file = await this.reverseShareRepository.createFile(reverseShare.id, {
      ...fileData,
      size: uploadSize,
    });

    // 8.3 lot D: best-effort per-recipient upload tracking. Fire-and-forget —
    // a self-declared uploaderEmail matching a known recipient bumps that
    // recipient's stats. Never blocks or breaks the upload.
    this.trackRecipientUpload(reverseShare.id, fileData.uploaderEmail);

    // B1 threshold warnings: evaluate the owner's usage transition after the
    // file exists. Fire-and-forget — never blocks the upload, never throws.
    if (usedBefore !== null) {
      void quotaService.evaluateAndNotifyQuota(reverseShare.creatorId, {
        oldUsed: usedBefore,
        newUsed: usedBefore + uploadSize,
      });
    }

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

  /**
   * Enforce the owner's storage quota for an **external** reverse-share upload
   * (5.2 Phase B B3) and return the owner's usage *before* this upload so the
   * caller can drive the B1 warning evaluation afterward.
   *
   * - Unlimited owner quota (`0n`) ⇒ no limit; returns `null` (no warning state
   *   to track, no usage computed).
   * - When `reverseShareQuotaSoftEnforcement` is ON, external uploads are
   *   tolerated past 100% up to `min(limit × factor, absoluteCap)` via
   *   {@link QuotaService.isReverseUploadAllowed}; blocked beyond that.
   * - When OFF, the historical hard block applies (`used + size <= limit`).
   *
   * Direct uploads (the owner's own files) are NOT routed through here — they
   * keep hard enforcement in `file/routes.ts`.
   *
   * @throws {AppError} 400 `INSUFFICIENT_STORAGE` when the upload is not allowed.
   * @returns the owner's `usedBefore` byte count, or `null` for unlimited owners.
   */
  private async enforceReverseShareQuota(creatorId: string, size: bigint): Promise<bigint | null> {
    const limits = await quotaService.resolveEffectiveLimits(creatorId);
    const limit = limits.maxTotalStorage;
    // Unlimited owner ⇒ no quota tracking for reverse uploads.
    if (limit <= 0n) return null;

    const usedBefore = await quotaService.calculateStorageUsed(creatorId);

    const softEnforcement = (await getConfigValue("reverseShareQuotaSoftEnforcement")) === "true";

    let allowed: boolean;
    if (softEnforcement) {
      const factor = Number(await getConfigValue("reverseShareMaxOverageFactor"));
      const capBytes = BigInt(await getConfigValue("reverseShareAbsoluteMaxBytes"));
      allowed = quotaService.isReverseUploadAllowed(
        usedBefore,
        size,
        limit,
        Number.isFinite(factor) && factor >= 1 ? factor : 1,
        capBytes,
      );
    } else {
      // Hard block (today's behavior): refuse once the limit would be exceeded.
      allowed = usedBefore + size <= limit;
    }

    if (!allowed) {
      const availableSpace = Number(limit - usedBefore) / (1024 * 1024);
      throw new AppError(
        400,
        `Insufficient storage space. You have ${availableSpace.toFixed(2)}MB available`,
        ErrorCodes.INSUFFICIENT_STORAGE,
        { availableSpaceMB: availableSpace.toFixed(2) },
      );
    }

    return usedBefore;
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

  /**
   * Best-effort per-recipient upload tracking (8.3 lot D).
   *
   * If the upload self-declares an `uploaderEmail` that matches a known recipient
   * of this reverse share, bump that recipient's `uploadCount` and stamp
   * `uploadedAt` on the first match (see {@link ReverseShareRepository.trackRecipientUpload}).
   *
   * Fire-and-forget and failure-tolerant: this MUST NOT block or break the upload.
   * `uploaderEmail` is optional (`emailFieldRequired` defaults to OPTIONAL), so for
   * most uploads this is a no-op. When present, the email is normalized (trim +
   * lowercase) to match how recipients are stored. The attribution is self-declared
   * and unverified (spoofable) — that is accepted; the UI labels it as approximate.
   */
  private trackRecipientUpload(reverseShareId: string, uploaderEmail?: string): void {
    if (!uploaderEmail) return;
    const normalizedEmail = uploaderEmail.trim().toLowerCase();
    if (!normalizedEmail) return;
    void this.reverseShareRepository
      .trackRecipientUpload(reverseShareId, normalizedEmail)
      .catch((err) => getLogger().error({ err }, "Failed to track reverse-share recipient upload"));
  }

  private generateSessionKey(reverseShareId: string, uploaderIdentifier: string): string {
    return `${reverseShareId}-${uploaderIdentifier}`;
  }

  private async sendBatchFileUploadNotification(
    reverseShare: Pick<ReverseShareWithCreator, "id" | "creatorId" | "name">,
    uploaderName: string | null,
    fileNames: string[],
    uploaderEmail?: string,
  ) {
    try {
      const creator = await prisma.user.findUnique({
        where: { id: reverseShare.creatorId },
        select: { id: true, email: true, locale: true, isActive: true },
      });
      if (!creator) {
        getLogger().warn(
          { creatorId: reverseShare.creatorId },
          "Reverse share creator not found, skipping notification",
        );
        return;
      }
      // Skip notification when creator account is deactivated (consistent with scheduler checks)
      if (creator.isActive === false) {
        getLogger().debug(
          { creatorId: reverseShare.creatorId },
          "Reverse share creator is deactivated, skipping notification",
        );
        return;
      }
      const reverseShareName = reverseShare.name || "Unnamed Reverse Share";
      const fileCount = fileNames.length;

      await emailService.send("reverse_share_uploaded", {
        to: creator.email,
        locale: creator.locale ?? "en",
        userId: creator.id,
        relatedId: reverseShare.id,
        data: {
          reverseShareName,
          fileCount,
          fileNames,
          uploaderName: uploaderName ?? undefined,
          uploaderEmail: uploaderEmail ?? undefined,
        },
      });
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
    const uploaderName = fileData.uploaderName || null;

    const existingSession = this.uploadSessions.get(sessionKey);
    if (existingSession) {
      if (existingSession.timeout !== null) clearTimeout(existingSession.timeout);
      existingSession.files.push(fileData.name);
    } else {
      this.uploadSessions.set(sessionKey, {
        reverseShareId: reverseShare.id,
        reverseShareCreatorId: reverseShare.creatorId,
        reverseShareName: reverseShare.name ?? null,
        uploaderName,
        uploaderEmail: fileData.uploaderEmail,
        files: [fileData.name],
        timeout: null,
      });
    }

    const session = this.uploadSessions.get(sessionKey)!;
    session.timeout = setTimeout(async () => {
      await this.sendBatchFileUploadNotification(
        reverseShare,
        session.uploaderName,
        session.files,
        session.uploaderEmail,
      );
      this.uploadSessions.delete(sessionKey);
    }, 5000);
  }

  /**
   * Flush all pending upload sessions immediately, firing their batch
   * notifications without waiting for the debounce timeout.
   *
   * Called during Fastify `onClose` to ensure pending notifications are not
   * lost when the server shuts down. Each pending session's timeout is cleared
   * and the notification is sent synchronously (best-effort).
   */
  async flushPendingNotifications(): Promise<void> {
    const log = getLogger();
    const entries = Array.from(this.uploadSessions.entries());
    if (entries.length === 0) return;

    log.info({ count: entries.length }, "Flushing pending reverse-share upload notifications");

    for (const [sessionKey, session] of entries) {
      if (session.timeout !== null) {
        clearTimeout(session.timeout);
        session.timeout = null;
      }
      try {
        await this.sendBatchFileUploadNotification(
          {
            id: session.reverseShareId,
            creatorId: session.reverseShareCreatorId,
            name: session.reverseShareName,
          },
          session.uploaderName,
          session.files,
          session.uploaderEmail,
        );
      } catch (err) {
        log.warn({ err, sessionKey }, "Failed to flush pending upload notification on shutdown");
      }
      this.uploadSessions.delete(sessionKey);
    }
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
