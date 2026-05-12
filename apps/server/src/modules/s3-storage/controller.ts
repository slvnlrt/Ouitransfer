/**
 * S3 Storage Controller (Simplified)
 *
 * This controller handles uploads/downloads using S3-compatible storage.
 * It's much simpler than the filesystem controller because:
 * - Uses S3 multipart uploads (no chunk management needed)
 * - Uses presigned URLs (no streaming through Node.js)
 * - No memory management needed (storage handles it)
 * - No encryption needed (storage handles it)
 *
 * Replaces ~800 lines of complex code with ~100 lines of simple code.
 */

import path from "node:path";
import type { FastifyReply, FastifyRequest } from "fastify";
import { S3StorageProvider } from "../../providers/s3-storage.provider.js";
import { prisma } from "../../shared/prisma.js";
import {
  AppError,
  ForbiddenError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";

export class S3StorageController {
  private storageProvider = new S3StorageProvider();

  /**
   * Generate presigned upload URL
   * Client uploads directly to S3
   */
  async getUploadUrl(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError();
    }

    const { objectName, expires } = request.body as { objectName: string; expires?: number };

    if (!objectName) {
      throw new ValidationError("objectName is required");
    }

    // Reject path traversal attempts
    if (objectName.includes("..") || objectName.includes("\0")) {
      throw new ValidationError("Invalid object name");
    }
    const normalized = path.posix.normalize(objectName);
    if (!normalized.startsWith(`${userId}/`)) {
      throw new ForbiddenError("Forbidden: you do not own this file.");
    }

    const expiresIn = expires || 3600; // 1 hour default

    // Import storage config to check if using internal or external S3
    const { isInternalStorage } = await import("../../config/storage.config.js");

    let uploadUrl: string;

    if (isInternalStorage) {
      // Internal storage: Use frontend proxy (much simpler!)
      uploadUrl = `/api/files/upload?objectName=${encodeURIComponent(objectName)}`;
    } else {
      // External S3: Use presigned URLs directly (more efficient)
      uploadUrl = await this.storageProvider.getPresignedPutUrl(objectName, expiresIn);
    }

    return reply.status(200).send({
      uploadUrl,
      objectName,
      expiresIn,
      message: isInternalStorage
        ? "Upload via backend proxy"
        : "Upload directly to this URL using PUT request",
    });
  }

  /**
   * Generate presigned download URL
   * For internal storage: Uses backend proxy
   * For external S3: Uses presigned URLs directly
   */
  async getDownloadUrl(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError();
    }

    const { objectName, expires, fileName } = request.query as {
      objectName: string;
      expires?: string;
      fileName?: string;
    };

    if (!objectName) {
      throw new ValidationError("objectName is required");
    }

    // Reject path traversal attempts
    if (objectName.includes("..") || objectName.includes("\0")) {
      throw new ValidationError("Invalid object name");
    }
    const normalized = path.posix.normalize(objectName);
    if (!normalized.startsWith(`${userId}/`)) {
      throw new ForbiddenError("Forbidden: you do not own this file.");
    }

    // Verify the file exists in the DB and belongs to the authenticated user
    const file = await prisma.file.findFirst({ where: { objectName, userId } });
    if (!file) {
      throw new ForbiddenError("Access denied");
    }

    const expiresIn = expires ? parseInt(expires, 10) : 3600;

    // Import storage config to check if using internal or external S3
    const { isInternalStorage } = await import("../../config/storage.config.js");

    let downloadUrl: string;

    if (isInternalStorage) {
      // Internal storage: Use frontend proxy (much simpler!)
      downloadUrl = `/api/files/download?objectName=${encodeURIComponent(objectName)}`;
    } else {
      // External S3: Use presigned URLs directly (more efficient)
      downloadUrl = await this.storageProvider.getPresignedGetUrl(objectName, expiresIn, fileName);
    }

    return reply.status(200).send({
      downloadUrl,
      objectName,
      expiresIn,
      message: isInternalStorage ? "Download via backend proxy" : "Download directly from this URL",
    });
  }

  /**
   * Upload directly (for small files)
   * Receives file and uploads to S3
   */
  async upload(_request: FastifyRequest, _reply: FastifyReply) {
    // For large files, clients should use presigned URLs.
    // Direct upload is not implemented — use the getUploadUrl endpoint instead.
    throw new AppError(501, "Use getUploadUrl endpoint for efficient uploads", "NOT_IMPLEMENTED");
  }

  /**
   * Delete object from S3
   */
  async deleteObject(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError();
    }

    const { objectName } = request.params as { objectName: string };

    if (!objectName) {
      throw new ValidationError("objectName is required");
    }

    // Reject path traversal attempts
    if (objectName.includes("..") || objectName.includes("\0")) {
      throw new ValidationError("Invalid object name");
    }
    const normalized = path.posix.normalize(objectName);
    if (!normalized.startsWith(`${userId}/`)) {
      throw new ForbiddenError("Forbidden: you do not own this file.");
    }

    // Verify the file exists in the DB and belongs to the authenticated user
    const file = await prisma.file.findFirst({ where: { objectName, userId } });
    if (!file) {
      throw new ForbiddenError("Access denied");
    }

    await this.storageProvider.deleteObject(objectName);

    return reply.status(200).send({
      message: "Object deleted successfully",
      objectName,
    });
  }

  /**
   * Check if object exists
   */
  async checkExists(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError();
    }

    const { objectName } = request.query as { objectName: string };

    if (!objectName) {
      throw new ValidationError("objectName is required");
    }

    // Reject path traversal attempts
    if (objectName.includes("..") || objectName.includes("\0")) {
      throw new ValidationError("Invalid object name");
    }
    const normalized = path.posix.normalize(objectName);
    if (!normalized.startsWith(`${userId}/`)) {
      throw new ForbiddenError("Forbidden: you do not own this file.");
    }

    // Verify the file exists in the DB and belongs to the authenticated user
    const file = await prisma.file.findFirst({ where: { objectName, userId } });
    if (!file) {
      throw new ForbiddenError("Access denied");
    }

    const exists = await this.storageProvider.fileExists(objectName);

    return reply.status(200).send({
      exists,
      objectName,
    });
  }
}
