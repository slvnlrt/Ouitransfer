import crypto from "node:crypto";

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { env } from "../../env.js";
import { prisma } from "../../shared/prisma.js";
import { AppError, ForbiddenError, NotFoundError, ValidationError } from "../../utils/app-error.js";
import { parseFileName } from "../../utils/file-name-generator.js";
import { getLogger } from "../../utils/logger.js";
import { sanitizeFilename } from "../../utils/sanitize-filename.js";
import {
  assertExtensionAllowed,
  assertUploadedContentValid,
} from "../../utils/validate-file-content.js";
import { validateObjectName } from "../../utils/validate-object-name.js";
import { getConfigValue } from "../config/service.js";
import { FileService } from "../file/service.js";
import { quotaService } from "../quota/service.js";
import { assertOwnerActive } from "./assert-owner-active.js";
import { ReverseShareRepository } from "./repository.js";

/**
 * Parse the original filename + extension back out of a server-generated
 * reverse-share object key of the form
 *   `reverse-shares/<id>/<timestamp>-<uuid>-<sanitizedFilename>.<extension>`
 * (see {@link createMultipartUploadByAlias}). The timestamp is all-digits and the
 * uuid has the fixed 8-4-4-4-12 hex shape, so the leading `<ts>-<uuid>-` can be
 * stripped unambiguously even when the filename itself contains hyphens.
 */
