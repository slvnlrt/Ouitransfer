import { prisma } from "../../shared/prisma.js";

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
}
