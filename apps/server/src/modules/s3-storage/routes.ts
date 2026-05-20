/**
 * S3 Storage Routes
 *
 * Simple routes for S3-based storage using presigned URLs.
 * Much simpler than filesystem routes - no chunk management, no streaming.
 */

import path from "node:path";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { S3StorageProvider } from "../../providers/s3-storage.provider.js";
import { prisma } from "../../shared/prisma.js";
import { ForbiddenError, UnauthorizedError, ValidationError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";

const storageProvider = new S3StorageProvider();

const preValidation = createJwtPreValidation();

export const s3StorageRoutes: FastifyPluginAsyncZod = async (app) => {
  // Get presigned upload URL
  app.route({
    method: "POST",
    url: "/s3/upload-url",
    preValidation,
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 minute",
      },
    },
    schema: {
      tags: ["S3 Storage"],
      operationId: "getS3UploadUrl",
      summary: "Get presigned URL for upload",
      description: "Returns a presigned URL that clients can use to upload directly to S3",
      body: z.object({
        objectName: z.string().describe("Object name/path in S3"),
        expires: z.number().optional().describe("URL expiration in seconds (default: 3600)"),
      }),
      response: {
        200: z.object({
          uploadUrl: z.string(),
          objectName: z.string(),
          expiresIn: z.number(),
          message: z.string(),
        }),
        401: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { objectName, expires } = request.body;

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
        uploadUrl = await storageProvider.getPresignedPutUrl(objectName, expiresIn);
      }

      return reply.status(200).send({
        uploadUrl,
        objectName,
        expiresIn,
        message: isInternalStorage
          ? "Upload via backend proxy"
          : "Upload directly to this URL using PUT request",
      });
    },
  });

  // Get presigned download URL
  app.route({
    method: "GET",
    url: "/s3/download-url",
    preValidation,
    schema: {
      tags: ["S3 Storage"],
      operationId: "getS3DownloadUrl",
      summary: "Get presigned URL for download",
      description: "Returns a presigned URL that clients can use to download directly from S3",
      querystring: z.object({
        objectName: z.string().describe("Object name/path in S3"),
        expires: z.string().optional().describe("URL expiration in seconds (default: 3600)"),
        fileName: z.string().optional().describe("Optional filename for download"),
      }),
      response: {
        200: z.object({
          downloadUrl: z.string(),
          objectName: z.string(),
          expiresIn: z.number(),
          message: z.string(),
        }),
        401: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { objectName, expires, fileName } = request.query;

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
        downloadUrl = await storageProvider.getPresignedGetUrl(objectName, expiresIn, fileName);
      }

      return reply.status(200).send({
        downloadUrl,
        objectName,
        expiresIn,
        message: isInternalStorage
          ? "Download via backend proxy"
          : "Download directly from this URL",
      });
    },
  });

  // Delete object
  app.route({
    method: "DELETE",
    url: "/s3/object/:objectName",
    preValidation,
    schema: {
      tags: ["S3 Storage"],
      operationId: "deleteS3Object",
      summary: "Delete object from S3",
      params: z.object({
        objectName: z.string().describe("Object name/path in S3"),
      }),
      response: {
        200: z.object({
          message: z.string(),
          objectName: z.string(),
        }),
        401: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { objectName } = request.params;

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

      await storageProvider.deleteObject(objectName);

      return reply.status(200).send({
        message: "Object deleted successfully",
        objectName,
      });
    },
  });

  // Check if object exists
  app.route({
    method: "GET",
    url: "/s3/exists",
    preValidation,
    schema: {
      tags: ["S3 Storage"],
      operationId: "checkS3ObjectExists",
      summary: "Check if object exists in S3",
      querystring: z.object({
        objectName: z.string().describe("Object name/path in S3"),
      }),
      response: {
        200: z.object({
          exists: z.boolean(),
          objectName: z.string(),
        }),
        401: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { objectName } = request.query;

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

      const exists = await storageProvider.fileExists(objectName);

      return reply.status(200).send({
        exists,
        objectName,
      });
    },
  });
};