function parseReverseShareObjectKey(objectName: string): { name: string; extension: string } {
  const lastSegment = objectName.substring(objectName.lastIndexOf("/") + 1);
  const match = lastSegment.match(
    /^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i,
  );
  const fullName = match ? match[1] : lastSegment;
  const { baseName, extension } = parseFileName(fullName);
  return { name: baseName, extension: extension.replace(/^\./, "") };
}

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
      throw new AppError(403, "Reverse share is inactive", ErrorCodes.SHARE_INACTIVE);
    }

    // A6 deactivated-owner gate (single source of truth in assert-owner-active).
    assertOwnerActive(reverseShare);

    if (reverseShare.expiration && new Date(reverseShare.expiration) < new Date()) {
      throw new AppError(410, "Reverse share has expired", ErrorCodes.SHARE_EXPIRED);
    }

    if (reverseShare.password) {
      if (!password) {
        throw new AppError(401, "Password required", ErrorCodes.PASSWORD_REQUIRED);
      }
      const isValidPassword = await this.reverseShareRepository.comparePassword(
        password,
        reverseShare.password,
      );
      if (!isValidPassword) {
        throw new AppError(401, "Invalid password", ErrorCodes.INVALID_PASSWORD);
      }
    }

    return reverseShare;
  }

  /**
   * Enforce the reverse share's per-share `maxFiles` / `allowedFileTypes` limits
   * and the owner's storage quota. Shared by create (pre-check, size omitted) and
   * complete (post-upload, real size known). `size` is `null` at create time
   * because the object does not yet exist; the quota pre-check then uses 0 so a
   * create is only blocked when the owner is *already* over budget — the
   * authoritative size/quota gate runs at complete (A3-05 / A4-04).
   */
  private async enforceReverseShareLimits(
    reverseShare: {
      id: string;
      creatorId: string;
      maxFiles: number | null;
      maxFileSize: bigint | null;
      allowedFileTypes: string | null;
    },
    extension: string,
    size: bigint | null,
  ): Promise<void> {
    // Dangerous-extension denylist is unconditional (A3-02 parity).
    assertExtensionAllowed(extension);

    if (reverseShare.allowedFileTypes) {
      const allowedTypes = reverseShare.allowedFileTypes
        .split(",")
        .map((type) => type.trim().toLowerCase());
      if (!allowedTypes.includes(extension.toLowerCase())) {
        throw new ValidationError("File type not allowed");
      }
    }

    if (reverseShare.maxFiles) {
      const currentFileCount = await this.reverseShareRepository.countFilesByReverseShareId(
        reverseShare.id,
      );
      if (currentFileCount >= reverseShare.maxFiles) {
        throw new ForbiddenError("Maximum number of files reached");
      }
    }

    if (size !== null && reverseShare.maxFileSize && size > reverseShare.maxFileSize) {
      throw new ValidationError("File size exceeds limit");
    }

    await this.enforceReverseShareQuota(reverseShare.creatorId, size ?? 0n);
  }

  /**
   * Owner storage-quota enforcement for reverse-share multipart uploads, mirroring
   * {@link ReverseShareUploadService.enforceReverseShareQuota} (soft by default,
   * hard when disabled). Throws 400 INSUFFICIENT_STORAGE when not allowed.
   */
  private async enforceReverseShareQuota(creatorId: string, size: bigint): Promise<void> {
    const limits = await quotaService.resolveEffectiveLimits(creatorId);
    const limit = limits.maxTotalStorage;
    if (limit <= 0n) return; // unlimited owner

    const usedBefore = await quotaService.calculateStorageUsed(creatorId);
    const softEnforcement = (await getConfigValue("reverseShareQuotaSoftEnforcement")) === "true";

    let allowed: boolean;
    if (softEnforcement) {
      const factor = Number(await getConfigValue("reverseShareMaxOverageFactor"));
      const capBytes = BigInt(await getConfigValue("reverseShareAbsoluteMaxBytes"));
      allowed = quotaService.isReverseUploadAllowed(
        usedBefore,
        size,
        limit,
        Number.isFinite(factor) && factor >= 1 ? factor : 1,
        capBytes,
      );
    } else {
      allowed = usedBefore + size <= limit;
    }

    if (!allowed) {
      const availableSpace = Number(limit - usedBefore) / (1024 * 1024);
      throw new AppError(
        400,
        `Insufficient storage space. You have ${availableSpace.toFixed(2)}MB available`,
        ErrorCodes.INSUFFICIENT_STORAGE,
        { availableSpaceMB: availableSpace.toFixed(2) },
      );
    }
  }

  async createMultipartUploadByAlias(
    alias: string,
    filename: string,
    extension: string,
    password?: string,
  ): Promise<{ uploadId: string; objectName: string }> {
    const reverseShare = await this.validateReverseShareAccessByAlias(alias, password);

    // Pre-check per-share limits + owner quota BEFORE allocating a multipart
    // upload, so an over-budget owner / disallowed type / file-count-exhausted
    // share cannot accumulate orphan multipart uploads (A3-05). Size is unknown
    // here; the authoritative size/quota gate runs at complete.
    await this.enforceReverseShareLimits(reverseShare, extension, null);

    // Generate objectName server-side with reverseShare.id (not alias), the
    // SHARED sanitizer (A3-09), and a crypto UUID.
    const sanitizedFilename = sanitizeFilename(filename);
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
    const reverseShare = await this.validateReverseShareAccessByAlias(alias, password);

    // A3-01 / A4-01: the objectName MUST belong to this reverse share's namespace,
    // otherwise an anonymous caller could presign a part write against an arbitrary
    // key (cross-tenant overwrite). Validate before any S3 call.
    validateObjectName(objectName, `reverse-shares/${reverseShare.id}`);

    // Best-effort limit re-check at presign time (A4-07): refuse to keep feeding
    // parts into an over-budget / full share.
    const { extension } = parseReverseShareObjectKey(objectName);
    await this.enforceReverseShareLimits(reverseShare, extension, null);

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
    uploaderInfo?: { uploaderEmail?: string; uploaderName?: string },
  ): Promise<{ message: string; objectName: string }> {
    const reverseShare = await this.validateReverseShareAccessByAlias(alias, password);

    // A3-01 / A4-01: reject cross-namespace keys before completing the upload.
    validateObjectName(objectName, `reverse-shares/${reverseShare.id}`);

    const { name, extension } = parseReverseShareObjectKey(objectName);

    // Finalize the object in storage.
    await this.fileService.completeMultipartUpload(objectName, uploadId, parts);

    // Now that the object exists, run the FULL content validation (A3-02 parity)
    // and reconcile the real size for limits/quota (A3-08). If validation fails we
    // abort the just-completed object so it does not linger un-accounted.
    let size: bigint;
    try {
      await assertUploadedContentValid(
        { objectName, extension, mimeType: undefined },
        (key) => this.fileService.getObjectHead(key),
        getLogger(),
      );
      size = await this.fileService.getObjectSize(objectName);

      // A3-05 / A4-04: enforce maxFiles/maxFileSize/allowedFileTypes/owner-quota
      // with the REAL size. Done before creating the DB row so a rejected upload
      // never counts against the share.
      await this.enforceReverseShareLimits(reverseShare, extension, size);
    } catch (err) {
      await this.fileService
        .abortMultipartUpload(objectName, uploadId)
        .catch((abortErr) =>
          getLogger().warn(
            { err: abortErr, objectName },
            "Failed to abort rejected multipart upload — orphan sweep will reclaim it",
          ),
        );
      // Best-effort delete of the finalized object (complete may have already
      // assembled it before validation ran).
      await this.fileService.deleteObject(objectName).catch(() => {
        /* object may not exist if abort already removed it */
      });
      throw err;
    }

    // A3-05 / A4-04: create the ReverseShareFile row at completion so multipart
    // objects are counted toward the owner's quota and per-share limits, with an
    // ATOMIC maxFiles re-check (conditional create) to close the create→complete
    // TOCTOU window.
    const created = await this.createReverseShareFileAtomic(reverseShare, {
      name,
      extension,
      size,
      objectName,
      uploaderEmail: uploaderInfo?.uploaderEmail,
      uploaderName: uploaderInfo?.uploaderName,
    });

    if (!created) {
      // Lost the race against maxFiles — clean up the now-orphaned object.
      await this.fileService
        .deleteObject(objectName)
        .catch((delErr) =>
          getLogger().warn(
            { err: delErr, objectName },
            "Failed to delete over-limit multipart object",
          ),
        );
      throw new ForbiddenError("Maximum number of files reached");
    }

    return {
      message: "Multipart upload completed successfully",
      objectName,
    };
  }

  /**
   * Create the ReverseShareFile row, re-checking `maxFiles` atomically against the
   * live row count inside a transaction so two concurrent completions cannot both
   * slip past a single-slot limit (A3-05 TOCTOU). Returns `false` when the
   * file-count limit would be exceeded (caller cleans up the object).
   */
  private async createReverseShareFileAtomic(
    reverseShare: { id: string; maxFiles: number | null },
    fileData: {
      name: string;
      extension: string;
      size: bigint;
      objectName: string;
      uploaderEmail?: string;
      uploaderName?: string;
    },
  ): Promise<boolean> {
    return prisma.$transaction(async (tx) => {
      if (reverseShare.maxFiles) {
        const count = await tx.reverseShareFile.count({
          where: { reverseShareId: reverseShare.id },
        });
        if (count >= reverseShare.maxFiles) {
          return false;
        }
      }
      await tx.reverseShareFile.create({
        data: {
          name: fileData.name,
          extension: fileData.extension,
          size: fileData.size,
          objectName: fileData.objectName,
          uploaderEmail: fileData.uploaderEmail,
          uploaderName: fileData.uploaderName,
          reverseShareId: reverseShare.id,
        },
      });
      return true;
    });
  }

  async abortMultipartUploadByAlias(
    alias: string,
    uploadId: string,
    objectName: string,
    password?: string,
  ): Promise<{ message: string }> {
    const reverseShare = await this.validateReverseShareAccessByAlias(alias, password);

    // A3-01 / A4-01: reject cross-namespace keys before aborting (an anonymous
    // caller must not be able to cancel another tenant's in-progress upload).
    validateObjectName(objectName, `reverse-shares/${reverseShare.id}`);

    await this.fileService.abortMultipartUpload(objectName, uploadId);

    return {
      message: "Multipart upload aborted successfully",
    };
  }

  async listPartsByAlias(
    alias: string,
    uploadId: string,
    objectName: string,
    password?: string,
  ): Promise<Array<{ PartNumber: number; Size: number; ETag: string }>> {
    const reverseShare = await this.validateReverseShareAccessByAlias(alias, password);

    // A3-01 / A4-01: reject cross-namespace keys before listing parts (prevents
    // part-metadata disclosure for arbitrary keys).
    validateObjectName(objectName, `reverse-shares/${reverseShare.id}`);

    return await this.fileService.listParts(objectName, uploadId);
  }
}
