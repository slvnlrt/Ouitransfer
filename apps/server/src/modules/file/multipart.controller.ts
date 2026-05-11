import crypto from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../../env.js";
import { sanitizeFilename } from "../../utils/sanitize-filename.js";
import { FileService } from "./service.js";

export class FileMultipartController {
  private fileService = new FileService();

  async createMultipartUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { filename, extension } = request.body as { filename: string; extension: string };

      if (!filename || !extension) {
        return reply.status(400).send({ error: "filename and extension are required" });
      }

      // Generate unique object name (same pattern as simple upload)
      const safeFilename = sanitizeFilename(`${filename}.${extension}`);
      const objectName = `${userId}/${crypto.randomUUID()}-${safeFilename}`;

      const uploadId = await this.fileService.createMultipartUpload(objectName);

      return reply.status(200).send({
        uploadId,
        objectName,
        message: "Multipart upload initialized",
      });
    } catch (error) {
      request.log.error({ err: error }, "[Multipart] Error creating multipart upload");
      return reply.status(500).send({ error: "Failed to create multipart upload" });
    }
  }

  async getMultipartPartUrl(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { uploadId, objectName, partNumber } = request.query as {
        uploadId: string;
        objectName: string;
        partNumber: string;
      };

      if (!uploadId || !objectName || !partNumber) {
        return reply
          .status(400)
          .send({ error: "uploadId, objectName, and partNumber are required" });
      }

      const partNum = parseInt(partNumber, 10);
      if (Number.isNaN(partNum) || partNum < 1 || partNum > 10000) {
        return reply.status(400).send({ error: "partNumber must be between 1 and 10000" });
      }

      const expires = env.PRESIGNED_URL_EXPIRATION;

      const url = await this.fileService.getPresignedPartUrl(
        objectName,
        uploadId,
        partNum,
        expires,
      );

      return reply.status(200).send({ url });
    } catch (error) {
      request.log.error({ err: error }, "[Multipart] Error getting part URL");
      return reply.status(500).send({ error: "Failed to get presigned URL for part" });
    }
  }

  async completeMultipartUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { uploadId, objectName, parts } = request.body as {
        uploadId: string;
        objectName: string;
        parts: Array<{ PartNumber: number; ETag: string }>;
      };

      if (!uploadId || !objectName || !parts || !Array.isArray(parts)) {
        return reply.status(400).send({ error: "uploadId, objectName, and parts are required" });
      }

      await this.fileService.completeMultipartUpload(objectName, uploadId, parts);

      return reply.status(200).send({
        message: "Multipart upload completed successfully",
        objectName,
      });
    } catch (error) {
      request.log.error({ err: error }, "[Multipart] Error completing multipart upload");
      return reply.status(500).send({ error: "Failed to complete multipart upload" });
    }
  }

  async abortMultipartUpload(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const { uploadId, objectName } = request.body as {
        uploadId: string;
        objectName: string;
      };

      if (!uploadId || !objectName) {
        return reply.status(400).send({ error: "uploadId and objectName are required" });
      }

      await this.fileService.abortMultipartUpload(objectName, uploadId);

      return reply.status(200).send({
        message: "Multipart upload aborted successfully",
      });
    } catch (error) {
      request.log.error({ err: error }, "[Multipart] Error aborting multipart upload");
      return reply.status(500).send({ error: "Failed to abort multipart upload" });
    }
  }
}
