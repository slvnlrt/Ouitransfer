import { prisma } from "../../shared/prisma.js";

export class LdapConfigRepository {
  async get() {
    return prisma.ldapConfig.findFirst();
  }

  async upsert(data: {
    enabled: boolean;
    serverUrl: string;
    bindDn: string;
    bindPassword: string;
    searchBase: string;
    syncGroupDn: string;
    usernameAttribute: string;
    emailAttribute: string;
    displayNameAttribute: string;
    syncIntervalMinutes: number;
    useTls: boolean;
    appUrl?: string | null;
  }) {
    const existing = await this.get();
    if (existing) {
      return prisma.ldapConfig.update({
        where: { id: existing.id },
        data,
      });
    }
    return prisma.ldapConfig.create({ data });
  }
}
