import crypto from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { env } from "../../env.js";
import { UnauthorizedError, ValidationError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { sanitizeFilename } from "../../utils/sanitize-filename.js";
import { validateObjectName } from "../../utils/validate-object-name.js";
import { FileController } from "./controller.js";
import { FileDownloadController } from "./download.controller.js";
import {
  CheckFileSchema,
  ListFilesSchema,
  MoveFileSchema,
  RegisterFileSchema,
  UpdateFileSchema,
} from "./dto.js";
import { FileEmbedController } from "./embed.controller.js";
import { FileService } from "./service.js";

const fileService = new FileService();

export async function fileRoutes(app: FastifyInstance) {
  const fileController = new FileController();
  const downloadController = new FileDownloadController();
  const embedController = new FileEmbedController();

  const preValidation = async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      request.log.warn({ err }, "JWT verification failed");
      throw new UnauthorizedError("Invalid or missing token");
    }
  };

  app.get(
    "/files/presigned-url",
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: "1 minute",
        },
      },
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "getPresignedUrl",
        summary: "Get Presigned URL",
        description:
          "Generates a pre-signed URL for direct upload to S3-compatible storage or local filesystem",
        querystring: z.object({
          filename: z
            .string()
            .min(1, "The filename is required")
            .describe("The filename of the file"),
          extension: z
            .string()
            .min(1, "The extension is required")
            .describe("The extension of the file"),
        }),
        response: {
          200: z.object({
            url: z.string().describe("The pre-signed URL"),
            objectName: z.string().describe("The object name of the file"),
            maxFileSize: z.number().describe("Maximum allowed file size in bytes"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    fileController.getPresignedUrl.bind(fileController),
  );

  app.post(
    "/files",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "registerFile",
        summary: "Register File Metadata",
        description: "Registers file metadata in the database",
        body: RegisterFileSchema,
        response: {
          201: z.object({
            file: z.object({
              id: z.string().describe("The file ID"),
              name: z.string().describe("The file name"),
              description: z.string().nullable().describe("The file description"),
              extension: z.string().describe("The file extension"),
              size: z.string().describe("The file size"),
              objectName: z.string().describe("The object name of the file"),
              userId: z.string().describe("The user ID"),
              folderId: z.string().nullable().describe("The folder ID"),
              createdAt: z.date().describe("The file creation date"),
              updatedAt: z.date().describe("The file last update date"),
            }),
            message: z.string().describe("The file registration message"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    fileController.registerFile.bind(fileController),
  );

  app.post(
    "/files/check",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "checkFile",
        summary: "Check File validity",
        description: "Checks if the file meets all requirements",
        body: CheckFileSchema,
        response: {
          201: z.object({
            message: z.string().describe("The file check success message"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    fileController.checkFile.bind(fileController),
  );

  app.post(
    "/files/download-url",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["File"],
        operationId: "getDownloadUrl",
        summary: "Get Download URL",
        description:
          "Generates a pre-signed URL for downloading a file. Password must be sent in the request body, never as a query parameter.",
        body: z.object({
          objectName: z.string().min(1, "The objectName is required"),
          password: z.string().optional().describe("Share password if required"),
        }),
        response: {
          200: z.object({
            url: z.string().describe("The download URL"),
            expiresIn: z.number().describe("The expiration time in seconds"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    downloadController.getDownloadUrl.bind(downloadController),
  );

  app.get(
    "/embed/:token",
    {
      schema: {
        tags: ["File"],
        operationId: "embedFile",
        summary: "Embed File (Token-Based Access)",
        description:
          "Returns a media file using a signed embed token. Tokens are generated via POST /files/embed-token.",
        params: z.object({
          token: z.string().min(1, "Embed token is required").describe("Signed embed token"),
        }),
        response: {
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
          410: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    embedController.embedFile.bind(embedController),
  );

  app.post(
    "/files/embed-token",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "generateEmbedToken",
        summary: "Generate Embed Token",
        description:
          "Creates a signed embed token for a file in a share. Only the share owner can generate tokens. Token expires in 24h.",
        body: z.object({
          fileId: z.string().min(1, "File ID is required").describe("The file ID"),
          shareId: z
            .string()
            .min(1, "Share ID is required")
            .describe("The share ID containing the file"),
        }),
        response: {
          200: z.object({
            token: z.string().describe("Signed embed token"),
            embedUrl: z.string().describe("Embed URL path"),
          }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    embedController.generateEmbedToken.bind(embedController),
  );

  app.post(
    "/files/download",
    {
      config: {
        rateLimit: {
          max: 20,
          timeWindow: "1 minute",
        },
      },
      schema: {
        tags: ["File"],
        operationId: "downloadFile",
        summary: "Download File",
        description:
          "Downloads a file directly (returns file content). Password must be sent in the request body, never as a query parameter.",
        body: z.object({
          objectName: z.string().min(1, "The objectName is required"),
          password: z.string().optional().describe("Share password if required"),
        }),
      },
    },
    downloadController.downloadFile.bind(downloadController),
  );

  app.get(
    "/files",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "listFiles",
        summary: "List Files",
        description: "Lists user files recursively by default, optionally filtered by folder",
        querystring: ListFilesSchema,
        response: {
          200: z.object({
            files: z.array(
              z.object({
                id: z.string().describe("The file ID"),
                name: z.string().describe("The file name"),
                description: z.string().nullable().describe("The file description"),
                extension: z.string().describe("The file extension"),
                size: z.string().describe("The file size"),
                objectName: z.string().describe("The object name of the file"),
                userId: z.string().describe("The user ID"),
                folderId: z.string().nullable().describe("The folder ID"),
                relativePath: z
                  .string()
                  .nullable()
                  .describe("The relative path (only for recursive listing)"),
                createdAt: z.date().describe("The file creation date"),
                updatedAt: z.date().describe("The file last update date"),
              }),
            ),
          }),
          500: ErrorResponseSchema,
        },
      },
    },
    fileController.listFiles.bind(fileController),
  );

  app.patch(
    "/files/:id",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "updateFile",
        summary: "Update File Metadata",
        description: "Updates file metadata in the database",
        params: z.object({
          id: z.string().min(1, "The file id is required").describe("The file ID"),
        }),
        body: UpdateFileSchema,
        response: {
          200: z.object({
            file: z.object({
              id: z.string().describe("The file ID"),
              name: z.string().describe("The file name"),
              description: z.string().nullable().describe("The file description"),
              extension: z.string().describe("The file extension"),
              size: z.string().describe("The file size"),
              objectName: z.string().describe("The object name of the file"),
              userId: z.string().describe("The user ID"),
              folderId: z.string().nullable().describe("The folder ID"),
              createdAt: z.date().describe("The file creation date"),
              updatedAt: z.date().describe("The file last update date"),
            }),
            message: z.string().describe("Success message"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    fileController.updateFile.bind(fileController),
  );

  app.put(
    "/files/:id/move",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "moveFile",
        summary: "Move File",
        description: "Moves a file to a different folder",
        params: z.object({
          id: z.string().min(1, "The file id is required").describe("The file ID"),
        }),
        body: MoveFileSchema,
        response: {
          200: z.object({
            file: z.object({
              id: z.string().describe("The file ID"),
              name: z.string().describe("The file name"),
              description: z.string().nullable().describe("The file description"),
              extension: z.string().describe("The file extension"),
              size: z.string().describe("The file size"),
              objectName: z.string().describe("The object name of the file"),
              userId: z.string().describe("The user ID"),
              folderId: z.string().nullable().describe("The folder ID"),
              createdAt: z.date().describe("The file creation date"),
              updatedAt: z.date().describe("The file last update date"),
            }),
            message: z.string().describe("Success message"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    fileController.moveFile.bind(fileController),
  );

  app.delete(
    "/files/:id",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "deleteFile",
        summary: "Delete File",
        description: "Deletes a user file",
        params: z.object({
          id: z.string().min(1, "The file id is required").describe("The file ID"),
        }),
        response: {
          200: z.object({
            message: z.string().describe("The file deletion message"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          404: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    fileController.deleteFile.bind(fileController),
  );

  // Multipart upload routes (inlined from multipart.controller.ts)
  app.post(
    "/files/multipart/create",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "createMultipartUpload",
        summary: "Create Multipart Upload",
        description:
          "Initializes a multipart upload for large files (≥100MB). Returns uploadId for subsequent part uploads.",
        body: z.object({
          filename: z.string().min(1).describe("The filename without extension"),
          extension: z.string().min(1).describe("The file extension"),
        }),
        response: {
          200: z.object({
            uploadId: z.string().describe("The upload ID for this multipart upload"),
            objectName: z.string().describe("The object name in storage"),
            message: z.string().describe("Success message"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { filename, extension } = request.body as { filename: string; extension: string };

      // Generate unique object name (same pattern as simple upload)
      const safeFilename = sanitizeFilename(`${filename}.${extension}`);
      const objectName = `${userId}/${crypto.randomUUID()}-${safeFilename}`;

      const uploadId = await fileService.createMultipartUpload(objectName);

      return reply.status(200).send({
        uploadId,
        objectName,
        message: "Multipart upload initialized",
      });
    },
  );

  app.get(
    "/files/multipart/part-url",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "getMultipartPartUrl",
        summary: "Get Presigned URL for Part",
        description: "Gets a presigned URL for uploading a specific part of a multipart upload",
        querystring: z.object({
          uploadId: z.string().min(1).describe("The multipart upload ID"),
          objectName: z.string().min(1).describe("The object name"),
          partNumber: z.string().min(1).describe("The part number (1-10000)"),
        }),
        response: {
          200: z.object({
            url: z.string().describe("The presigned URL for uploading this part"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { uploadId, objectName, partNumber } = request.query as {
        uploadId: string;
        objectName: string;
        partNumber: string;
      };

      const partNum = parseInt(partNumber, 10);
      if (Number.isNaN(partNum) || partNum < 1 || partNum > 10000) {
        throw new ValidationError("partNumber must be between 1 and 10000");
      }

      validateObjectName(objectName, userId);

      const expires = env.PRESIGNED_URL_EXPIRATION;

      const url = await fileService.getPresignedPartUrl(objectName, uploadId, partNum, expires);

      return reply.status(200).send({ url });
    },
  );

  app.post(
    "/files/multipart/complete",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "completeMultipartUpload",
        summary: "Complete Multipart Upload",
        description: "Completes a multipart upload by combining all uploaded parts",
        body: z.object({
          uploadId: z.string().min(1).describe("The multipart upload ID"),
          objectName: z.string().min(1).describe("The object name"),
          parts: z
            .array(
              z.object({
                PartNumber: z.number().min(1).max(10000).describe("The part number"),
                ETag: z.string().min(1).describe("The ETag returned from uploading the part"),
              }),
            )
            .describe("Array of uploaded parts"),
        }),
        response: {
          200: z.object({
            message: z.string().describe("Success message"),
            objectName: z.string().describe("The completed object name"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { uploadId, objectName, parts } = request.body as {
        uploadId: string;
        objectName: string;
        parts: Array<{ PartNumber: number; ETag: string }>;
      };

      validateObjectName(objectName, userId);

      await fileService.completeMultipartUpload(objectName, uploadId, parts);

      return reply.status(200).send({
        message: "Multipart upload completed successfully",
        objectName,
      });
    },
  );

  app.post(
    "/files/multipart/abort",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "abortMultipartUpload",
        summary: "Abort Multipart Upload",
        description: "Aborts a multipart upload and cleans up all uploaded parts",
        body: z.object({
          uploadId: z.string().min(1).describe("The multipart upload ID"),
          objectName: z.string().min(1).describe("The object name"),
        }),
        response: {
          200: z.object({
            message: z.string().describe("Success message"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { uploadId, objectName } = request.body as {
        uploadId: string;
        objectName: string;
      };

      validateObjectName(objectName, userId);

      await fileService.abortMultipartUpload(objectName, uploadId);

      return reply.status(200).send({
        message: "Multipart upload aborted successfully",
      });
    },
  );

  app.get(
    "/files/multipart/list-parts",
    {
      preValidation,
      schema: {
        tags: ["File"],
        operationId: "listMultipartParts",
        summary: "List Multipart Upload Parts",
        description:
          "Lists already-uploaded parts for a multipart upload, enabling upload resume after interruption",
        querystring: z.object({
          uploadId: z.string().min(1).describe("The multipart upload ID"),
          objectName: z.string().min(1).describe("The object name"),
        }),
        response: {
          200: z.object({
            parts: z
              .array(
                z.object({
                  PartNumber: z.number().describe("The part number"),
                  Size: z.number().describe("The part size in bytes"),
                  ETag: z.string().describe("The ETag of the uploaded part"),
                }),
              )
              .describe("Array of already-uploaded parts"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { uploadId, objectName } = request.query as {
        uploadId: string;
        objectName: string;
      };

      validateObjectName(objectName, userId);

      const parts = await fileService.listParts(objectName, uploadId);

      return reply.status(200).send({ parts });
    },
  );
}
