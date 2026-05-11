import type { FastifyReply, FastifyRequest } from "fastify";

import {
  AppError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import { ReverseShareMultipartService } from "./multipart.service.js";

/**
 * Maps common reverse-share service errors to appropriate AppError subclasses.
 * If the error doesn't match any known pattern, re-throws the original error.
 */
function mapReverseShareMultipartError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const message = error instanceof Error ? error.message : String(error);

  if (message === "Reverse share not found") throw new NotFoundError(message);
  if (message === "Reverse share is inactive") throw new ForbiddenError(message);
  if (message === "Reverse share has expired") throw new GoneError(message);
  if (message === "Password required" || message === "Invalid password") {
    throw new UnauthorizedError(message);
  }

  throw error;
}

export class ReverseShareMultipartController {
  private multipartService = new ReverseShareMultipartService();

  async createMultipartUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    // Password moved from query param to request body (security: passwords must not appear in URLs)
    const { filename, extension, password } = request.body as {
      filename: string;
      extension: string;
      password?: string;
    };

    if (!filename || !extension) {
      throw new ValidationError("filename and extension are required");
    }

    try {
      const result = await this.multipartService.createMultipartUploadByAlias(
        alias,
        filename,
        extension,
        password,
      );
      return reply.status(200).send({
        uploadId: result.uploadId,
        objectName: result.objectName,
        message: "Multipart upload initialized",
      });
    } catch (error) {
      mapReverseShareMultipartError(error);
    }
  }

  async getMultipartPartUrlByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    // Moved from query params to request body (route changed GET→POST; passwords must not appear in URLs)
    const { uploadId, objectName, partNumber, password } = request.body as {
      uploadId: string;
      objectName: string;
      partNumber: string;
      password?: string;
    };

    if (!uploadId || !objectName || !partNumber) {
      throw new ValidationError("uploadId, objectName, and partNumber are required");
    }

    const partNum = parseInt(partNumber, 10);
    if (Number.isNaN(partNum) || partNum < 1 || partNum > 10000) {
      throw new ValidationError("partNumber must be between 1 and 10000");
    }

    try {
      const result = await this.multipartService.getMultipartPartUrlByAlias(
        alias,
        uploadId,
        objectName,
        partNum,
        password,
      );
      return reply.status(200).send({ url: result.url });
    } catch (error) {
      mapReverseShareMultipartError(error);
    }
  }

  async completeMultipartUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    // Password moved from query param to request body (security: passwords must not appear in URLs)
    const { uploadId, objectName, parts, password } = request.body as {
      uploadId: string;
      objectName: string;
      parts: Array<{ PartNumber: number; ETag: string }>;
      password?: string;
    };

    if (!uploadId || !objectName || !parts || !Array.isArray(parts)) {
      throw new ValidationError("uploadId, objectName, and parts are required");
    }

    try {
      const result = await this.multipartService.completeMultipartUploadByAlias(
        alias,
        uploadId,
        objectName,
        parts,
        password,
      );
      return reply.status(200).send(result);
    } catch (error) {
      mapReverseShareMultipartError(error);
    }
  }

  async abortMultipartUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    // Password moved from query param to request body (security: passwords must not appear in URLs)
    const { uploadId, objectName, password } = request.body as {
      uploadId: string;
      objectName: string;
      password?: string;
    };

    if (!uploadId || !objectName) {
      throw new ValidationError("uploadId and objectName are required");
    }

    try {
      const result = await this.multipartService.abortMultipartUploadByAlias(
        alias,
        uploadId,
        objectName,
        password,
      );
      return reply.status(200).send(result);
    } catch (error) {
      mapReverseShareMultipartError(error);
    }
  }
}
