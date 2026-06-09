import crypto from "node:crypto";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { getContentType } from "@ouitransfer/shared/mime-types";
import bcrypt from "bcryptjs";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { prisma } from "../../shared/prisma.js";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import {
  generateUniqueFileName,
  generateUniqueFileNameForRename,
  parseFileName,
} from "../../utils/file-name-generator.js";
import { getLogger } from "../../utils/logger.js";
import { sanitizeFilename } from "../../utils/sanitize-filename.js";
import { isMimeTypeConsistent, verifyMagicBytes } from "../../utils/validate-file-content.js";
import { validateObjectName } from "../../utils/validate-object-name.js";
import { logAuditEvent } from "../audit/service.js";
import { emailService } from "../email/service.js";
import { quotaService } from "../quota/service.js";
import {
  resolveDownloadRecipient,
  resolveDownloadRecipientFromRequest,
} from "../share/recipient-resolution.js";
import { parseVisitorCookie, type VisitorIdentity } from "../share/visitor-cookie.js";
import {
  CheckFileSchema,
  ListFilesSchema,
  MoveFileSchema,
  RegisterFileSchema,
  UpdateFileSchema,
} from "./dto.js";
import { getAncestorFolderIds } from "./folder-ancestors.js";
import { FileService } from "./service.js";

const fileService = new FileService();

// ── Module-level helpers ─────────────────────────────────────

/**
 * Recursively retrieve all files for a user across all folders.
 */
async function getAllUserFilesRecursively(userId: string): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    extension: string;
    size: bigint;
    objectName: string;
    userId: string;
    folderId: string | null;
    relativePath?: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>
> {
  const rootFiles = await prisma.file.findMany({
    where: { userId, folderId: null },
  });

  const rootFolders = await prisma.folder.findMany({
    where: { userId, parentId: null },
    select: { id: true },
  });

  let allFiles = [...rootFiles];

  if (rootFolders.length > 0) {
    const { FolderService } = await import("../folder/service.js");
    const folderService = new FolderService();

    for (const folder of rootFolders) {
      const folderFiles = await folderService.getAllFilesInFolder(folder.id, userId);
      allFiles = [...allFiles, ...folderFiles];
    }
  }

  return allFiles;
}

/**
 * Shared access-check logic for file downloads.
 * Verifies the caller has access to a file via share password, public share,
 * or file ownership (JWT). Returns true if access is granted.
 *
 * @param ancestorFolderIds - Pre-resolved ancestor folder IDs for the file (from
 *   getAncestorFolderIds). Passed in to avoid redundant DB lookups — the caller
 *   already has the file record with folderId.
 */
async function checkFileAccess(
  fileId: string,
  fileUserId: string,
  password: string | undefined,
  request: FastifyRequest,
  ancestorFolderIds: string[],
): Promise<boolean> {
  // Check share-based access: direct file OR file in shared folder tree
  const shareWhere: Prisma.ShareWhereInput =
    ancestorFolderIds.length > 0
      ? {
          OR: [
            { files: { some: { id: fileId } } },
            { folders: { some: { id: { in: ancestorFolderIds } } } },
          ],
        }
      : { files: { some: { id: fileId } } };

  const shares = await prisma.share.findMany({
    where: shareWhere,
    include: { security: true },
  });

  for (const share of shares) {
    if (!share.security.password) {
      return true;
    }
    if (password) {
      const isPasswordValid = await bcrypt.compare(password, share.security.password);
      if (isPasswordValid) {
        return true;
      }
    }
  }

  // Fall back to JWT-based ownership check
  try {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (userId && fileUserId === userId) {
      return true;
    }
  } catch (_err) {
    // Expected: anonymous access for public shares — JWT verification is optional
    request.log.debug("Optional JWT verification skipped — anonymous access");
  }

  return false;
}

/**
 * Shared download-tracking logic for share-based file downloads.
 * Verifies the file belongs to the share, checks if requester is the owner,
 * and if not: records a ShareVisit, updates lastDownloadedAt, and sends
 * a share_downloaded notification — all fire-and-forget.
 *
 * @param requestUserId - The authenticated user's ID, or undefined for anonymous access.
 *   Passed from the route handler to avoid redundant `request.jwtVerify()` calls.
 * @param ancestorFolderIds - Pre-resolved ancestor folder IDs (from getAncestorFolderIds).
 *   Shared with checkFileAccess to avoid duplicate DB lookups.
 */
