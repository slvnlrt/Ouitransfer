import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

import { prisma } from "../../../shared/prisma.js";
import { getAuditLogs, logAuditEvent } from "../service.js";

describe("Audit service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("logAuditEvent", () => {
    it("creates an audit record with all fields", async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

      await logAuditEvent({
        userId: "user-1",
        action: "LOGIN_SUCCESS",
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
        metadata: { method: "password" },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: "user-1",
          action: "LOGIN_SUCCESS",
          ipAddress: "127.0.0.1",
          userAgent: "Mozilla/5.0",
          metadata: JSON.stringify({ method: "password" }),
        },
      });
    });

    it("creates an audit record with null optional fields", async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

      await logAuditEvent({
        action: "LOGIN_FAILURE",
        ipAddress: "10.0.0.1",
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          userId: null,
          action: "LOGIN_FAILURE",
          ipAddress: "10.0.0.1",
          userAgent: null,
          metadata: null,
        },
      });
    });
  });

  describe("getAuditLogs", () => {
    it("returns logs and total count", async () => {
      const mockLogs = [
        {
          id: "log-1",
          userId: "user-1",
          action: "LOGIN_SUCCESS",
          ipAddress: "127.0.0.1",
          userAgent: null,
          metadata: null,
          createdAt: new Date(),
        },
      ];
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue(mockLogs as never);
      vi.mocked(prisma.auditLog.count).mockResolvedValue(1 as never);

      const result = await getAuditLogs({});

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: {},
        orderBy: { createdAt: "desc" },
        take: 50,
        skip: 0,
      });
    });

    it("filters by userId", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

      await getAuditLogs({ userId: "user-1" });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: "user-1" },
        }),
      );
    });

    it("filters by action", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);

      await getAuditLogs({ action: "LOGIN_SUCCESS" });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { action: "LOGIN_SUCCESS" },
        }),
      );
    });

    it("applies pagination", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.auditLog.count).mockResolvedValue(100 as never);

      const result = await getAuditLogs({ limit: 10, offset: 20 });

      expect(result.total).toBe(100);
      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 20,
        }),
      );
    });
  });
});
