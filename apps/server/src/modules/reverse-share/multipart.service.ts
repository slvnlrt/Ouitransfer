import crypto from "node:crypto";

import { env } from "../../env.js";
import { GoneError, NotFoundError, UnauthorizedError } from "../../utils/app-error.js";
import { FileService } from "../file/service.js";
import { ReverseShareRepository } from "./repository.js";

export class ReverseShareMultipartService {
  private reverseShareRepository = new ReverseShareRepository();
  private fileService = new FileService();

  // Helper method to validate reverse share access (reduces duplication)
  private async validateReverseShareAccessByAlias(alias: string, password?: string) {
    const reverseShare = await this.reverseShareRepository.findByAlias(alias);
    if (!reverseShare) {
      throw new NotFoundError("Reverse share not found");
    }

    if (!reverseShare.isActive) {
      throw new GoneError("Reverse share is inactive");
    }

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
      throw new GoneError("Reverse share has expired");
    }

    if (reverseShare.password) {
      if (!password) {
        throw new UnauthorizedError("Password required");
      }
      const isValidPassword = await this.reverseShareRepository.comparePassword(
        password,
        reverseShare.password,
      );
      if (!isValidPassword) {
        throw new UnauthorizedError("Invalid password");
      }
    }

    return reverseShare;
  }

  async createMultipartUploadByAlias(
    alias: string,
    filename: string,
    extension: string,
    password?: string,
  ): Promise<{ uploadId: string; objectName: string }> {
    const reverseShare = await this.validateReverseShareAccessByAlias(alias, password);

    // Generate objectName server-side with reverseShare.id (not alias), sanitized filename, and crypto UUID
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100);
    const objectName = `reverse-shares/${reverseShare.id}/${Date.now()}-${crypto.randomUUID()}-${sanitizedFilename}.${extension}`;

    const uploadId = await this.fileService.createMultipartUpload(objectName);

    return {
      uploadId,
      objectName,
    };
  }

  async getMultipartPartUrlByAlias(
    alias: string,
    uploadId: string,
    objectName: string,
    partNumber: number,
    password?: string,
  ): Promise<{ url: string }> {
    await this.validateReverseShareAccessByAlias(alias, password);

    const expires = env.PRESIGNED_URL_EXPIRATION;
    const url = await this.fileService.getPresignedPartUrl(
      objectName,
      uploadId,
      partNumber,
      expires,
    );

    return { url };
  }

  async completeMultipartUploadByAlias(
    alias: string,
    uploadId: string,
    objectName: string,
    parts: Array<{ PartNumber: number; ETag: string }>,
    password?: string,
  ): Promise<{ message: string; objectName: string }> {
    await this.validateReverseShareAccessByAlias(alias, password);

    await this.fileService.completeMultipartUpload(objectName, uploadId, parts);

    return {
      message: "Multipart upload completed successfully",
      objectName,
    };
  }

  async abortMultipartUploadByAlias(
    alias: string,
    uploadId: string,
    objectName: string,
    password?: string,
  ): Promise<{ message: string }> {
    await this.validateReverseShareAccessByAlias(alias, password);

    await this.fileService.abortMultipartUpload(objectName, uploadId);

    return {
      message: "Multipart upload aborted successfully",
    };
  }
}
