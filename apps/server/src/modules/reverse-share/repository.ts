import bcrypt from "bcryptjs";

import { prisma } from "../../shared/prisma.js";
import type { DeactivationReason } from "../share/lifecycle.js";
import type { CreateReverseShareInput, UpdateReverseShareInput } from "./dto.js";

/**
 * Internal-only reverse-share fields the service may write alongside (or instead
 * of) the public update DTO: notification idempotency flags and the Phase A.1
 * lifecycle metadata. These are not part of `UpdateReverseShareInput` (they are
 * never set directly by clients), so the repository accepts them explicitly
 * rather than via an untyped cast.
 */
export interface ReverseShareInternalUpdate {
  notifiedForExpiring?: boolean;
  notifiedForExpired?: boolean;
  notifiedForPendingDeletion?: boolean;
  deactivatedAt?: Date | null;
  deactivationReason?: DeactivationReason | null;
}

export class ReverseShareRepository {
  async create(data: CreateReverseShareInput, creatorId: string) {
    const hashedPassword = data.password ? await this.hashPassword(data.password) : null;

    return prisma.reverseShare.create({
      data: {
        ...data,
        password: hashedPassword,
        maxFileSize: data.maxFileSize ? BigInt(data.maxFileSize) : null,
        creatorId,
      },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: true,
        alias: true,
        recipients: true,
      },
    });
  }

  async findById(id: string) {
    return prisma.reverseShare.findUnique({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            isActive: true,
          },
        },
        files: true,
        alias: true,
        recipients: true,
      },
    });
  }

  async findByAlias(alias: string) {
    const reverseShareAlias = await prisma.reverseShareAlias.findUnique({
      where: { alias },
      include: {
        reverseShare: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                isActive: true,
              },
            },
            files: true,
            alias: true,
            recipients: true,
          },
        },
      },
    });

    return reverseShareAlias?.reverseShare || null;
  }

  async findByCreatorId(creatorId: string) {
    return prisma.reverseShare.findMany({
      where: { creatorId },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: true,
        alias: true,
        recipients: true,
      },
      orderBy: { createdAt: "desc" },
    });
  }

  async update(id: string, data: Partial<UpdateReverseShareInput> & ReverseShareInternalUpdate) {
    // We need to transform number values to their DB types (password → hash, maxFileSize → bigint)
    const { password, maxFileSize, ...rest } = data;

    type UpdatePayload = Omit<
      Partial<UpdateReverseShareInput> & ReverseShareInternalUpdate,
      "password" | "maxFileSize"
    > & {
      password?: string | null;
      maxFileSize?: bigint | null;
    };
    const updateData: UpdatePayload = { ...rest };

    if (password !== undefined) {
      updateData.password = password ? await this.hashPassword(password) : null;
    }

    if (maxFileSize !== undefined) {
      updateData.maxFileSize = maxFileSize ? BigInt(maxFileSize) : null;
    }

    return prisma.reverseShare.update({
      where: { id },
      data: updateData,
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: true,
        alias: true,
        recipients: true,
      },
    });
  }

  /**
   * Persist an expired reverse share as deactivated (Phase A.1).
   *
   * Called from the read/upload paths when expiry is detected on a still-active
   * reverse share, so the cleanup sweep (Batch 3) can later delete it + its
   * uploaded files. Idempotent and race-safe: the `isActive: true` guard means a
   * concurrent request or the scheduler cannot clobber an already-set
   * `deactivatedAt` / `deactivationReason`. `deactivatedAt` is stamped at the
   * expiration instant (not "now") so the grace window is measured uniformly.
   *
   * @returns the number of rows updated (0 = already deactivated, 1 = just set)
   */
  async markExpiredInactive(id: string, expiration: Date): Promise<number> {
    const result = await prisma.reverseShare.updateMany({
      where: { id, isActive: true },
      data: { isActive: false, deactivatedAt: expiration, deactivationReason: "expired" },
    });
    return result.count;
  }

  async delete(id: string) {
    return prisma.reverseShare.delete({
      where: { id },
      include: {
        creator: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        files: true,
        alias: true,
        recipients: true,
      },
    });
  }

  async addRecipients(
    reverseShareId: string,
    recipients: Array<{ email: string; name?: string | null }>,
  ): Promise<void> {
    await prisma.reverseShare.update({
      where: { id: reverseShareId },
      data: {
        recipients: {
          create: recipients.map((r) => ({
            email: r.email.trim().toLowerCase(),
            name: r.name || null,
          })),
        },
      },
    });
  }

  async removeRecipients(reverseShareId: string, emails: string[]): Promise<void> {
    const normalizedEmails = emails.map((e) => e.trim().toLowerCase());
    await prisma.reverseShare.update({
      where: { id: reverseShareId },
      data: {
        recipients: {
          deleteMany: {
            email: {
              in: normalizedEmails,
            },
          },
        },
      },
    });
  }

  async createFile(
    reverseShareId: string,
    fileData: {
      name: string;
      description?: string;
      extension: string;
      size: bigint;
      objectName: string;
      uploaderEmail?: string;
      uploaderName?: string;
    },
  ) {
    return prisma.reverseShareFile.create({
      data: {
        ...fileData,
        reverseShareId,
      },
    });
  }

  /**
   * Best-effort per-recipient upload tracking (8.3 lot D).
   *
   * When an uploader self-declares an email that matches a known recipient of
   * this reverse share, bump that recipient's upload stats:
   * - `uploadedAt` is set ONCE, on the first matched upload, via a conditional
   *   `updateMany({ where: { uploadedAt: null } })` so it is TOCTOU-safe (a read
   *   then write could double-set under concurrency).
   * - `uploadCount` is incremented atomically on every matched upload.
   *
   * The two writes are independent on purpose: the count must increment every
   * time, while the timestamp must only stamp the first time. Returns nothing —
   * callers treat this as fire-and-forget (failures must not break the upload).
   *
   * Email matching uses the `@@unique([reverseShareId, email])` key; the caller
   * is responsible for normalizing the email (trim + lowercase) to match how
   * recipients are stored (`addRecipients`).
   */
  async trackRecipientUpload(reverseShareId: string, normalizedEmail: string): Promise<void> {
    const now = new Date();
    // Conditional first-upload timestamp (only sets when still null).
    await prisma.reverseShareRecipient.updateMany({
      where: { reverseShareId, email: normalizedEmail, uploadedAt: null },
      data: { uploadedAt: now },
    });
    // Atomic count increment on every matched upload.
    await prisma.reverseShareRecipient.updateMany({
      where: { reverseShareId, email: normalizedEmail },
      data: { uploadCount: { increment: 1 } },
    });
  }

  async findFileById(id: string) {
    return prisma.reverseShareFile.findUnique({
      where: { id },
      include: {
        reverseShare: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  async deleteFile(id: string) {
    return prisma.reverseShareFile.delete({
      where: { id },
    });
  }

  async getFilesByReverseShareId(reverseShareId: string) {
    return prisma.reverseShareFile.findMany({
      where: { reverseShareId },
      orderBy: { createdAt: "desc" },
    });
  }

  async countFilesByReverseShareId(reverseShareId: string) {
    return prisma.reverseShareFile.count({
      where: { reverseShareId },
    });
  }

  async updateFile(fileId: string, data: { name?: string; description?: string | null }) {
    return prisma.reverseShareFile.update({
      where: { id: fileId },
      data,
      include: {
        reverseShare: {
          include: {
            creator: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  private async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  async comparePassword(password: string, hashedPassword: string): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword);
  }
}
