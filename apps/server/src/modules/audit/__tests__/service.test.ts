import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
    },
    $executeRawUnsafe: vi.fn(),
  },
}));

vi.mock("../../../utils/logger.js", () => {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { getLogger: vi.fn(() => logger) };
});

import { prisma } from "../../../shared/prisma.js";
import {
  AuditActionSchema,
  AuditTargetTypeSchema,
  deleteOldAuditLogs,
  exportAuditLogs,
  getAuditLogs,
  logAuditEvent,
  REDACTED_EMAIL,
  redactEmailFromAuditLogs,
} from "../service.js";

// Helper to collect an async generator into an array
async function collectAsyncGenerator<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const results: T[] = [];
  for await (const chunk of gen) {
    results.push(chunk);
  }
  return results;
}

describe("Audit service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("logAuditEvent", () => {
    it("creates an audit record with targetType and targetId", async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

      await logAuditEvent({
        userId: "user-1",
        action: "LOGIN_SUCCESS",
        ipAddress: "127.0.0.1",
        userAgent: "Mozilla/5.0",
        metadata: { method: "password" },
        targetType: "user",
        targetId: "user-1",
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          targetType: "user",
          targetId: "user-1",
          metadata: JSON.stringify({ method: "password" }),
        }),
      });
    });

    it("strips denylist keys from metadata", async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);

      await logAuditEvent({
        action: "ADMIN_CONFIG_CHANGE",
        ipAddress: "10.0.0.1",
        metadata: {
          key: "smtpHost",
          password: "secret123",
          token: "abc",
          secret: "xyz",
          bindPassword: "ldap-pass",
          clientSecret: "oauth-secret",
          smtpPass: "mail-pass",
          twoFactorSecret: "totp-secret",
          twoFactorBackupCodes: ["code1"],
          currentPassword: "old",
          newPassword: "new",
          confirmPassword: "new",
          safeKey: "this-stays",
        },
      });

      const callData = vi.mocked(prisma.auditLog.create).mock.calls[0]![0]!.data;
      const parsedMetadata = JSON.parse(callData.metadata as string);
      expect(parsedMetadata).toEqual({ key: "smtpHost", safeKey: "this-stays" });
      expect(parsedMetadata).not.toHaveProperty("password");
      expect(parsedMetadata).not.toHaveProperty("token");
      expect(parsedMetadata).not.toHaveProperty("secret");
    });

    it("caps userAgent at 512 characters", async () => {
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as never);
      const longAgent = "X".repeat(1000);

      await logAuditEvent({
        action: "LOGIN_SUCCESS",
        ipAddress: "10.0.0.1",
        userAgent: longAgent,
      });

      const callData = vi.mocked(prisma.auditLog.create).mock.calls[0]![0]!.data;
      expect((callData.userAgent as string).length).toBe(512);
    });

    it("creates record with null optional fields", async () => {
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
          targetType: null,
          targetId: null,
        },
      });
    });
  });

  describe("getAuditLogs", () => {
    beforeEach(() => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);
      vi.mocked(prisma.auditLog.count).mockResolvedValue(0 as never);
    });

    it("filters by targetType", async () => {
      await getAuditLogs({ targetType: "share" });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetType: "share" }),
        }),
      );
    });

    it("filters by targetId", async () => {
      await getAuditLogs({ targetId: "share-1" });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ targetId: "share-1" }),
        }),
      );
    });

    it("filters by dateFrom (inclusive)", async () => {
      const dateFrom = new Date("2026-01-01T00:00:00.000Z");
      await getAuditLogs({ dateFrom });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ gte: dateFrom }),
          }),
        }),
      );
    });

    it("filters by dateTo (inclusive, end of day)", async () => {
      const dateTo = new Date("2026-01-31T23:59:59.999Z");
      await getAuditLogs({ dateTo });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            createdAt: expect.objectContaining({ lte: dateTo }),
          }),
        }),
      );
    });

    it("searches ipAddress and action via contains", async () => {
      await getAuditLogs({ search: "127.0" });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            OR: [{ ipAddress: { contains: "127.0" } }, { action: { contains: "127.0" } }],
          }),
        }),
      );
    });

    it("returns logs and total count", async () => {
      const mockLogs = [
        {
          id: "log-1",
          userId: "user-1",
          action: "LOGIN_SUCCESS",
          ipAddress: "127.0.0.1",
          userAgent: null,
          metadata: null,
          targetType: "user",
          targetId: "user-1",
          createdAt: new Date(),
        },
      ];
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue(mockLogs as never);
      vi.mocked(prisma.auditLog.count).mockResolvedValue(1 as never);

      const result = await getAuditLogs({});

      expect(result.logs).toHaveLength(1);
      expect(result.total).toBe(1);
    });
  });

  describe("exportAuditLogs", () => {
    it("throws if dateFrom or dateTo is missing", async () => {
      await expect(collectAsyncGenerator(exportAuditLogs({ format: "csv" }))).rejects.toThrow(
        "dateFrom and dateTo are required for export",
      );

      await expect(
        collectAsyncGenerator(exportAuditLogs({ format: "csv", dateFrom: new Date() })),
      ).rejects.toThrow("dateFrom and dateTo are required for export");
    });

    it("yields CSV with correct header", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);

      const chunks = await collectAsyncGenerator(
        exportAuditLogs({
          format: "csv",
          dateFrom: new Date("2026-01-01"),
          dateTo: new Date("2026-01-31"),
        }),
      );

      // chunks[0] is the UTF-8 BOM; chunks[1] is the header row
      expect(chunks[0]).toBe("\uFEFF");
      expect(chunks[1]).toContain(
        "id,userId,action,ipAddress,userAgent,targetType,targetId,metadata,createdAt",
      );
    });

    it("yields valid JSON array", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([] as never);

      const chunks = await collectAsyncGenerator(
        exportAuditLogs({
          format: "json",
          dateFrom: new Date("2026-01-01"),
          dateTo: new Date("2026-01-31"),
        }),
      );

      const fullJson = chunks.join("");
      expect(JSON.parse(fullJson)).toEqual([]);
    });
  });

  describe("deleteOldAuditLogs", () => {
    it("deletes in batches using raw SQL and returns total", async () => {
      vi.mocked(prisma.$executeRawUnsafe)
        .mockResolvedValueOnce(1000) // first batch: full batch → continue
        .mockResolvedValueOnce(500); // second batch: < 1000 → stop

      const result = await deleteOldAuditLogs(new Date("2025-01-01"));

      expect(result).toBe(1500);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    });

    it("returns 0 when nothing to delete", async () => {
      vi.mocked(prisma.$executeRawUnsafe).mockResolvedValueOnce(0);

      const result = await deleteOldAuditLogs(new Date("2025-01-01"));

      expect(result).toBe(0);
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(1);
    });
  });

  describe("schemas", () => {
    it("AuditActionSchema accepts known actions", () => {
      expect(AuditActionSchema.parse("LOGIN_SUCCESS")).toBe("LOGIN_SUCCESS");
      expect(AuditActionSchema.parse("SHARE_CREATE")).toBe("SHARE_CREATE");
    });

    it("AuditTargetTypeSchema accepts known types", () => {
      expect(AuditTargetTypeSchema.parse("share")).toBe("share");
      expect(AuditTargetTypeSchema.parse("user")).toBe("user");
    });

    it("AuditTargetTypeSchema rejects unknown types", () => {
      expect(() => AuditTargetTypeSchema.parse("invalid_type")).toThrow();
    });
  });

  describe("redactEmailFromAuditLogs", () => {
    const EMAIL = "victim@example.com";

    it("returns 0 and queries nothing for an empty email", async () => {
      const result = await redactEmailFromAuditLogs("");
      expect(result).toBe(0);
      expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
    });

    it("narrows candidates with a substring filter on metadata", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);

      await redactEmailFromAuditLogs(EMAIL);

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
        where: { metadata: { contains: EMAIL } },
        select: { id: true, metadata: true },
      });
    });

    it("redacts the email inside a recipients array, preserving other entries", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
        {
          id: "log-1",
          metadata: JSON.stringify({ count: 2, emails: [EMAIL, "other@example.com"] }),
        },
      ] as never);
      vi.mocked(prisma.auditLog.update).mockResolvedValue({} as never);

      const result = await redactEmailFromAuditLogs(EMAIL);

      expect(result).toBe(1);
      expect(prisma.auditLog.update).toHaveBeenCalledWith({
        where: { id: "log-1" },
        data: {
          metadata: JSON.stringify({ count: 2, emails: [REDACTED_EMAIL, "other@example.com"] }),
        },
      });
    });

    it("redacts a scalar email field anywhere in the metadata", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
        { id: "log-2", metadata: JSON.stringify({ email: EMAIL, userId: "u-1" }) },
      ] as never);
      vi.mocked(prisma.auditLog.update).mockResolvedValue({} as never);

      const result = await redactEmailFromAuditLogs(EMAIL);

      expect(result).toBe(1);
      expect(prisma.auditLog.update).toHaveBeenCalledWith({
        where: { id: "log-2" },
        data: { metadata: JSON.stringify({ email: REDACTED_EMAIL, userId: "u-1" }) },
      });
    });

    it("does not redact substring (non-exact) matches", async () => {
      // "victim@example.com" is a substring of "joanvictim@example.com" so the
      // contains filter returns the row, but the value is not an exact match.
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
        { id: "log-3", metadata: JSON.stringify({ emails: [`joan${EMAIL}`] }) },
      ] as never);

      const result = await redactEmailFromAuditLogs(EMAIL);

      expect(result).toBe(0);
      expect(prisma.auditLog.update).not.toHaveBeenCalled();
    });

    it("skips unparseable metadata without throwing", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
        { id: "log-4", metadata: "not-json" },
        { id: "log-5", metadata: null },
      ] as never);

      const result = await redactEmailFromAuditLogs(EMAIL);

      expect(result).toBe(0);
      expect(prisma.auditLog.update).not.toHaveBeenCalled();
    });

    it("counts only rows that actually changed", async () => {
      vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
        { id: "log-6", metadata: JSON.stringify({ emails: [EMAIL] }) },
        { id: "log-7", metadata: JSON.stringify({ note: `mailto:${EMAIL}` }) }, // substring, no exact match
      ] as never);
      vi.mocked(prisma.auditLog.update).mockResolvedValue({} as never);

      const result = await redactEmailFromAuditLogs(EMAIL);

      expect(result).toBe(1);
      expect(prisma.auditLog.update).toHaveBeenCalledTimes(1);
    });
  });
});
