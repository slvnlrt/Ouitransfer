import type { FastifyReply, FastifyRequest } from "fastify";

import { ReverseShareMultipartService } from "./multipart.service.js";

export class ReverseShareMultipartController {
  private multipartService = new ReverseShareMultipartService();

  async createMultipartUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { filename, extension, password } = request.body as {
        filename: string;
        extension: string;
        password?: string;
      };

      if (!filename || !extension) {
        return reply.status(400).send({ error: "filename and extension are required" });
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
    } catch (error: unknown) {
      request.log.error({ err: error }, "[Multipart] Create multipart upload error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(500).send({ error: "Failed to create multipart upload" });
    }
  }

  async getMultipartPartUrlByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      // Moved from query params to request body (route changed GET→POST; passwords must not appear in URLs)
      const { uploadId, objectName, partNumber, password } = request.body as {
        uploadId: string;
        objectName: string;
        partNumber: string;
        password?: string;
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

      const result = await this.multipartService.getMultipartPartUrlByAlias(
        alias,
        uploadId,
        objectName,
        partNum,
        password,
      );
      return reply.status(200).send({ url: result.url });
    } catch (error: unknown) {
      request.log.error({ err: error }, "[Multipart] Get part URL error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(500).send({ error: "Failed to get presigned URL for part" });
    }
  }

  async completeMultipartUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { uploadId, objectName, parts, password } = request.body as {
        uploadId: string;
        objectName: string;
        parts: Array<{ PartNumber: number; ETag: string }>;
        password?: string;
      };

      if (!uploadId || !objectName || !parts || !Array.isArray(parts)) {
        return reply.status(400).send({ error: "uploadId, objectName, and parts are required" });
      }

      const result = await this.multipartService.completeMultipartUploadByAlias(
        alias,
        uploadId,
        objectName,
        parts,
        password,
      );
      return reply.status(200).send(result);
    } catch (error: unknown) {
      request.log.error({ err: error }, "[Multipart] Complete multipart upload error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(500).send({ error: "Failed to complete multipart upload" });
    }
  }

  async abortMultipartUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { uploadId, objectName, password } = request.body as {
        uploadId: string;
        objectName: string;
        password?: string;
      };

      if (!uploadId || !objectName) {
        return reply.status(400).send({ error: "uploadId and objectName are required" });
      }

      const result = await this.multipartService.abortMultipartUploadByAlias(
        alias,
        uploadId,
        objectName,
        password,
      );
      return reply.status(200).send(result);
    } catch (error: unknown) {
      request.log.error({ err: error }, "[Multipart] Abort multipart upload error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(500).send({ error: "Failed to abort multipart upload" });
    }
  }
}
