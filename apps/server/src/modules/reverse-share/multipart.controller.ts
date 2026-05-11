import type { FastifyReply, FastifyRequest } from "fastify";

import { ValidationError } from "../../utils/app-error.js";
import { ReverseShareMultipartService } from "./multipart.service.js";

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

    const result = await this.multipartService.getMultipartPartUrlByAlias(
      alias,
      uploadId,
      objectName,
      partNum,
      password,
    );
    return reply.status(200).send({ url: result.url });
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

    const result = await this.multipartService.completeMultipartUploadByAlias(
      alias,
      uploadId,
      objectName,
      parts,
      password,
    );
    return reply.status(200).send(result);
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

    const result = await this.multipartService.abortMultipartUploadByAlias(
      alias,
      uploadId,
      objectName,
      password,
    );
    return reply.status(200).send(result);
  }
}
