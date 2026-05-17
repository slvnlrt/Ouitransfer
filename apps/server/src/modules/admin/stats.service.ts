import { prisma } from "../../shared/prisma.js";

export interface AdminStats {
  users: { total: number; active: number };
  files: { total: number };
  shares: { active: number; expired: number };
  reverseShares: { active: number };
}

export class AdminStatsService {
  async getStats(): Promise<AdminStats> {
    const now = new Date();

    const [usersTotal, usersActive, filesTotal, sharesActive, sharesExpired, reverseSharesActive] =
      await Promise.all([
        prisma.user.count(),
        prisma.user.count({ where: { isActive: true } }),
        prisma.file.count(),
        prisma.share.count({
          where: {
            OR: [{ expiration: null }, { expiration: { gt: now } }],
          },
        }),
        prisma.share.count({
          where: { expiration: { lte: now } },
        }),
        prisma.reverseShare.count({
          where: {
            isActive: true,
            OR: [{ expiration: null }, { expiration: { gt: now } }],
          },
        }),
      ]);

    return {
      users: { total: usersTotal, active: usersActive },
      files: { total: filesTotal },
      shares: { active: sharesActive, expired: sharesExpired },
      reverseShares: { active: reverseSharesActive },
    };
  }
}
