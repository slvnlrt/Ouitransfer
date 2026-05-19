import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    ldapConfig: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../../../shared/prisma.js";
import { LdapConfigRepository } from "../config.repository.js";

const mockedPrisma = vi.mocked(prisma);

describe("LdapConfigRepository", () => {
  let repository: LdapConfigRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new LdapConfigRepository();
  });

  describe("get", () => {
    it("should return null when no config exists", async () => {
      mockedPrisma.ldapConfig.findFirst.mockResolvedValue(null);
      const result = await repository.get();
      expect(result).toBeNull();
      expect(mockedPrisma.ldapConfig.findFirst).toHaveBeenCalledOnce();
    });

    it("should return config when it exists", async () => {
      const config = {
        id: "config-1",
        enabled: true,
        serverUrl: "ldaps://ad.corp.local:636",
        bindDn: "cn=svc,dc=corp,dc=local",
        bindPassword: "encrypted-value",
        searchBase: "DC=corp,DC=local",
        syncGroupDn: "CN=OuiTransfer Users,OU=Groups,DC=corp,DC=local",
        usernameAttribute: "sAMAccountName",
        emailAttribute: "mail",
        displayNameAttribute: "displayName",
        syncIntervalMinutes: 360,
        useTls: true,
        appUrl: "https://transfer.corp.local",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockedPrisma.ldapConfig.findFirst.mockResolvedValue(config);

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
      syncIntervalMinutes: 360,
      useTls: true,
      appUrl: null,
    };

    it("should create config when none exists", async () => {
      mockedPrisma.ldapConfig.findFirst.mockResolvedValue(null);
      mockedPrisma.ldapConfig.create.mockResolvedValue({
        id: "new-1",
        ...configData,
        appUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await repository.upsert(configData);

      expect(mockedPrisma.ldapConfig.create).toHaveBeenCalledWith({
        data: configData,
      });
    });

    it("should update config when one exists", async () => {
      const existing = {
        id: "existing-1",
        ...configData,
        appUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockedPrisma.ldapConfig.findFirst.mockResolvedValue(existing);
      mockedPrisma.ldapConfig.update.mockResolvedValue({
        ...existing,
        ...configData,
      });

      await repository.upsert(configData);

      expect(mockedPrisma.ldapConfig.update).toHaveBeenCalledWith({
        where: { id: "existing-1" },
        data: configData,
      });
    });
  });
});
