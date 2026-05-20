import { prisma } from "../../shared/prisma.js";

const SINGLETON_ID = "ldap-config";

export class LdapConfigRepository {
  async get() {
    return prisma.ldapConfig.findUnique({ where: { id: SINGLETON_ID } });
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
    tlsSkipVerify: boolean;
    appUrl?: string | null;
  }) {
    return prisma.ldapConfig.upsert({
      where: { id: SINGLETON_ID },
      update: data,
      create: { id: SINGLETON_ID, ...data },
    });
  }
}
