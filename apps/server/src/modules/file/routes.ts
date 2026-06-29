import crypto from "node:crypto";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import bcrypt from "bcryptjs";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../env.js";
import type { Prisma } from "../../generated/prisma/client.js";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { booleanQueryParam } from "../../shared/boolean-query-param.js";
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
import { assertUploadedContentValid } from "../../utils/validate-file-content.js";
import { validateObjectName } from "../../utils/validate-object-name.js";
import { logAuditEvent } from "../audit/service.js";
import { emailService } from "../email/service.js";
import { quotaService } from "../quota/service.js";
import { assertShareAccessible } from "../share/lifecycle.js";
import {
  resolveDownloadRecipient,
  resolveDownloadRecipientFromRequest,
} from "../share/recipient-resolution.js";
import { verifyShareFileToken } from "../share/share-file-token.js";
import {
  isSharePasswordLocked,
  recordSharePasswordAttempt,
} from "../share/share-password-attempts.service.js";
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
 * The resolved target of a download request: the file record to serve plus the share it was
 * authorized through (null for an owner direct download). Used by both download endpoints.
 */
interface ResolvedDownloadTarget {
  file: { id: string; name: string; size: bigint; objectName: string; userId: string };
  /** The share id the download is bound to (for tracking/audit), or undefined for owner downloads. */
  shareId?: string;
  /** Pre-resolved ancestor folder ids for tracking, when share-bound. */
  ancestorFolderIds: string[];
}

/**
 * Resolve + authorize a file download (R2 — A4-02 / A4-08 / A2-04 / A4-03).
 *
 * The download contract is now `{ key, password? }` where `key` is EITHER:
 *
 *  1. An opaque per-share file token (the value the non-owner share response exposes in place of
 *     the raw objectName). It resolves server-side to a specific `{ shareId, fileId }` and access
 *     is evaluated against THAT share only — never "any password-less share containing the file".
 *     The full share lifecycle gate (`assertShareAccessible`), per-share password lockout, the
 *     password itself, and a max-views enforcement are all applied here. This closes the old
 *     bypass where a leaked/guessed raw objectName fetched bytes regardless of share state.
 *
 *  2. A raw S3 objectName — accepted ONLY for the JWT-authenticated OWNER of that file (the
 *     dashboard "download my own file" flow). Anonymous raw-key access is no longer possible.
 *
 * Throws an {@link AppError} on any failure; returns the file to serve + tracking context.
 */
