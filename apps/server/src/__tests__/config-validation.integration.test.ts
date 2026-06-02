import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;

const mockUserCount = vi.fn().mockResolvedValue(2);
const mockUserFindUnique = vi.fn();
const mockConfigFindUnique = vi.fn();
const mockConfigFindMany = vi.fn();
const mockConfigUpdate = vi.fn();
const mockTransaction = vi.fn();

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: mockUserFindUnique,
    },
    appConfig: {
      findUnique: mockConfigFindUnique,
      findMany: mockConfigFindMany,
      update: mockConfigUpdate,
    },
    $transaction: mockTransaction,
  },
}));

// The audit log writer is fire-and-forget; stub it so it never touches the DB.
vi.mock("../modules/audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("PATCH /app/configs — auditRetentionDays validation (integration)", () => {
  let app: FastifyInstance;

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  async function adminHeaders(): Promise<Record<string, string>> {
    const { csrfToken, csrfCookie } = await getCsrf();
    const jwt = app.jwt.sign({ userId: "admin-user", isAdmin: true, tokenVersion: TOKEN_VERSION });
    return {
      "content-type": "application/json",
      cookie: `token=${app.signCookie(jwt)}; _csrf=${csrfCookie}`,
      "x-csrf-token": csrfToken,
    };
  }

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { appRoutes } = await import("../modules/app/routes.js");
    app.register(appRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCount.mockResolvedValue(2);
    mockUserFindUnique.mockResolvedValue({ id: "admin-user", tokenVersion: TOKEN_VERSION });
    mockConfigFindUnique.mockResolvedValue({
      key: "auditRetentionDays",
      value: "365",
      type: "number",
      group: "audit",
      updatedAt: new Date(),
    });
    mockConfigUpdate.mockImplementation(async ({ where, data }) => ({
      key: where.key,
      value: data.value,
      type: "number",
      group: "audit",
      updatedAt: new Date(),
    }));
  });

  describe("single update", () => {
    it("rejects a value below the 7-day floor with 400", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/app/configs/auditRetentionDays",
        headers: await adminHeaders(),
        payload: { value: "3" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/at least 7 days/);
      // Validation must run before any DB write.
      expect(mockConfigUpdate).not.toHaveBeenCalled();
    });

    it.each(["-1", "3.5", "abc", ""])("rejects %j with 400", async (value) => {
      const res = await app.inject({
        method: "PATCH",
        url: "/app/configs/auditRetentionDays",
        headers: await adminHeaders(),
        payload: { value },
      });

      expect(res.statusCode).toBe(400);
      expect(mockConfigUpdate).not.toHaveBeenCalled();
    });

    it("accepts 0 (keep forever) with 200", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/app/configs/auditRetentionDays",
        headers: await adminHeaders(),
        payload: { value: "0" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().config.value).toBe("0");
      expect(mockConfigUpdate).toHaveBeenCalledOnce();
    });

    it("accepts a valid retention period with 200", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/app/configs/auditRetentionDays",
        headers: await adminHeaders(),
        payload: { value: "30" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().config.value).toBe("30");
    });

    it("does not constrain unrelated config keys", async () => {
      mockConfigFindUnique.mockResolvedValue({
        key: "appName",
        value: "old",
        type: "string",
        group: "general",
        updatedAt: new Date(),
      });

      const res = await app.inject({
        method: "PATCH",
        url: "/app/configs/appName",
        headers: await adminHeaders(),
        payload: { value: "1" },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("bulk update", () => {
    it("rejects the whole batch with 400 when one value is invalid", async () => {
      const res = await app.inject({
        method: "PATCH",
        url: "/app/configs",
        headers: await adminHeaders(),
        payload: [
          { key: "appName", value: "Acme" },
          { key: "auditRetentionDays", value: "3" },
        ],
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatch(/at least 7 days/);
      // No partial write: the transaction never runs.
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("accepts a batch of valid values with 200", async () => {
      mockConfigFindMany.mockResolvedValue([
        { key: "appName", value: "old", type: "string", group: "general" },
        { key: "auditRetentionDays", value: "365", type: "number", group: "audit" },
      ]);
      mockTransaction.mockResolvedValue([
        { key: "appName", value: "Acme", type: "string", group: "general", updatedAt: new Date() },
        {
          key: "auditRetentionDays",
          value: "90",
          type: "number",
          group: "audit",
          updatedAt: new Date(),
        },
      ]);

      const res = await app.inject({
        method: "PATCH",
        url: "/app/configs",
        headers: await adminHeaders(),
        payload: [
          { key: "appName", value: "Acme" },
          { key: "auditRetentionDays", value: "90" },
        ],
      });

      expect(res.statusCode).toBe(200);
      expect(mockTransaction).toHaveBeenCalledOnce();
    });
  });
});
