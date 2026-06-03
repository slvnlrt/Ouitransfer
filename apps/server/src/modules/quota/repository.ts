import type { Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../shared/prisma.js";

/** A file selected as a candidate for quota smart-deletion (5.2 Phase B B2). */
export interface DeletionCandidateFile {
  id: string;
  objectName: string;
  size: bigint;
}

export class QuotaRepository {
  /**
   * Calculate total storage used by a user.
   * Includes: File.size (own files) + ReverseShareFile.size (files received via reverse shares they created).
   */
  async calculateStorageUsed(userId: string): Promise<bigint> {
    const [fileAgg, reverseShareFileAgg] = await Promise.all([
      prisma.file.aggregate({
        where: { userId },
        _sum: { size: true },
      }),
      prisma.reverseShareFile.aggregate({
        where: { reverseShare: { creatorId: userId } },
        _sum: { size: true },
      }),
    ]);

    const fileTotal = fileAgg._sum.size ?? 0n;
    const reverseShareTotal = reverseShareFileAgg._sum.size ?? 0n;

    return fileTotal + reverseShareTotal;
  }

  /**
   * Fetch the user's **orphan upload** files for quota smart-deletion (5.2 Phase B B2).
   *
   * An orphan is a `File` that is in NO share, neither directly (`ShareFiles`)
   * nor via a shared folder (`ShareFolders`). These are the safest deletion
   * candidates — nothing references them. Returned oldest `createdAt` first.
   */
  async findOrphanFiles(userId: string): Promise<DeletionCandidateFile[]> {
    const files = await prisma.file.findMany({
      where: {
        userId,
        shares: { none: {} },
        OR: [{ folderId: null }, { folder: { shares: { none: {} } } }],
      },
      select: { id: true, objectName: true, size: true },
      orderBy: { createdAt: "asc" },
    });
    return files;
  }

  /**
   * Fetch the user's **inactive-share** files for quota smart-deletion
   * (5.2 Phase B B2).
   *
   * A file qualifies when it is referenced by at least one share (directly or
   * via a shared folder) but EVERY referencing share is "inactive": its last
   * activity — `lastDownloadedAt`, falling back to `updatedAt` when never
   * downloaded — is strictly before `inactiveBefore`. Equivalently, the file is
   * excluded if it has ANY share (direct or via folder) that is still
   * "active"/recent (last activity `>= inactiveBefore`). Orphans are excluded
   * (handled by {@link findOrphanFiles}). Returned oldest `createdAt` first.
   *
   * "Recent" share predicate: a share is recent when
   * `(lastDownloadedAt ?? updatedAt) >= inactiveBefore`, expressed in Prisma as
   * (downloaded recently) OR (never downloaded AND updated recently).
   */
  async findInactiveShareFiles(
    userId: string,
    inactiveBefore: Date,
  ): Promise<DeletionCandidateFile[]> {
    // A share counts as "active"/recent — and therefore protects its files —
    // when its last activity is on or after the cutoff.
    const recentShare: Prisma.ShareWhereInput = {
      OR: [
        { lastDownloadedAt: { gte: inactiveBefore } },
        { lastDownloadedAt: null, updatedAt: { gte: inactiveBefore } },
      ],
    };

    const files = await prisma.file.findMany({
      where: {
        userId,
        // Referenced by at least one share, directly or via a shared folder
        // (i.e. NOT an orphan — orphans are handled separately).
        OR: [{ shares: { some: {} } }, { folder: { shares: { some: {} } } }],
        // No direct share is recent.
        shares: { none: recentShare },
        // No folder share is recent: either the file has no folder, or its
        // folder has no recent share. (`folderId: null` covers the no-folder
        // case; a relational `none` filter alone would wrongly exclude it.)
        AND: [
          {
            OR: [{ folderId: null }, { folder: { shares: { none: recentShare } } }],
          },
        ],
      },
      select: { id: true, objectName: true, size: true },
      orderBy: { createdAt: "asc" },
    });
    return files;
  }
}
