import { prisma } from "../../shared/prisma.js";

export class LdapSyncLogRepository {
  async create(data: { trigger: string; status: string }) {
    return prisma.ldapSyncLog.create({
      data: {
        trigger: data.trigger,
        status: data.status,
      },
    });
  }

  async complete(
    id: string,
    data: {
      status: string;
      usersCreated: number;
      usersUpdated: number;
      usersDeactivated: number;
      usersSkipped: number;
      usersReactivated: number;
      details: string;
    },
  ) {
    return prisma.ldapSyncLog.update({
      where: { id },
      data: {
        completedAt: new Date(),
        ...data,
      },
    });
  }

  async list(limit: number, offset: number) {
    const [logs, total] = await Promise.all([
      prisma.ldapSyncLog.findMany({
        orderBy: { startedAt: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.ldapSyncLog.count(),
    ]);
    return { logs, total };
  }

  async getById(id: string) {
    return prisma.ldapSyncLog.findUnique({ where: { id } });
  }

  async getLatest() {
    return prisma.ldapSyncLog.findFirst({
      orderBy: { startedAt: "desc" },
    });
  }
}