async function trackShareDownload(
  request: FastifyRequest,
  fileRecord: { id: string; name: string },
  shareId: string,
  requestUserId: string | undefined,
  ancestorFolderIds: string[],
): Promise<void> {
  const trackingShareWhere =
    ancestorFolderIds.length > 0
      ? {
          id: shareId,
          OR: [
            { files: { some: { id: fileRecord.id } } },
            { folders: { some: { id: { in: ancestorFolderIds } } } },
          ],
        }
      : {
          id: shareId,
          files: { some: { id: fileRecord.id } },
        };

  // Verify file belongs to this share
  const shareWithFile = await prisma.share.findFirst({
    where: trackingShareWhere,
    include: {
      creator: { select: { email: true, locale: true, isActive: true } },
      alias: true,
    },
  });

  if (!shareWithFile) return;

  // Determine if the requester is the share owner
  const isOwner = requestUserId !== undefined && requestUserId === shareWithFile.creatorId;

  if (isOwner) return;

  // Resolve visitor identity from the signed identification cookie (sv_{alias}).
  // The cookie is set during share access when the visitor identifies themselves.
  let visitorName: string | undefined;
  let visitorEmail: string | undefined;
  let visitorCookie: VisitorIdentity | undefined;

  if (shareWithFile.alias) {
    visitorCookie = parseVisitorCookie(request, shareWithFile.alias.alias);
    if (visitorCookie) {
      visitorName = visitorCookie.name;
      visitorEmail = visitorCookie.email;
    }
  }

  // Link this download to a ShareRecipient using the same resolver as the access flow:
  // cookie.recipientId (token-verified) → "token"; else cookie.email match → "self_declared".
  const resolvedRecipient = await resolveDownloadRecipient({ shareId, cookie: visitorCookie });

  // Fire and forget — don't block the response.
  // Await visit insert before notification: if the visit record fails,
  // don't notify the owner about a download that was never recorded.
  (async () => {
    try {
      await prisma.shareVisit.create({
        data: {
          shareId,
          fileId: fileRecord.id,
          recipientId: resolvedRecipient?.recipientId,
          visitorName,
          visitorEmail,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          action: "download",
          identificationSource: resolvedRecipient?.identificationSource,
        },
      });
    } catch (err) {
      getLogger().error({ err }, "Failed to create ShareVisit for download");
      return; // Don't notify — the visit was never recorded
    }

    // Bump per-recipient download stats atomically when a recipient is linked.
    // downloadCount counts files fetched (this runs once per file), not sessions.
    if (resolvedRecipient) {
      prisma.shareRecipient
        .update({
          where: { id: resolvedRecipient.recipientId },
          data: { downloadCount: { increment: 1 }, lastDownloadedAt: new Date() },
        })
        .catch((err) => getLogger().error({ err }, "Failed to update recipient download stats"));
    }

    // Update lastDownloadedAt and reset inactivityAlertSent so a future
    // inactivity cycle can trigger another alert (independent, non-blocking)
    prisma.share
      .update({
        where: { id: shareId },
        data: { lastDownloadedAt: new Date(), inactivityAlertSent: false },
      })
      .catch((err) => getLogger().error({ err }, "Failed to update share lastDownloadedAt"));

    // Notify share owner
    // Skip notification when creator account is deactivated (consistent with scheduler checks)
    if (
      shareWithFile.creatorId &&
      shareWithFile.creator?.email &&
      shareWithFile.creator?.isActive !== false
    ) {
      try {
        const { buildShareManageUrl } = await import("../email/url-builder.js");
        const shareManageUrl = await buildShareManageUrl(shareId);
        await emailService.send("share_downloaded", {
          to: shareWithFile.creator!.email,
          locale: shareWithFile.creator!.locale ?? "en",
          userId: shareWithFile.creatorId!,
          relatedId: shareId,
          data: {
            shareName: shareWithFile.name ?? "Unnamed share",
            fileName: fileRecord.name,
            visitorName,
            visitorEmail,
            downloadedAt: new Date().toISOString(),
            shareManageUrl,
          },
        });
      } catch (err) {
        getLogger().error({ err }, "Failed to send share_downloaded notification");
      }
    }
  })().catch(() => {});
}

