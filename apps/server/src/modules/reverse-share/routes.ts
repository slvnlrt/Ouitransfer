import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { z } from "zod";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { aliasSchema } from "../../shared/alias-schema.js";
import { AppError, UnauthorizedError, ValidationError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import {
  CreateReverseShareSchema,
  FieldRequirementSchema,
  GetPresignedUrlSchema,
  NotifyReverseShareRecipientsSchema,
  RemoveReverseShareRecipientsSchema,
  ReverseShareFileSchema,
  ReverseSharePasswordSchema,
  ReverseSharePublicSchema,
  ReverseShareResponseSchema,
  UpdateReverseShareFileSchema,
  UpdateReverseSharePasswordSchema,
  UpdateReverseShareRecipientsSchema,
  UpdateReverseShareSchema,
  UploadToReverseShareSchema,
} from "./dto.js";
import { ReverseShareMultipartService } from "./multipart.service.js";
import { ReverseShareService } from "./service.js";
import { ReverseShareUploadService } from "./upload.service.js";

const reverseShareService = new ReverseShareService();
const uploadService = new ReverseShareUploadService();
const multipartService = new ReverseShareMultipartService();

const preValidation = createJwtPreValidation();

export const reverseShareRoutes: FastifyPluginAsyncZod = async (app) => {
  // Flush pending upload session notifications on shutdown so no emails are lost
  app.addHook("onClose", async () => {
    await uploadService.flushPendingNotifications();
  });
  app.route({
    method: "POST",
    url: "/reverse-shares",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "createReverseShare",
      summary: "Create Reverse Share",
      description:
        "Create a new reverse share to allow others to upload files to you. Only authenticated users can create reverse shares. The reverse share can be configured with various restrictions like file count limits, file size limits, allowed file types, password protection, and expiration dates.",
      body: CreateReverseShareSchema,
      response: {
        201: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const reverseShare = await reverseShareService.createReverseShare(request.body, userId);
      logAuditEvent({
        action: "REVERSE_SHARE_CREATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: reverseShare.id,
        metadata: {
          maxFiles: request.body.maxFiles ?? null,
          maxFileSize: request.body.maxFileSize ?? null,
          hasPassword: !!request.body.password,
          expiration: request.body.expiration ?? null,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.status(201).send({ reverseShare });
    },
  });

  app.route({
    method: "GET",
    url: "/reverse-shares",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "listUserReverseShares",
      summary: "List User's Reverse Shares",
      description:
        "Retrieve all reverse shares created by the authenticated user, ordered by creation date (newest first). This endpoint returns comprehensive information about each reverse share including file counts and settings.",
      response: {
        200: z.object({
          reverseShares: z.array(ReverseShareResponseSchema),
        }),
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const reverseShares = await reverseShareService.listUserReverseShares(userId);
      return reply.send({ reverseShares });
    },
  });

  app.route({
    method: "GET",
    url: "/reverse-shares/:id",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "getReverseShare",
      summary: "Get Reverse Share Details",
      description:
        "Retrieve detailed information about a specific reverse share by its ID. Only the creator of the reverse share can access this endpoint. Returns all configuration details and uploaded files.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      response: {
        200: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const reverseShare = await reverseShareService.getReverseShareById(request.params.id, userId);
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "PUT",
    url: "/reverse-shares",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "updateReverseShare",
      summary: "Update Reverse Share",
      description:
        "Update the configuration of an existing reverse share. Only the creator can update their reverse share. All fields except 'id' are optional - only provided fields will be updated.",
      body: UpdateReverseShareSchema,
      response: {
        200: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const { id, ...updateData } = request.body;
      const reverseShare = await reverseShareService.updateReverseShare(id, updateData, userId, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
      logAuditEvent({
        action: "REVERSE_SHARE_UPDATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: id,
        metadata: { fields: Object.keys(updateData) },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "PUT",
    url: "/reverse-shares/:id/password",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "updateReverseSharePassword",
      summary: "Update Reverse Share Password",
      description:
        "Update or remove the password for a reverse share. Send null as password value to remove password protection. Only the creator can update the password.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      body: UpdateReverseSharePasswordSchema,
      response: {
        200: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const { password } = request.body;
      const updateData: { password?: string | null } = { password };
      const reverseShare = await reverseShareService.updateReverseShare(
        request.params.id,
        updateData,
        userId,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_PASSWORD_UPDATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "DELETE",
    url: "/reverse-shares/:id",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "deleteReverseShare",
      summary: "Delete Reverse Share",
      description:
        "Delete a reverse share and all its associated files. Only the creator of the reverse share can delete it. This action is irreversible and will permanently remove all uploaded files.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share to delete"),
      }),
      response: {
        200: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const reverseShare = await reverseShareService.deleteReverseShare(request.params.id, userId);
      logAuditEvent({
        action: "REVERSE_SHARE_DELETE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "GET",
    url: "/reverse-shares/:id/upload",
    // Per-IP enumeration rate limit (R2 — A4-12): public info endpoint over guessable aliases/ids.
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: {
      tags: ["Reverse Share"],
      operationId: "getReverseShareForUpload",
      summary: "Get Reverse Share for Upload (Public)",
      description:
        "Get reverse share information for file upload. This is a public endpoint for non-password-protected shares. For password-protected shares use POST /reverse-shares/:id/upload/access instead.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      response: {
        200: z.object({
          reverseShare: ReverseSharePublicSchema,
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const reverseShare = await reverseShareService.getReverseShareForUpload(
        request.params.id,
        undefined,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_ACCESS",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "reverse_share",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/:id/upload/access",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "accessReverseShareForUploadWithPassword",
      summary: "Access a password-protected reverse share for upload",
      description:
        "Get reverse share upload information by providing the password in the request body. Passwords must never be sent as query parameters.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      body: z.object({
        password: z
          .string()
          .min(1, "Password is required")
          .describe("Password for the reverse share"),
      }),
      response: {
        200: z.object({
          reverseShare: ReverseSharePublicSchema,
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const reverseShare = await reverseShareService.getReverseShareForUpload(
          request.params.id,
          request.body.password,
        );
        logAuditEvent({
          action: "REVERSE_SHARE_PASSWORD_VERIFIED",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          targetType: "reverse_share",
          targetId: request.params.id,
        }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
        return reply.send({ reverseShare });
      } catch (err) {
        if (err instanceof AppError && err.code === ErrorCodes.INVALID_PASSWORD) {
          logAuditEvent({
            action: "REVERSE_SHARE_PASSWORD_FAILED",
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
            targetType: "reverse_share",
            targetId: request.params.id,
          }).catch((auditErr) => getLogger().error({ err: auditErr }, "Failed to log audit event"));
        }
        throw err;
      }
    },
  });

  app.route({
    method: "GET",
    url: "/reverse-shares/alias/:alias/upload",
    // Per-IP enumeration rate limit (R2 — A4-12): public info endpoint over guessable aliases.
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: {
      tags: ["Reverse Share"],
      operationId: "getReverseShareForUploadByAlias",
      summary: "Get Reverse Share for Upload by Alias (Public)",
      description:
        "Get reverse share information for file upload using alias. For password-protected shares use POST /reverse-shares/alias/:alias/upload/access instead.",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      response: {
        200: z.object({
          reverseShare: ReverseSharePublicSchema,
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const reverseShare = await reverseShareService.getReverseShareForUploadByAlias(
        request.params.alias,
        undefined,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_ACCESS",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "reverse_share",
        targetId: reverseShare.id,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/alias/:alias/upload/access",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "accessReverseShareForUploadByAliasWithPassword",
      summary: "Access a password-protected reverse share for upload by alias",
      description:
        "Get reverse share upload information by alias by providing the password in the request body. Passwords must never be sent as query parameters.",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      body: z.object({
        password: z
          .string()
          .min(1, "Password is required")
          .describe("Password for the reverse share"),
      }),
      response: {
        200: z.object({
          reverseShare: ReverseSharePublicSchema,
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      try {
        const reverseShare = await reverseShareService.getReverseShareForUploadByAlias(
          request.params.alias,
          request.body.password,
        );
        logAuditEvent({
          action: "REVERSE_SHARE_PASSWORD_VERIFIED",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          targetType: "reverse_share",
          targetId: reverseShare.id,
        }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
        return reply.send({ reverseShare });
      } catch (err) {
        if (err instanceof AppError && err.code === ErrorCodes.INVALID_PASSWORD) {
          // Resolve the reverse share id so targetId is consistent (not the alias string)
          const reverseShareId = await reverseShareService
            .getIdByAlias(request.params.alias)
            .catch(() => null);
          logAuditEvent({
            action: "REVERSE_SHARE_PASSWORD_FAILED",
            ipAddress: request.ip,
            userAgent: request.headers["user-agent"],
            targetType: "reverse_share",
            targetId: reverseShareId ?? request.params.alias,
          }).catch((auditErr) => getLogger().error({ err: auditErr }, "Failed to log audit event"));
        }
        throw err;
      }
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/:id/presigned-url",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "getPresignedUrl",
      summary: "Get Presigned URL for File Upload (Public)",
      description:
        "Get a presigned URL for direct file upload to storage. This endpoint validates reverse share permissions and generates a temporary upload URL. The presigned URL allows clients to upload files directly to the storage service without going through the API server.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      body: GetPresignedUrlSchema.extend({
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
      }),
      response: {
        200: z.object({
          url: z.string().describe("Presigned URL for file upload"),
          objectName: z
            .string()
            .describe("Server-generated object name to use when registering the file"),
          expiresIn: z.number().describe("URL expiration time in seconds"),
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { filename, extension, password } = request.body;
      const result = await uploadService.getPresignedUrl(
        request.params.id,
        filename,
        extension,
        password,
      );
      return reply.send(result);
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/alias/:alias/presigned-url",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "getPresignedUrlByAlias",
      summary: "Get Presigned URL for File Upload by Alias (Public)",
      description:
        "Get a presigned URL for direct file upload to storage using alias. This endpoint validates reverse share permissions and generates a temporary upload URL. The presigned URL allows clients to upload files directly to the storage service without going through the API server.",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      body: GetPresignedUrlSchema.extend({
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
      }),
      response: {
        200: z.object({
          url: z.string().describe("Presigned URL for file upload"),
          objectName: z
            .string()
            .describe("Server-generated object name to use when registering the file"),
          expiresIn: z.number().describe("URL expiration time in seconds"),
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { filename, extension, password } = request.body;
      const result = await uploadService.getPresignedUrlByAlias(
        request.params.alias,
        filename,
        extension,
        password,
      );
      return reply.send(result);
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/:id/register-file",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "registerFileUpload",
      summary: "Register File Upload Completion (Public)",
      description:
        "Register a completed file upload to the reverse share. This endpoint should be called after successfully uploading a file using the presigned URL to record the file metadata and associate it with the reverse share.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      body: UploadToReverseShareSchema.extend({
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
      }),
      response: {
        201: z.object({
          file: ReverseShareFileSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { password, ...fileData } = request.body;
      const file = await uploadService.registerFileUpload(request.params.id, fileData, password, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
      return reply.status(201).send({ file });
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/alias/:alias/register-file",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "registerFileUploadByAlias",
      summary: "Register File Upload Completion by Alias (Public)",
      description:
        "Register a completed file upload to the reverse share using alias. This endpoint should be called after successfully uploading a file using the presigned URL to record the file metadata and associate it with the reverse share.",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      body: UploadToReverseShareSchema.extend({
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
      }),
      response: {
        201: z.object({
          file: ReverseShareFileSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { password, ...fileData } = request.body;
      const file = await uploadService.registerFileUploadByAlias(
        request.params.alias,
        fileData,
        password,
        { ipAddress: request.ip, userAgent: request.headers["user-agent"] },
      );
      return reply.status(201).send({ file });
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/:id/check-password",
    // Per-route IP rate limit (R2 — A4-03) on top of the per-share lockout in the service.
    config: { csrfExempt: true, rateLimit: { max: 10, timeWindow: "1 minute" } },
    schema: {
      tags: ["Reverse Share"],
      operationId: "checkReverseSharePassword",
      summary: "Verify Reverse Share Password (Public)",
      description:
        "Verify if the provided password is correct for a password-protected reverse share. This endpoint allows frontend applications to validate passwords before attempting uploads. Returns whether the password is valid.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      body: ReverseSharePasswordSchema,
      response: {
        200: z.object({
          valid: z.boolean().describe("Whether the provided password is valid"),
        }),
        401: ErrorResponseSchema.extend({
          valid: z.boolean(),
        }),
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await reverseShareService.checkPassword(
        request.params.id,
        request.body.password,
        request.ip,
      );
      return reply.send(result);
    },
  });

  app.route({
    method: "GET",
    url: "/reverse-shares/files/:fileId/download",
    preValidation,
    bodyLimit: 50 * 1024 * 1024, // 50MB limit for API metadata payloads
    schema: {
      tags: ["Reverse Share"],
      operationId: "downloadReverseShareFile",
      summary: "Download File from Reverse Share",
      description:
        "Generate a download URL for a file uploaded to a reverse share. Only the creator of the reverse share can download files. The URL expires after 1 hour and works with both S3 and filesystem storage modes.",
      params: z.object({
        fileId: z.string().describe("Unique identifier of the file to download"),
      }),
      response: {
        200: z.object({
          url: z.string().describe("Presigned download URL - expires after 1 hour"),
          expiresIn: z.number().describe("URL expiration time in seconds (3600 = 1 hour)"),
        }),
        202: z.object({
          queued: z.boolean().describe("Download was queued due to memory constraints"),
          downloadId: z.string().describe("Download identifier for tracking"),
          message: z.string().describe("Queue status message"),
          estimatedWaitTime: z.number().describe("Estimated wait time in seconds"),
        }),
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const result = await reverseShareService.downloadReverseShareFile(
        request.params.fileId,
        userId,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_FILE_DOWNLOAD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "file",
        targetId: request.params.fileId,
        metadata: { fileId: request.params.fileId },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send(result);
    },
  });

  app.route({
    method: "DELETE",
    url: "/reverse-shares/files/:fileId",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "deleteReverseShareFile",
      summary: "Delete File from Reverse Share",
      description:
        "Permanently delete a file from a reverse share. The file will be removed from both the database and storage. This action cannot be undone. Only the creator of the reverse share can delete files.",
      params: z.object({
        fileId: z.string().describe("Unique identifier of the file to delete"),
      }),
      response: {
        200: z.object({
          file: ReverseShareFileSchema,
        }),
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const file = await reverseShareService.deleteReverseShareFile(request.params.fileId, userId);
      logAuditEvent({
        action: "REVERSE_SHARE_FILE_DELETE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: file.reverseShareId,
        metadata: { fileId: request.params.fileId },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ file });
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/:reverseShareId/alias",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "createReverseShareAlias",
      summary: "Create or update reverse share alias",
      description:
        "Create or update a custom alias for a reverse share to make it easier to share and remember.",
      params: z.object({
        reverseShareId: z.string().describe("The reverse share ID"),
      }),
      body: z.object({
        alias: aliasSchema,
      }),
      response: {
        200: z.object({
          alias: z.object({
            id: z.string(),
            alias: z.string(),
            reverseShareId: z.string(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await reverseShareService.createOrUpdateAlias(
        request.params.reverseShareId,
        request.body.alias,
        request.user?.userId,
      );
      return reply.send({ alias: result });
    },
  });

  app.route({
    method: "PATCH",
    url: "/reverse-shares/:id/activate",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "activateReverseShare",
      summary: "Activate Reverse Share",
      description:
        "Activate a reverse share to make it available for uploads. Only the creator can activate their reverse share.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share to activate"),
      }),
      response: {
        200: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const reverseShare = await reverseShareService.activateReverseShare(
        request.params.id,
        userId,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_REACTIVATED",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "PATCH",
    url: "/reverse-shares/:id/deactivate",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "deactivateReverseShare",
      summary: "Deactivate Reverse Share",
      description:
        "Deactivate a reverse share to prevent new uploads. Only the creator can deactivate their reverse share.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share to deactivate"),
      }),
      response: {
        200: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const reverseShare = await reverseShareService.deactivateReverseShare(
        request.params.id,
        userId,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_DEACTIVATED",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: request.params.id,
        metadata: { reason: "manual" },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "PUT",
    url: "/reverse-shares/files/:fileId",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "updateReverseShareFile",
      summary: "Update File from Reverse Share",
      description:
        "Update the name and/or description of a file uploaded to a reverse share. Only the creator of the reverse share can update files.",
      params: z.object({
        fileId: z.string().describe("Unique identifier of the file to update"),
      }),
      body: UpdateReverseShareFileSchema,
      response: {
        200: z.object({
          file: ReverseShareFileSchema,
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }
      const file = await reverseShareService.updateReverseShareFile(
        request.params.fileId,
        request.body,
        userId,
      );
      return reply.send({ file });
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/files/:fileId/copy",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "copyReverseShareFileToUserFiles",
      summary: "Copy File from Reverse Share to User Files",
      description:
        "Copy a file from a reverse share to the user's personal files. Only the creator of the reverse share can copy files. The file will be duplicated in storage and added to the user's file collection.",
      params: z.object({
        fileId: z.string().describe("Unique identifier of the file to copy"),
      }),
      response: {
        200: z.object({
          file: z.object({
            id: z.string(),
            name: z.string(),
            description: z.string().nullable(),
            extension: z.string(),
            size: z.string(),
            objectName: z.string(),
            userId: z.string(),
            createdAt: z.string(),
            updatedAt: z.string(),
          }),
          message: z.string(),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }
      const file = await uploadService.copyReverseShareFileToUserFiles(
        request.params.fileId,
        userId,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_FILE_COPY",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: request.params.fileId,
        metadata: { fileId: request.params.fileId },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ file, message: "File copied to your files successfully" });
    },
  });

  // Multipart upload routes for reverse shares (public - no auth required)
  app.route({
    method: "POST",
    url: "/reverse-shares/alias/:alias/multipart/create",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "createMultipartUploadByAlias",
      summary: "Create Multipart Upload for Reverse Share (Public)",
      description:
        "Initializes a multipart upload for large files (≥100MB) to a reverse share. Returns uploadId for subsequent part uploads.",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      body: z.object({
        filename: z.string().min(1).describe("The filename without extension"),
        extension: z.string().min(1).describe("The file extension"),
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
      }),
      response: {
        200: z.object({
          uploadId: z.string().describe("The upload ID for this multipart upload"),
          objectName: z.string().describe("The object name in storage"),
          message: z.string().describe("Success message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { alias } = request.params;
      const { filename, extension, password } = request.body;
      const result = await multipartService.createMultipartUploadByAlias(
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
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/alias/:alias/multipart/part-url",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "getMultipartPartUrlByAlias",
      summary: "Get Presigned URL for Part (Public)",
      description:
        "Gets a presigned URL for uploading a specific part of a multipart upload to a reverse share. Changed from GET to POST so that the password is sent in the request body rather than as a query parameter.",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      body: z.object({
        uploadId: z.string().min(1).describe("The multipart upload ID"),
        objectName: z.string().min(1).describe("The object name"),
        partNumber: z.string().min(1).describe("The part number (1-10000)"),
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
      }),
      response: {
        200: z.object({
          url: z.string().describe("The presigned URL for uploading this part"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { alias } = request.params;
      const { uploadId, objectName, partNumber, password } = request.body;

      const partNum = parseInt(partNumber, 10);
      if (Number.isNaN(partNum) || partNum < 1 || partNum > 10000) {
        throw new ValidationError("partNumber must be between 1 and 10000");
      }

      const result = await multipartService.getMultipartPartUrlByAlias(
        alias,
        uploadId,
        objectName,
        partNum,
        password,
      );
      return reply.status(200).send({ url: result.url });
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/alias/:alias/multipart/complete",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "completeMultipartUploadByAlias",
      summary: "Complete Multipart Upload (Public)",
      description:
        "Completes a multipart upload to a reverse share by combining all uploaded parts",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
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
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
        uploaderEmail: z.email().optional().describe("Optional self-declared uploader email"),
        uploaderName: z.string().optional().describe("Optional self-declared uploader name"),
      }),
      response: {
        200: z.object({
          message: z.string().describe("Success message"),
          objectName: z.string().describe("The completed object name"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { alias } = request.params;
      const { uploadId, objectName, parts, password, uploaderEmail, uploaderName } = request.body;
      const result = await multipartService.completeMultipartUploadByAlias(
        alias,
        uploadId,
        objectName,
        parts,
        password,
        { uploaderEmail, uploaderName },
      );
      return reply.status(200).send(result);
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/alias/:alias/multipart/abort",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "abortMultipartUploadByAlias",
      summary: "Abort Multipart Upload (Public)",
      description: "Aborts a multipart upload to a reverse share and cleans up all uploaded parts",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      body: z.object({
        uploadId: z.string().min(1).describe("The multipart upload ID"),
        objectName: z.string().min(1).describe("The object name"),
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
      }),
      response: {
        200: z.object({
          message: z.string().describe("Success message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { alias } = request.params;
      const { uploadId, objectName, password } = request.body;
      const result = await multipartService.abortMultipartUploadByAlias(
        alias,
        uploadId,
        objectName,
        password,
      );
      return reply.status(200).send(result);
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/alias/:alias/multipart/list-parts",
    config: { csrfExempt: true },
    schema: {
      tags: ["Reverse Share"],
      operationId: "listMultipartPartsByAlias",
      summary: "List Multipart Upload Parts (Public)",
      description:
        "Lists already-uploaded parts for a multipart upload to a reverse share, enabling upload resume after interruption",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      body: z.object({
        uploadId: z.string().min(1).describe("The multipart upload ID"),
        objectName: z.string().min(1).describe("The object name"),
        password: z
          .string()
          .optional()
          .describe("Password for accessing password-protected reverse shares"),
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
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        410: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { alias } = request.params;
      const { uploadId, objectName, password } = request.body;
      const parts = await multipartService.listPartsByAlias(alias, uploadId, objectName, password);
      return reply.status(200).send({ parts });
    },
  });

  // ── Recipient management ────────────────────────────────────────────────────

  app.route({
    method: "POST",
    url: "/reverse-shares/:id/recipients",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "addReverseShareRecipients",
      summary: "Add recipients to a reverse share",
      description:
        "Add one or more recipients to a reverse share. Recipients can later be notified " +
        "via POST /reverse-shares/:id/notify. Only the creator can manage recipients.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      body: UpdateReverseShareRecipientsSchema,
      response: {
        200: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const reverseShare = await reverseShareService.addRecipients(
        request.params.id,
        userId,
        request.body.recipients,
      );
      const emailList = request.body.recipients.map((r) => r.email);
      logAuditEvent({
        action: "REVERSE_SHARE_RECIPIENT_ADD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: request.params.id,
        metadata: { count: emailList.length, emails: emailList },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "DELETE",
    url: "/reverse-shares/:id/recipients",
    preValidation,
    schema: {
      tags: ["Reverse Share"],
      operationId: "removeReverseShareRecipients",
      summary: "Remove recipients from a reverse share",
      description:
        "Remove one or more recipients from a reverse share by email. Only the creator can manage recipients.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      body: RemoveReverseShareRecipientsSchema,
      response: {
        200: z.object({
          reverseShare: ReverseShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const reverseShare = await reverseShareService.removeRecipients(
        request.params.id,
        userId,
        request.body.emails,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_RECIPIENT_REMOVE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: request.params.id,
        metadata: { count: request.body.emails.length, emails: request.body.emails },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ reverseShare });
    },
  });

  app.route({
    method: "POST",
    url: "/reverse-shares/:id/notify",
    preValidation,
    config: {
      rateLimit: { max: 5, timeWindow: "10 minutes" },
    },
    schema: {
      tags: ["Reverse Share"],
      operationId: "notifyReverseShareRecipients",
      summary: "Send email invitation to reverse share recipients",
      description:
        "Sends reverse-share-invitation emails to recipients that already exist on the reverse share. " +
        "Recipients are created via POST /reverse-shares/:id/recipients. " +
        "Pass `emails` to notify a subset, or omit to notify all recipients.",
      params: z.object({
        id: z.string().describe("Unique identifier of the reverse share"),
      }),
      body: NotifyReverseShareRecipientsSchema,
      response: {
        200: z.object({
          notifiedRecipients: z.array(z.string()).describe("List of notified email addresses"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
        // Per-user anti-spam quota / burst cap (A6-03).
        429: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const result = await reverseShareService.notifyRecipients(
        request.params.id,
        userId,
        request.body.emails,
      );
      logAuditEvent({
        action: "REVERSE_SHARE_RECIPIENT_NOTIFY",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "reverse_share",
        targetId: request.params.id,
        metadata: {
          recipientCount: result.notifiedRecipients.length,
          emails: result.notifiedRecipients,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send(result);
    },
  });

  app.route({
    method: "GET",
    url: "/reverse-shares/alias/:alias/metadata",
    // Per-IP enumeration rate limit (R2 — A4-12): public metadata over guessable aliases.
    config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    schema: {
      tags: ["Reverse Share"],
      operationId: "getReverseShareMetadataByAlias",
      summary: "Get reverse share metadata by alias for Open Graph",
      description:
        "Get lightweight metadata for a reverse share by alias, used for social media previews",
      params: z.object({
        alias: z.string().describe("Alias of the reverse share"),
      }),
      response: {
        200: z.object({
          name: z.string().nullable(),
          description: z.string().nullable(),
          totalFiles: z.number(),
          hasPassword: z.boolean(),
          isExpired: z.boolean(),
          isInactive: z.boolean(),
          maxFiles: z.number().nullable(),
          nameFieldRequired: FieldRequirementSchema,
          emailFieldRequired: FieldRequirementSchema,
        }),
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const metadata = await reverseShareService.getReverseShareMetadataByAlias(
        request.params.alias,
      );
      return reply.send(metadata);
    },
  });
};
