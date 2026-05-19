import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    ldapSyncLog: {
      create: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "../../../shared/prisma.js";
import { LdapSyncLogRepository } from "../sync.repository.js";

describe("LdapSyncLogRepository", () => {
  let repository: LdapSyncLogRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new LdapSyncLogRepository();
  });

  describe("create", () => {
    it("should create a new sync log", async () => {
      const log = {
        id: "log-1",
        trigger: "manual",
        status: "running",
        startedAt: new Date(),
        completedAt: null,
        usersCreated: 0,
        usersUpdated: 0,
        usersDeactivated: 0,
        usersSkipped: 0,
        usersReactivated: 0,
        details: null,
        createdAt: new Date(),
      };
      vi.mocked(prisma.ldapSyncLog.create).mockResolvedValue(log);

      const result = await repository.create({
        trigger: "manual",
        status: "running",
      });
      expect(result).toEqual(log);
      expect(vi.mocked(prisma.ldapSyncLog.create)).toHaveBeenCalledWith({
        data: { trigger: "manual", status: "running" },
      });
    });
  });

  describe("complete", () => {
    it("should update log with completion data", async () => {
      const completionData = {
        status: "success",
        usersCreated: 3,
        usersUpdated: 1,
        usersDeactivated: 0,
        usersSkipped: 1,
        usersReactivated: 0,
        details: "[]",
      };
      vi.mocked(prisma.ldapSyncLog.update).mockResolvedValue({
        id: "log-1",
        ...completionData,
        trigger: "manual",
        startedAt: new Date(),
        completedAt: new Date(),
        createdAt: new Date(),
      });

      await repository.complete("log-1", completionData);

      expect(vi.mocked(prisma.ldapSyncLog.update)).toHaveBeenCalledWith({
        where: { id: "log-1" },
        data: expect.objectContaining({
          ...completionData,
          completedAt: expect.any(Date),
        }),
      });
    });
  });

  describe("list", () => {
    it("should return paginated logs with total count", async () => {
      vi.mocked(prisma.ldapSyncLog.findMany).mockResolvedValue([]);
      vi.mocked(prisma.ldapSyncLog.count).mockResolvedValue(0);

      const result = await repository.list(20, 0);
      expect(result).toEqual({ logs: [], total: 0 });
      expect(vi.mocked(prisma.ldapSyncLog.findMany)).toHaveBeenCalledWith({
        orderBy: { startedAt: "desc" },
        take: 20,
        skip: 0,
      });
    });
  });

  describe("getById", () => {
    it("should return null for non-existent log", async () => {
      vi.mocked(prisma.ldapSyncLog.findUnique).mockResolvedValue(null);
      const result = await repository.getById("non-existent");
      expect(result).toBeNull();
    });
  });

  describe("getLatest", () => {
    it("should return the most recent log", async () => {
      const log = {
        id: "log-1",
        status: "success",
        trigger: "scheduled",
        startedAt: new Date(),
        completedAt: new Date(),
        usersCreated: 0,
        usersUpdated: 0,
        usersDeactivated: 0,
        usersSkipped: 0,
        usersReactivated: 0,
        details: null,
        createdAt: new Date(),
      };
      vi.mocked(prisma.ldapSyncLog.findFirst).mockResolvedValue(log);

      const result = await repository.getLatest();
      expect(result).toEqual(log);
      expect(vi.mocked(prisma.ldapSyncLog.findFirst)).toHaveBeenCalledWith({
        orderBy: { startedAt: "desc" },
      });
    });
  });
});