// ── Pre-validation hook ──────────────────────────────────────

const preValidation = createJwtPreValidation();

// ── Routes ───────────────────────────────────────────────────

export const fileRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /files/presigned-url — get presigned upload URL
  app.route({
    method: "GET",
    url: "/files/presigned-url",
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
    handler: async (request, reply) => {
      const { filename, extension } = request.query;

      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const safeFilename = sanitizeFilename(`${filename}.${extension}`);
      const objectName = `${userId}/${crypto.randomUUID()}-${safeFilename}`;
      const expires = env.PRESIGNED_URL_EXPIRATION;

      const url = await fileService.getPresignedPutUrl(objectName, expires);

      const limits = await quotaService.resolveEffectiveLimits(userId);
      const maxFileSize = limits.maxFileSize === 0n ? 0 : Number(limits.maxFileSize);

      return reply.status(200).send({ url, objectName, maxFileSize });
    },
  });

  // POST /files — register file metadata
  app.route({
    method: "POST",
    url: "/files",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const input = request.body;

      // Validate objectName ownership: must be under the user's namespace
      validateObjectName(input.objectName, userId);

      // Layer 1: MIME/extension consistency check
      if (input.mimeType && !isMimeTypeConsistent(input.mimeType, input.extension)) {
        throw new ValidationError("File type does not match the declared extension");
      }

      // Layer 2: Magic-byte verification (read first 4 KB from S3)
      if (input.mimeType) {
        try {
          const headBuffer = await fileService.getObjectHead(input.objectName);
          const magicResult = await verifyMagicBytes(headBuffer, input.mimeType);
          if (!magicResult.valid) {
            request.log.warn(
              {
                declared: magicResult.declared,
                detected: magicResult.detected,
                objectName: input.objectName,
              },
              "Magic-byte mismatch detected",
            );
            throw new ValidationError("File content does not match the declared file type");
          }
        } catch (err) {
          if (err instanceof AppError) throw err;

          const message =
            err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
          const isExpectedFailure =
            message.includes("range") ||
            message.includes("not supported") ||
            message.includes("empty response") ||
            message.includes("nosuchkey") ||
            message.includes("not found");

          if (isExpectedFailure) {
            request.log.debug(
              { objectName: input.objectName, reason: message },
              "Magic-byte verification skipped (expected S3 limitation)",
            );
          } else {
            request.log.warn(
              { err, objectName: input.objectName },
              "Magic-byte verification skipped (unexpected S3 error)",
            );
          }
        }
      }

      const limits = await quotaService.resolveEffectiveLimits(userId);

      // Per-file size check (skip if unlimited)
      if (limits.maxFileSize > 0n && BigInt(input.size) > limits.maxFileSize) {
        const maxSizeMB = Number(limits.maxFileSize) / (1024 * 1024);
        throw new AppError(
          400,
          `File size exceeds the maximum allowed size of ${maxSizeMB.toFixed(0)}MB`,
          ErrorCodes.FILE_SIZE_EXCEEDED,
          { maxSizeMB: maxSizeMB.toFixed(0) },
        );
      }

      // Total storage check (skip if unlimited). Direct uploads keep HARD
      // enforcement at the limit — only reverse-share external uploads get the
      // B3 soft-overage tolerance. `usedBefore` is captured so the post-register
      // B1 warning evaluation can compute the usage transition without an extra
      // query (only meaningful when a limit applies).
      let usedBefore: bigint | null = null;
      if (limits.maxTotalStorage > 0n) {
        const currentStorage = await quotaService.calculateStorageUsed(userId);
        usedBefore = currentStorage;
        if (currentStorage + BigInt(input.size) > limits.maxTotalStorage) {
          const availableSpace = Number(limits.maxTotalStorage - currentStorage) / (1024 * 1024);
          throw new AppError(
            400,
            `Insufficient storage space. You have ${availableSpace.toFixed(2)}MB available`,
            ErrorCodes.INSUFFICIENT_STORAGE,
            { availableSpaceMB: availableSpace.toFixed(2) },
          );
        }
      }

      if (input.folderId) {
        const folder = await prisma.folder.findFirst({
          where: { id: input.folderId, userId },
        });
        if (!folder) {
          throw new ValidationError("Folder not found or access denied.");
        }
      }

      // Parse the filename and generate a unique name if there's a duplicate
      const { baseName, extension } = parseFileName(input.name);
      const uniqueName = await generateUniqueFileName(baseName, extension, userId, input.folderId);

      const fileRecord = await prisma.file.create({
        data: {
          name: uniqueName,
          description: input.description,
          extension: input.extension,
          size: BigInt(input.size),
          objectName: input.objectName,
          userId,
          folderId: input.folderId,
        },
      });

      const fileResponse = {
        id: fileRecord.id,
        name: fileRecord.name,
        description: fileRecord.description,
        extension: fileRecord.extension,
        size: fileRecord.size.toString(),
        objectName: fileRecord.objectName,
        userId: fileRecord.userId,
        folderId: fileRecord.folderId,
        createdAt: fileRecord.createdAt,
        updatedAt: fileRecord.updatedAt,
      };

      logAuditEvent({
        action: "FILE_UPLOAD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "file",
        targetId: fileRecord.id,
        metadata: {
          name: fileRecord.name,
          extension: fileRecord.extension,
          size: fileRecord.size.toString(),
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      // B1 threshold warnings (5.2 Phase B): evaluate the usage transition AFTER
      // the file row exists. Fire-and-forget — never block the upload response and
      // never throw into this path (the method swallows its own errors). Skipped
      // for unlimited quotas, where `usedBefore` is null.
      if (usedBefore !== null) {
        const newUsed = usedBefore + BigInt(input.size);
        void quotaService.evaluateAndNotifyQuota(userId, { oldUsed: usedBefore, newUsed });
      }

      return reply.status(201).send({
        file: fileResponse,
        message: "File registered successfully.",
      });
    },
  });

  // POST /files/check — check file validity
  app.route({
    method: "POST",
    url: "/files/check",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const input = request.body;

      const limits = await quotaService.resolveEffectiveLimits(userId);

      // Per-file size check (skip if unlimited)
      if (limits.maxFileSize > 0n && BigInt(input.size) > limits.maxFileSize) {
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
        const currentStorage = await quotaService.calculateStorageUsed(userId);
        if (currentStorage + BigInt(input.size) > limits.maxTotalStorage) {
          const availableSpace = Number(limits.maxTotalStorage - currentStorage) / (1024 * 1024);
          throw new AppError(
            400,
            `Insufficient storage space. You have ${availableSpace.toFixed(2)}MB available`,
            ErrorCodes.INSUFFICIENT_STORAGE,
            { availableSpaceMB: availableSpace.toFixed(2) },
          );
        }
      }

      // Check for duplicate filename and provide the suggested unique name
      const { baseName, extension } = parseFileName(input.name);
      const uniqueName = await generateUniqueFileName(baseName, extension, userId, input.folderId);

      const response: { message: string; suggestedName?: string } = {
        message: "File checks succeeded.",
      };

      if (uniqueName !== input.name) {
        response.suggestedName = uniqueName;
      }

      return reply.status(201).send(response);
    },
  });

  // GET /files — list files
  app.route({
    method: "GET",
    url: "/files",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const { folderId, recursive: recursiveStr } = request.query;
      const recursive = recursiveStr !== "false";

      let files: Array<{
        id: string;
        name: string;
        description: string | null;
        extension: string;
        size: bigint;
        objectName: string;
        userId: string;
        folderId: string | null;
        relativePath?: string | null;
        createdAt: Date;
        updatedAt: Date;
      }>;

      let targetFolderId: string | null;
      if (folderId === "null" || folderId === "" || !folderId) {
        targetFolderId = null;
      } else {
        targetFolderId = folderId;
      }

      if (recursive) {
        if (targetFolderId === null) {
          files = await getAllUserFilesRecursively(userId);
        } else {
          const { FolderService } = await import("../folder/service.js");
          const folderService = new FolderService();
          files = await folderService.getAllFilesInFolder(targetFolderId, userId);
        }
      } else {
        files = await prisma.file.findMany({
          where: { userId, folderId: targetFolderId },
        });
      }

      const filesResponse = files.map((file) => ({
        id: file.id,
        name: file.name,
        description: file.description,
        extension: file.extension,
        size: typeof file.size === "bigint" ? file.size.toString() : file.size,
        objectName: file.objectName,
        userId: file.userId,
        folderId: file.folderId,
        relativePath: file.relativePath || null,
        createdAt: file.createdAt,
        updatedAt: file.updatedAt,
      }));

      return reply.send({ files: filesResponse });
    },
  });

  // PATCH /files/:id — update file metadata
  app.route({
    method: "PATCH",
    url: "/files/:id",
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
    handler: async (request, reply) => {
      const { id } = request.params;
      const userId = request.user?.userId;

      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const updateData = request.body;

      const fileRecord = await prisma.file.findUnique({ where: { id } });

      if (!fileRecord) {
        throw new NotFoundError("File not found.");
      }

      if (fileRecord.userId !== userId) {
        throw new ForbiddenError("Access denied.");
      }

      // If renaming the file, check for duplicates and auto-rename if necessary
      // We need a mutable copy since we may modify the name
      const mutableData = { ...updateData };
      if (mutableData.name && mutableData.name !== fileRecord.name) {
        const { baseName, extension } = parseFileName(mutableData.name);
        const uniqueName = await generateUniqueFileNameForRename(
          baseName,
          extension,
          userId,
          fileRecord.folderId,
          id,
        );
        mutableData.name = uniqueName;
      }

      const updatedFile = await prisma.file.update({
        where: { id },
        data: mutableData,
      });

      const fileResponse = {
        id: updatedFile.id,
        name: updatedFile.name,
        description: updatedFile.description,
        extension: updatedFile.extension,
        size: updatedFile.size.toString(),
        objectName: updatedFile.objectName,
        userId: updatedFile.userId,
        folderId: updatedFile.folderId,
        createdAt: updatedFile.createdAt,
        updatedAt: updatedFile.updatedAt,
      };

      logAuditEvent({
        action: "FILE_UPDATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "file",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send({
        file: fileResponse,
        message: "File updated successfully.",
      });
    },
  });

  // PUT /files/:id/move — move file
  app.route({
    method: "PUT",
    url: "/files/:id/move",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;

      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }

      const { id } = request.params;
      const input = request.body;

      const existingFile = await prisma.file.findFirst({
        where: { id, userId },
      });

      if (!existingFile) {
        throw new NotFoundError("File not found.");
      }

      if (input.folderId) {
        const targetFolder = await prisma.folder.findFirst({
          where: { id: input.folderId, userId },
        });
        if (!targetFolder) {
          throw new ValidationError("Target folder not found.");
        }
      }

      const updatedFile = await prisma.file.update({
        where: { id },
        data: { folderId: input.folderId },
      });

      const fileResponse = {
        id: updatedFile.id,
        name: updatedFile.name,
        description: updatedFile.description,
        extension: updatedFile.extension,
        size: updatedFile.size.toString(),
        objectName: updatedFile.objectName,
        userId: updatedFile.userId,
        folderId: updatedFile.folderId,
        createdAt: updatedFile.createdAt,
        updatedAt: updatedFile.updatedAt,
      };

      logAuditEvent({
        action: "FILE_MOVE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "file",
        targetId: request.params.id,
        metadata: { targetFolderId: input.folderId ?? null },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send({
        file: fileResponse,
        message: "File moved successfully.",
      });
    },
  });

  // DELETE /files/:id — delete file
  app.route({
    method: "DELETE",
    url: "/files/:id",
    preValidation,
    schema: {
      tags: ["File"],
      operationId: "deleteFile",
      summary: "Delete File",
      description:
        "Deletes a user file. Returns 409 if the file belongs to shares and force is not set.",
      params: z.object({
        id: z.string().min(1, "The file id is required").describe("The file ID"),
      }),
      querystring: z.object({
        force: z.coerce.boolean().optional().default(false),
      }),
      response: {
        200: z.object({
          message: z.string().describe("The file deletion message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
        409: z.object({
          error: z.string(),
          shareCount: z.number().describe("Number of shares containing this file"),
          message: z.string(),
        }),
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const { force } = request.query;

      const fileRecord = await prisma.file.findUnique({
        where: { id },
        include: { shares: { select: { id: true } } },
      });
      if (!fileRecord) {
        throw new NotFoundError("File not found.");
      }

      const userId = request.user?.userId;
      if (fileRecord.userId !== userId) {
        throw new ForbiddenError("Access denied.");
      }

      if (fileRecord.shares.length > 0 && !force) {
        return reply.status(409).send({
          error: "FILE_IN_SHARES",
          shareCount: fileRecord.shares.length,
          message: `This file is included in ${fileRecord.shares.length} share(s). Use force=true to delete it anyway.`,
        });
      }

      if (force && fileRecord.shares.length > 0) {
        app.log.info(
          {
            event: "file_force_deleted_from_shares",
            fileId: id,
            userId,
            shareIds: fileRecord.shares.map((s) => s.id),
          },
          "File force-deleted from shares",
        );
      }

      await prisma.file.delete({ where: { id } });
      await fileService.deleteObject(fileRecord.objectName);

      logAuditEvent({
        action: "FILE_DELETE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "file",
        targetId: id,
        metadata: { name: fileRecord.name },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send({ message: "File deleted successfully." });
    },
  });

  // ── Download routes ─────────────────────────────────────────

  // POST /files/download-url — get presigned download URL
  app.route({
    method: "POST",
    url: "/files/download-url",
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
        shareId: z.string().optional().describe("Share ID for download tracking"),
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
    handler: async (request, reply) => {
      const { objectName, password, shareId } = request.body;

      const fileRecord = await prisma.file.findFirst({ where: { objectName } });

      if (!fileRecord) {
        throw new NotFoundError("File not found.");
      }

      // Resolve ancestor folders once — shared between access check and download tracking
      const ancestorFolderIds = await getAncestorFolderIds(prisma, fileRecord.folderId);

      const hasAccess = await checkFileAccess(
        fileRecord.id,
        fileRecord.userId,
        password,
        request,
        ancestorFolderIds,
      );

      if (!hasAccess) {
        throw new UnauthorizedError("Unauthorized access to file.");
      }

      const fileName = fileRecord.name;
      const expires = env.PRESIGNED_GET_URL_EXPIRATION;

      const url = await fileService.getPresignedGetUrl(objectName, expires, fileName);

      // Enrich the (already-emitted) FILE_DOWNLOAD audit with the resolved recipient + source
      // when this is a share download. Best-effort, share-scoped; never a second emit.
      const auditRecipient = shareId
        ? await resolveDownloadRecipientFromRequest(request, shareId)
        : null;

      logAuditEvent({
        action: "FILE_DOWNLOAD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId: request.user?.userId,
        targetType: "file",
        targetId: fileRecord.id,
        metadata: {
          method: "presigned-url",
          ...(shareId ? { shareId } : {}),
          ...(auditRecipient
            ? {
                recipientId: auditRecipient.recipientId,
                identificationSource: auditRecipient.identificationSource,
              }
            : {}),
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      // Track download if shareId provided (fire-and-forget)
      if (shareId) {
        trackShareDownload(
          request,
          fileRecord,
          shareId,
          request.user?.userId,
          ancestorFolderIds,
        ).catch((err) => getLogger().error({ err }, "Failed to track share download"));
      }

      return reply.send({ url, expiresIn: expires });
    },
  });

  // POST /files/download — download file (streaming)
  app.route({
    method: "POST",
    url: "/files/download",
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
        shareId: z.string().optional().describe("Share ID for download tracking"),
      }),
    },
    handler: async (request, reply) => {
      const { objectName, password, shareId } = request.body;

      const fileRecord = await prisma.file.findFirst({ where: { objectName } });

      if (!fileRecord) {
        // Check reverse-share files
        if (objectName.startsWith("reverse-shares/")) {
          const reverseShareFile = await prisma.reverseShareFile.findFirst({
            where: { objectName },
            include: {
              reverseShare: true,
            },
          });

          if (!reverseShareFile) {
            throw new NotFoundError("File not found.");
          }

          try {
            await request.jwtVerify();
            const userId = request.user?.userId;

            if (!userId || reverseShareFile.reverseShare.creatorId !== userId) {
              throw new UnauthorizedError("Unauthorized access to file.");
            }
          } catch (err) {
            if (err instanceof UnauthorizedError) {
              throw err;
            }
            request.log.debug({ err }, "JWT verification failed for reverse-share download");
            throw new UnauthorizedError("Unauthorized access to file.");
          }

          const stream = await fileService.getObjectStream(objectName);
          const contentType = getContentType(reverseShareFile.name);
          const fileName = reverseShareFile.name;

          reply.header("Content-Type", contentType);
          reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
          reply.header("Content-Length", reverseShareFile.size.toString());

          return reply.send(stream);
        }

        throw new NotFoundError("File not found.");
      }

      // Resolve ancestor folders once — shared between access check and download tracking
      const ancestorFolderIds = await getAncestorFolderIds(prisma, fileRecord.folderId);

      const hasAccess = await checkFileAccess(
        fileRecord.id,
        fileRecord.userId,
        password,
        request,
        ancestorFolderIds,
      );

      if (!hasAccess) {
        throw new UnauthorizedError("Unauthorized access to file.");
      }

      // Enrich the (already-emitted) FILE_DOWNLOAD audit with the resolved recipient + source
      // when this is a share download. Best-effort, share-scoped; never a second emit.
      const auditRecipient = shareId
        ? await resolveDownloadRecipientFromRequest(request, shareId)
        : null;

      logAuditEvent({
        action: "FILE_DOWNLOAD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId: request.user?.userId,
        targetType: "file",
        targetId: fileRecord.id,
        metadata: {
          method: "stream",
          ...(shareId ? { shareId } : {}),
          ...(auditRecipient
            ? {
                recipientId: auditRecipient.recipientId,
                identificationSource: auditRecipient.identificationSource,
              }
            : {}),
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      // Track download if shareId provided (fire-and-forget)
      if (shareId) {
        trackShareDownload(
          request,
          fileRecord,
          shareId,
          request.user?.userId,
          ancestorFolderIds,
        ).catch((err) => getLogger().error({ err }, "Failed to track share download"));
      }

      const stream = await fileService.getObjectStream(objectName);
      const contentType = getContentType(fileRecord.name);
      const fileName = fileRecord.name;

      reply.header("Content-Type", contentType);
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
      reply.header("Content-Length", fileRecord.size.toString());

      return reply.send(stream);
    },
  });

  // ── Multipart upload routes ────────────────────────────────

  // POST /files/multipart/create — initialize multipart upload
  app.route({
    method: "POST",
    url: "/files/multipart/create",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { filename, extension } = request.body;

      const safeFilename = sanitizeFilename(`${filename}.${extension}`);
      const objectName = `${userId}/${crypto.randomUUID()}-${safeFilename}`;

      const uploadId = await fileService.createMultipartUpload(objectName);

      return reply.status(200).send({
        uploadId,
        objectName,
        message: "Multipart upload initialized",
      });
    },
  });

  // GET /files/multipart/part-url — get presigned URL for part
  app.route({
    method: "GET",
    url: "/files/multipart/part-url",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { uploadId, objectName, partNumber } = request.query;

      const partNum = parseInt(partNumber, 10);
      if (Number.isNaN(partNum) || partNum < 1 || partNum > 10000) {
        throw new ValidationError("partNumber must be between 1 and 10000");
      }

      validateObjectName(objectName, userId);

      const expires = env.PRESIGNED_URL_EXPIRATION;

      const url = await fileService.getPresignedPartUrl(objectName, uploadId, partNum, expires);

      return reply.status(200).send({ url });
    },
  });

  // POST /files/multipart/complete — complete multipart upload
  app.route({
    method: "POST",
    url: "/files/multipart/complete",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { uploadId, objectName, parts } = request.body;

      validateObjectName(objectName, userId);

      await fileService.completeMultipartUpload(objectName, uploadId, parts);

      return reply.status(200).send({
        message: "Multipart upload completed successfully",
        objectName,
      });
    },
  });

  // POST /files/multipart/abort — abort multipart upload
  app.route({
    method: "POST",
    url: "/files/multipart/abort",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { uploadId, objectName } = request.body;

      validateObjectName(objectName, userId);

      await fileService.abortMultipartUpload(objectName, uploadId);

      return reply.status(200).send({
        message: "Multipart upload aborted successfully",
      });
    },
  });

  // GET /files/multipart/list-parts — list uploaded parts
  app.route({
    method: "GET",
    url: "/files/multipart/list-parts",
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
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      const { uploadId, objectName } = request.query;

      validateObjectName(objectName, userId);

      const parts = await fileService.listParts(objectName, uploadId);

      return reply.status(200).send({ parts });
    },
  });
};
