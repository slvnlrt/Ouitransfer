import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    ldapConfig: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "../../../shared/prisma.js";
import { LdapConfigRepository } from "../config.repository.js";

describe("LdapConfigRepository", () => {
  let repository: LdapConfigRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new LdapConfigRepository();
  });

  describe("get", () => {
    it("should return null when no config exists", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);
      const result = await repository.get();
      expect(result).toBeNull();
      expect(vi.mocked(prisma.ldapConfig.findUnique)).toHaveBeenCalledWith({
        where: { id: "ldap-config" },
      });
    });

    it("should return config when it exists", async () => {
      const config = {
        id: "ldap-config",
        enabled: true,
        serverUrl: "ldaps://ad.corp.local:636",
        bindDn: "cn=svc,dc=corp,dc=local",
        bindPassword: "encrypted-value",
        searchBase: "DC=corp,DC=local",
        syncGroupDn: "CN=OuiTransfer Users,OU=Groups,DC=corp,DC=local",
        usernameAttribute: "sAMAccountName",
        emailAttribute: "mail",
        displayNameAttribute: "displayName",
        defaultLocale: "en",
        syncIntervalMinutes: 360,
        useTls: true,
        tlsSkipVerify: false,
        appUrl: "https://transfer.corp.local",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(config);

      const result = await repository.get();
      expect(result).toEqual(config);
    });
  });

  describe("upsert", () => {
    const configData = {
      enabled: true,
      serverUrl: "ldaps://ad.corp.local:636",
      bindDn: "cn=svc,dc=corp,dc=local",
      bindPassword: "encrypted-value",
      searchBase: "DC=corp,DC=local",
      syncGroupDn: "CN=OuiTransfer Users,OU=Groups,DC=corp,DC=local",
      usernameAttribute: "sAMAccountName",
      emailAttribute: "mail",
      displayNameAttribute: "displayName",
      defaultLocale: "en" as const,
      syncIntervalMinutes: 360,
      useTls: true,
      tlsSkipVerify: false,
      appUrl: null,
    };

    it("should upsert config with singleton ID", async () => {
      vi.mocked(prisma.ldapConfig.upsert).mockResolvedValue({
        id: "ldap-config",
        ...configData,
        appUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await repository.upsert(configData);

      expect(vi.mocked(prisma.ldapConfig.upsert)).toHaveBeenCalledWith({
        where: { id: "ldap-config" },
        update: configData,
        create: { id: "ldap-config", ...configData },
      });
    });
  });
});