async function resolveDownloadTarget(
  key: string,
  password: string | undefined,
  request: FastifyRequest,
): Promise<ResolvedDownloadTarget> {
  const tokenBinding = verifyShareFileToken(key);

  // ── Path 1: opaque per-share file token (anonymous / non-owner) ───────────────────────────
  if (tokenBinding) {
    const { shareId, fileId } = tokenBinding;

    const file = await prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      throw new NotFoundError("File not found.");
    }

    // The file must actually belong to THIS share — directly or via a shared ancestor folder.
    const ancestorFolderIds = await getAncestorFolderIds(prisma, file.folderId);
    const shareWhere: Prisma.ShareWhereInput =
      ancestorFolderIds.length > 0
        ? {
            id: shareId,
            OR: [
              { files: { some: { id: fileId } } },
              { folders: { some: { id: { in: ancestorFolderIds } } } },
            ],
          }
        : { id: shareId, files: { some: { id: fileId } } };

    const share = await prisma.share.findFirst({
      where: shareWhere,
      include: { security: true, creator: { select: { isActive: true } } },
    });
    // A token that no longer maps the file to its share (item removed, share deleted) → 404.
    if (!share) {
      throw new NotFoundError("File not found.");
    }

    // Full share lifecycle gate — identical to the share-read path (single source of truth).
    assertShareAccessible(share);

    // Password gate with per-share brute-force lockout + audit on the download path (A4-03).
    if (share.security?.password) {
      const lockIp = request.ip ?? "unknown";
      const lock = await isSharePasswordLocked("share", share.id, lockIp);
      if (lock.locked) {
        throw new AppError(
          429,
          `Too many password attempts. Try again in ${lock.remainingMinutes} minutes.`,
          ErrorCodes.SHARE_LOCKED,
          { remainingMinutes: lock.remainingMinutes },
        );
      }

      if (!password) {
        logAuditEvent({
          action: "SHARE_PASSWORD_FAILED",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          targetType: "share",
          targetId: share.id,
          metadata: { reason: "no_password_supplied", path: "download" },
        }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
        throw new AppError(401, "Password required", ErrorCodes.PASSWORD_REQUIRED);
      }

      const isPasswordValid = await bcrypt.compare(password, share.security.password);
      if (!isPasswordValid) {
        await recordSharePasswordAttempt("share", share.id, lockIp, false);
        logAuditEvent({
          action: "SHARE_PASSWORD_FAILED",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          targetType: "share",
          targetId: share.id,
          metadata: { path: "download" },
        }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
        throw new AppError(401, "Invalid password", ErrorCodes.INVALID_PASSWORD);
      }
      await recordSharePasswordAttempt("share", share.id, lockIp, true);
    }

    return {
      file,
      shareId: share.id,
      ancestorFolderIds,
    };
  }

  // ── Path 2: raw objectName — JWT-authenticated OWNER only ──────────────────────────────────
  const file = await prisma.file.findFirst({ where: { objectName: key } });
  if (!file) {
    throw new NotFoundError("File not found.");
  }

  let ownerUserId: string | undefined;
  try {
    await request.jwtVerify();
    ownerUserId = request.user?.userId;
  } catch (_err) {
    request.log.debug("Owner JWT verification failed for raw-key download");
  }
  if (!ownerUserId || file.userId !== ownerUserId) {
    // No anonymous raw-objectName access (A4-02 root fix): a raw key only ever serves its owner.
    throw new UnauthorizedError("Unauthorized access to file.");
  }

  return {
    file,
    shareId: undefined,
    ancestorFolderIds: await getAncestorFolderIds(prisma, file.folderId),
  };
}

/**
 * Resolves the shared context for recording a share-file ShareVisit (download OR preview):
 *  - verifies the file belongs to the share,
 *  - returns `null` for the share owner (their own access is never tracked) or when the file/share
 *    don't match,
 *  - resolves visitor + recipient identity with the access-flow precedence
 *    (token → self_declared/cookie → authenticated_user → anonymous).
 *
 * @param requestUserId - The authenticated user's ID, or undefined for anonymous access.
 * @param ancestorFolderIds - Pre-resolved ancestor folder IDs (from getAncestorFolderIds).
 */
async function resolveShareVisitContext(
  request: FastifyRequest,
  fileRecord: { id: string; name: string },
  shareId: string,
  requestUserId: string | undefined,
  ancestorFolderIds: string[],
) {
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

  if (!shareWithFile) return null;

  // The share owner's own access (download or preview) is never tracked.
  const isOwner = requestUserId !== undefined && requestUserId === shareWithFile.creatorId;
  if (isOwner) return null;

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

  // Link this visit to a ShareRecipient using the same resolver as the access flow:
  // cookie.recipientId (token-verified) → "token"; else cookie.email match → "self_declared".
  const resolvedRecipient = await resolveDownloadRecipient({ shareId, cookie: visitorCookie });

  // For token-verified visitors, the cookie only stores recipientId (name/email are null).
  // Look up the actual recipient record to populate visitorName/visitorEmail — same as the
  // access flow in service.ts does.
  if (resolvedRecipient && !visitorName && !visitorEmail) {
    const recipientRecord = await prisma.shareRecipient.findUnique({
      where: { id: resolvedRecipient.recipientId },
      select: { name: true, email: true },
    });
    if (recipientRecord) {
      visitorEmail = recipientRecord.email;
      visitorName = recipientRecord.name ?? undefined;
    }
  }

  // Authenticated fallback: if no token/cookie match was found but the visitor is a logged-in
  // Ouitransfer user, record their verified identity. Precedence:
  //   token → self_declared/cookie → authenticated_user → anonymous (null)
  // Owner is already filtered out above (returns null).
  let userId: string | undefined;
  let identificationSource: string | undefined = resolvedRecipient?.identificationSource;
  if (!resolvedRecipient?.recipientId && requestUserId) {
    const authenticatedUser = await prisma.user.findUnique({
      where: { id: requestUserId },
      select: { username: true, email: true },
    });
    if (authenticatedUser) {
      userId = requestUserId;
      identificationSource = "authenticated_user";
      visitorName = authenticatedUser.username;
      visitorEmail = authenticatedUser.email;
    }
  }

  return {
    shareWithFile,
    visitorName,
    visitorEmail,
    userId,
    identificationSource,
    resolvedRecipient,
  };
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
  const ctx = await resolveShareVisitContext(
    request,
    fileRecord,
    shareId,
    requestUserId,
    ancestorFolderIds,
  );
  if (!ctx) return;
  const {
    shareWithFile,
    visitorName,
    visitorEmail,
    userId: downloadUserId,
    identificationSource: downloadIdentificationSource,
    resolvedRecipient,
  } = ctx;

  // Fire and forget — don't block the response.
  // Await visit insert before notification: if the visit record fails,
  // don't notify the owner about a download that was never recorded.
  (async () => {
    try {
      await prisma.shareVisit.create({
        data: {
          shareId,
          fileId: fileRecord.id,
          userId: downloadUserId,
          recipientId: resolvedRecipient?.recipientId,
          visitorName,
          visitorEmail,
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          action: "download",
          identificationSource: downloadIdentificationSource,
        },
      });
    } catch (err) {
      getLogger().error({ err }, "Failed to create ShareVisit for download");
      return; // Don't notify — the visit was never recorded
    }

    // Bump per-recipient download stats atomically when a recipient is linked — but ONLY for
    // token-verified arrivals (R2 — A4-09). A self-declared cookie email is spoofable: any
    // visitor can set `email` to a known recipient's address via /identify and would otherwise
    // poison that recipient's downloadCount/lastDownloadedAt. Self-declared remains an unverified
    // comfort label on the visit row (visitorEmail), but never mutates authoritative stats.
    if (resolvedRecipient && resolvedRecipient.identificationSource === "token") {
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

/**
 * Records a share-file PREVIEW as a first-class ShareVisit{action:"preview"} (B-34).
 *
 * A preview is a *view*, not a download: it records the per-file view event (same visitor/recipient
 * resolution and owner-skip guard as a download, via `resolveShareVisitContext`) but deliberately does
 * NOT touch recipient download stats, `Share.lastDownloadedAt`, or send any notification — so
 * `remindNonDownloaders` (which keys off `lastDownloadedAt == null`) stays correct. Fire-and-forget.
 */
async function trackShareFilePreview(
  request: FastifyRequest,
  fileRecord: { id: string; name: string },
  shareId: string,
  requestUserId: string | undefined,
  ancestorFolderIds: string[],
): Promise<void> {
  const ctx = await resolveShareVisitContext(
    request,
    fileRecord,
    shareId,
    requestUserId,
    ancestorFolderIds,
  );
  if (!ctx) return;
  const { visitorName, visitorEmail, userId, identificationSource, resolvedRecipient } = ctx;

  prisma.shareVisit
    .create({
      data: {
        shareId,
        fileId: fileRecord.id,
        userId,
        recipientId: resolvedRecipient?.recipientId,
        visitorName,
        visitorEmail,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        action: "preview",
        identificationSource,
      },
    })
    .catch((err) => getLogger().error({ err }, "Failed to create ShareVisit for preview"));
}

/**
 * Force a safe download disposition on STREAMED file responses (R2 — A3-03 / A7-07).
 *
 * User-uploaded content is served same-origin through the `/api/*` proxy. Previously the streaming
 * download echoed an extension-derived Content-Type (e.g. `text/html`, `image/svg+xml`) with
 * `Content-Disposition: inline`, so a stored `.html`/`.svg` rendered in the browser (stored-XSS
 * surface). The presigned-URL path already forces `attachment`; this brings the streaming path in
 * line:
 *   - `Content-Type: application/octet-stream` — never echo an HTML/SVG content type
 *   - `Content-Disposition: attachment`        — never render inline
 *   - `X-Content-Type-Options: nosniff`        — don't let the browser sniff back to HTML
 *   - `Content-Security-Policy: sandbox`        — defense-in-depth if rendered anyway
 */
function setForcedAttachmentHeaders(
  reply: { header: (k: string, v: string) => unknown },
  fileName: string,
  size: bigint,
): void {
  reply.header("Content-Type", "application/octet-stream");
  reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Content-Security-Policy", "sandbox");
  reply.header("Content-Length", size.toString());
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

      // Full two-layer content validation (A3-02): dangerous-extension denylist +
      // MIME/extension consistency + magic-byte verification, all run against a
      // server-derived effective MIME type and FAILING CLOSED on an unverifiable
      // or missing object. NOTE: magic-byte sniffing only inspects the object
      // head (first 4 KB), so a polyglot whose leading bytes match a benign type
      // can still slip past detection — the authoritative defenses are this
      // extension denylist plus forced-attachment download (handled in R2).
      await assertUploadedContentValid(
        { objectName: input.objectName, extension: input.extension, mimeType: input.mimeType },
        (key) => fileService.getObjectHead(key),
        request.log,
      );

      // Reconcile the client-declared size against the actual stored object size
      // (A3-08): a client could PUT a large object then register it with size:1
      // to defeat quota/maxFileSize. Use the REAL ContentLength for all checks and
      // for the stored row.
      const actualSize = await fileService.getObjectSize(input.objectName);
      if (BigInt(input.size) !== actualSize) {
        throw new ValidationError("Declared file size does not match the uploaded object");
      }

      const limits = await quotaService.resolveEffectiveLimits(userId);

      // Per-file size check (skip if unlimited)
      if (limits.maxFileSize > 0n && actualSize > limits.maxFileSize) {
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
        if (currentStorage + actualSize > limits.maxTotalStorage) {
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
          size: actualSize,
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
        force: booleanQueryParam,
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
  //
  // Two delivery modes, both gated by the same authorization (resolveDownloadTarget):
  //   • /files/download-url (presigned)  — the default path the web client uses. Returns a
  //     short-lived presigned GET URL that the browser fetches DIRECTLY from storage; the
  //     storage provider forces `Content-Disposition: attachment` on that URL
  //     (s3-storage.provider.ts), so stored HTML/SVG never renders inline.
  //   • /files/download (streamed)       — proxies the object bytes through the API (used for
  //     internal-storage / owner flows). The forced-attachment + nosniff + CSP-sandbox headers
  //     are applied here via setForcedAttachmentHeaders (R2 — A3-03/A7-07) so this path matches
  //     the presigned path's safety.
  // Neither endpoint requires preValidation: access is decided inside resolveDownloadTarget,
  // which accepts EITHER an opaque per-share file token (anonymous share visitors) OR a raw
  // objectName (JWT-authenticated owner only). A bare objectName never grants anonymous access.

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
        // For share downloads this is the opaque per-share file token from the share response;
        // for owner downloads it is the raw S3 objectName. Authorization is decided server-side
        // (see resolveDownloadTarget) — the value is never trusted as a bare key for anonymous
        // callers.
        objectName: z.string().min(1, "The objectName is required"),
        password: z.string().optional().describe("Share password if required"),
        // B-34: distinguishes a file PREVIEW (a view) from a real DOWNLOAD. The server resolves the
        // share from the token either way; this only decides which ShareVisit event is recorded.
        // Defaults to "download" so every existing caller is unchanged.
        intent: z.enum(["preview", "download"]).optional().default("download"),
      }),
      response: {
        200: z.object({
          url: z.string().describe("The download URL"),
          expiresIn: z.number().describe("The expiration time in seconds"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
        429: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { objectName: key, password, intent } = request.body;

      const {
        file: fileRecord,
        shareId,
        ancestorFolderIds,
      } = await resolveDownloadTarget(key, password, request);

      // Optional JWT extraction: the token path grants access without verifying a JWT. Attempt it
      // now (best-effort) so request.user is populated for download tracking (authenticated_user
      // identity) and the FILE_DOWNLOAD audit userId — anonymous visitors simply have no JWT.
      if (!request.user) {
        try {
          await request.jwtVerify();
        } catch (_err) {
          request.log.debug("Optional JWT verification skipped — anonymous share download");
        }
      }

      const fileName = fileRecord.name;
      const expires = env.PRESIGNED_GET_URL_EXPIRATION;

      // Always presign the REAL object key (resolved server-side from the token), never the
      // client-supplied value.
      const url = await fileService.getPresignedGetUrl(fileRecord.objectName, expires, fileName);

      // Enrich the FILE_DOWNLOAD audit with the resolved recipient + source for share downloads.
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
          intent,
          ...(shareId ? { shareId } : {}),
          ...(auditRecipient
            ? {
                recipientId: auditRecipient.recipientId,
                identificationSource: auditRecipient.identificationSource,
              }
            : {}),
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      // Record the share-bound activity (fire-and-forget). A preview is a per-file VIEW that never
      // touches download stats; a download is a download (B-34).
      if (shareId) {
        const track =
          intent === "preview"
            ? trackShareFilePreview(
                request,
                fileRecord,
                shareId,
                request.user?.userId,
                ancestorFolderIds,
              )
            : trackShareDownload(
                request,
                fileRecord,
                shareId,
                request.user?.userId,
                ancestorFolderIds,
              );
        track.catch((err) => getLogger().error({ err }, "Failed to track share file activity"));
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
        // Opaque per-share file token (share downloads) or raw objectName (owner downloads).
        objectName: z.string().min(1, "The objectName is required"),
        password: z.string().optional().describe("Share password if required"),
      }),
    },
    handler: async (request, reply) => {
      const { objectName: key, password } = request.body;

      // Reverse-share files are owner-only and identified by their raw `reverse-shares/...` key
      // (A4-13: this branch stays owner-scoped — JWT required, creator must match). This path is
      // never reachable via a share-file token, so it is checked before the token resolver.
      if (key.startsWith("reverse-shares/")) {
        const reverseShareFile = await prisma.reverseShareFile.findFirst({
          where: { objectName: key },
          include: { reverseShare: true },
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
          if (err instanceof UnauthorizedError) throw err;
          request.log.debug({ err }, "JWT verification failed for reverse-share download");
          throw new UnauthorizedError("Unauthorized access to file.");
        }

        const stream = await fileService.getObjectStream(key);
        setForcedAttachmentHeaders(reply, reverseShareFile.name, reverseShareFile.size);
        return reply.send(stream);
      }

      const {
        file: fileRecord,
        shareId,
        ancestorFolderIds,
      } = await resolveDownloadTarget(key, password, request);

      // Optional JWT extraction for tracking/audit identity (see download-url handler).
      if (!request.user) {
        try {
          await request.jwtVerify();
        } catch (_err) {
          request.log.debug("Optional JWT verification skipped — anonymous share download");
        }
      }

      // Enrich the FILE_DOWNLOAD audit with the resolved recipient + source for share downloads.
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

      if (shareId) {
        trackShareDownload(
          request,
          fileRecord,
          shareId,
          request.user?.userId,
          ancestorFolderIds,
        ).catch((err) => getLogger().error({ err }, "Failed to track share download"));
      }

      // Always stream the REAL object key resolved server-side, never the client-supplied value.
      const stream = await fileService.getObjectStream(fileRecord.objectName);
      setForcedAttachmentHeaders(reply, fileRecord.name, fileRecord.size);
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
