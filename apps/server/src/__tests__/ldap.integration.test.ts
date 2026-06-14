/**
 * ldap.integration.test.ts
 *
 * Integration tests for LDAP/AD Sync endpoints using app.inject().
 * Tests the full request lifecycle for all 7 LDAP admin routes.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma BEFORE any app imports ───────────────────────────────────────
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    group: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    ldapConfig: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    ldapSyncLog: {
      create: vi.fn().mockResolvedValue({
        id: "log-1",
        trigger: "manual",
        status: "running",
        startedAt: new Date("2026-01-01T10:00:00Z"),
        completedAt: null,
        usersCreated: 0,
        usersUpdated: 0,
        usersDeactivated: 0,
        usersSkipped: 0,
        usersReactivated: 0,
        details: null,
        createdAt: new Date("2026-01-01T10:00:00Z"),
      }),
      update: vi.fn(),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    passwordReset: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ── Mock config service ───────────────────────────────────────────────────────
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    const values: Record<string, string> = {
      maxLoginAttempts: "5",
      loginLockoutDuration: "900",
      smtpEnabled: "false",
      passwordResetTokenExpiration: "3600",
      appName: "OuiTransfer",
      smtpFromName: "OuiTransfer",
      smtpFromEmail: "noreply@test.com",
    };
    return values[key] ?? "";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

// ── Mock token version validation ────────────────────────────────────────────
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Mock ldapts — no real LDAP connections ───────────────────────────────────
vi.mock("ldapts", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
  Client: vi.fn().mockImplementation(function (this: any) {
    this.bind = vi.fn().mockResolvedValue(undefined);
    this.search = vi.fn().mockResolvedValue({ searchEntries: [] });
    this.unbind = vi.fn().mockResolvedValue(undefined);
  }),
  // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
  EqualityFilter: vi.fn().mockImplementation(function (this: any, opts: any) {
    this.attribute = opts.attribute;
    this.value = opts.value;
  }),
  // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
  AndFilter: vi.fn().mockImplementation(function (this: any, opts: any) {
    this.filters = opts.filters;
  }),
}));

// ── Mock encryption — no ENCRYPTION_SECRET needed ────────────────────────────
vi.mock("../modules/ldap/encryption.js", () => ({
  encrypt: vi.fn().mockReturnValue("encrypted-value"),
  decrypt: vi.fn().mockReturnValue("decrypted-password"),
}));

// ── Mock scheduler — no real intervals ───────────────────────────────────────
vi.mock("../modules/ldap/sync.scheduler.js", () => ({
  startScheduler: vi.fn(),
  stopScheduler: vi.fn(),
  getNextSyncAt: vi.fn().mockReturnValue(null),
  initSchedulerOnBoot: vi.fn().mockResolvedValue(undefined),
}));

// ── Static import of mocked module (must come AFTER vi.mock) ─────────────────
import { prisma } from "../shared/prisma.js";

// ─────────────────────────────────────────────────────────────────────────────

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeConfig(overrides?: Record<string, unknown>) {
  return {
    id: "cfg-1",
    enabled: true,
    serverUrl: "ldaps://ad.corp.local:636",
    bindDn: "cn=svc,dc=corp,dc=local",
    bindPassword: "encrypted-value",
    searchBase: "DC=corp,DC=local",
    syncGroupDn: "CN=OuiTransfer,OU=Groups,DC=corp,DC=local",
    usernameAttribute: "sAMAccountName",
    emailAttribute: "mail",
    displayNameAttribute: "displayName",
    syncIntervalMinutes: 360,
    useTls: true,
    tlsSkipVerify: false,
    appUrl: "https://transfer.corp.local",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeLog(overrides?: Record<string, unknown>) {
  return {
    id: "log-1",
    trigger: "manual",
    status: "success",
    startedAt: new Date("2026-01-01T10:00:00Z"),
    completedAt: new Date("2026-01-01T10:05:00Z"),
    usersCreated: 2,
    usersUpdated: 1,
    usersDeactivated: 0,
    usersSkipped: 0,
    usersReactivated: 0,
    details: null,
    createdAt: new Date("2026-01-01T10:00:00Z"),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("LDAP integration tests", () => {
  let app: FastifyInstance;
  const defaultConfig = makeConfig();
  const defaultLog = makeLog();

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("ENCRYPTION_SECRET", "d]test-encryption-secret-32chars");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { ldapRoutes } = await import("../modules/ldap/routes.js");
    app.register(ldapRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: 1 user exists (non-setup mode)
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.user.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.group.findMany).mockResolvedValue([]);
    vi.mocked(prisma.ldapConfig.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.ldapSyncLog.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.ldapSyncLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.ldapSyncLog.count).mockResolvedValue(0);
    vi.mocked(prisma.ldapSyncLog.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.ldapSyncLog.create).mockResolvedValue({
      id: "log-1",
      trigger: "manual",
      status: "running",
      startedAt: new Date("2026-01-01T10:00:00Z"),
      completedAt: null,
      usersCreated: 0,
      usersUpdated: 0,
      usersDeactivated: 0,
      usersSkipped: 0,
      usersReactivated: 0,
      details: null,
      createdAt: new Date("2026-01-01T10:00:00Z"),
    } as never);
    vi.mocked(prisma.ldapSyncLog.update).mockResolvedValue({
      ...defaultLog,
    } as never);
    vi.mocked(prisma.ldapSyncLog.updateMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      if (typeof fn === "function") {
        return fn(prisma);
      }
      return Promise.all(fn);
    });
  });

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function signTestToken(userId: string, isAdmin = false): string {
    const jwt = app.jwt.sign({ userId, isAdmin, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  /** Headers for admin mutation (POST/PUT) with CSRF */
  function adminHeaders(csrfToken: string, csrfCookie: string, userId = "admin-1") {
    const token = signTestToken(userId, true);
    return {
      "content-type": "application/json",
      cookie: `token=${token}; _csrf=${csrfCookie}`,
      "x-csrf-token": csrfToken,
    };
  }

  /** Headers for admin read (GET) — no CSRF needed */
  function adminReadHeaders(userId = "admin-1") {
    const token = signTestToken(userId, true);
    return { cookie: `token=${token}` };
  }

  /** Headers for non-admin read */
  function nonAdminHeaders(userId = "user-1") {
    const token = signTestToken(userId, false);
    return { cookie: `token=${token}` };
  }

  // ── Auth enforcement (tested once, representative of all endpoints) ──────────

  describe("Admin-only enforcement", () => {
    it("returns 401 for unauthenticated GET /admin/ldap/config", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/ldap/config" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-admin GET /admin/ldap/config", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/config",
        headers: nonAdminHeaders(),
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 for unauthenticated PUT /admin/ldap/config", async () => {
      // Pass a valid CSRF token (no auth cookie) so the JWT check is reached
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          cookie: `_csrf=${csrfCookie}`,
        },
        payload: JSON.stringify({}),
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-admin POST /admin/ldap/sync", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const token = signTestToken("user-1", false);
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/sync",
        headers: {
          // No content-type — POST /sync takes no body
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
      });
      expect(res.statusCode).toBe(403);
    });

    it("returns 401 for unauthenticated GET /admin/ldap/status", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/ldap/status" });
      expect(res.statusCode).toBe(401);
    });
  });

  // ── GET /admin/ldap/config ────────────────────────────────────────────────

  describe("GET /admin/ldap/config", () => {
    it("returns { configured: false } when no config exists", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/config",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ configured: false });
    });

    it("returns config with masked password when config exists", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(defaultConfig as never);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/config",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(true);
      expect(body.id).toBe("cfg-1");
      expect(body.enabled).toBe(true);
      expect(body.serverUrl).toBe("ldaps://ad.corp.local:636");
      expect(body.bindDn).toBe("cn=svc,dc=corp,dc=local");
      // Password must be masked
      expect(body.bindPassword).toBe("••••••••");
      expect(body.searchBase).toBe("DC=corp,DC=local");
      expect(body.syncGroupDn).toBe("CN=OuiTransfer,OU=Groups,DC=corp,DC=local");
      expect(body.usernameAttribute).toBe("sAMAccountName");
      expect(body.emailAttribute).toBe("mail");
      expect(body.displayNameAttribute).toBe("displayName");
      expect(body.syncIntervalMinutes).toBe(360);
      expect(body.useTls).toBe(true);
      expect(body.tlsSkipVerify).toBe(false);
    });
  });

  // ── PUT /admin/ldap/config ────────────────────────────────────────────────

  describe("PUT /admin/ldap/config", () => {
    const validPayload = {
      enabled: true,
      serverUrl: "ldaps://ad.corp.local:636",
      bindDn: "cn=svc,dc=corp,dc=local",
      bindPassword: "secret-password",
      searchBase: "DC=corp,DC=local",
      syncGroupDn: "CN=OuiTransfer,OU=Groups,DC=corp,DC=local",
      usernameAttribute: "sAMAccountName",
      emailAttribute: "mail",
      displayNameAttribute: "displayName",
      syncIntervalMinutes: 360,
      useTls: true,
      appUrl: "https://transfer.corp.local",
    };

    it("creates new config and returns masked password", async () => {
      // No existing config → upsert will create
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.ldapConfig.upsert).mockResolvedValue(makeConfig({ id: "cfg-new" }) as never);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify(validPayload),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(true);
      expect(body.bindPassword).toBe("••••••••");
      expect(prisma.ldapConfig.upsert).toHaveBeenCalled();
    });

    it("updates existing config and returns masked password", async () => {
      // Existing config → upsert will update
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(defaultConfig as never);
      vi.mocked(prisma.ldapConfig.upsert).mockResolvedValue(
        makeConfig({ serverUrl: "ldaps://new-server:636" }) as never,
      );

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validPayload, serverUrl: "ldaps://new-server:636" }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(true);
      expect(body.bindPassword).toBe("••••••••");
      expect(prisma.ldapConfig.upsert).toHaveBeenCalled();
    });

    it("keeps existing bind password when masked password is sent", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(defaultConfig as never);
      vi.mocked(prisma.ldapConfig.upsert).mockResolvedValue(defaultConfig as never);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validPayload, bindPassword: "••••••••" }),
      });

      expect(res.statusCode).toBe(200);
      // The upsert should have been called with the stored (encrypted) password
      expect(prisma.ldapConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            bindPassword: "encrypted-value",
          }),
        }),
      );
    });

    it("returns 400 when bind password is empty for new config", async () => {
      // No existing config, no password provided
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validPayload, bindPassword: "" }),
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 for missing required fields (Fastify schema validation)", async () => {
      // Now that routes use LdapConfigSchema as the body schema, Fastify validates
      // the body BEFORE the handler runs, returning a proper 400 with validation details.
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ enabled: true }), // Missing many required fields
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when usernameAttribute fails RFC 4512 validation (injection guard)", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validPayload, usernameAttribute: "sAMAccountName*" }),
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when emailAttribute contains LDAP metacharacters", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validPayload, emailAttribute: "mail)(cn=*" }),
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when searchBase is not a valid DN", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validPayload, searchBase: "not-a-dn" }),
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when syncGroupDn is not a valid DN", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validPayload, syncGroupDn: "../etc/passwd" }),
      });
      expect(res.statusCode).toBe(400);
    });

    it("stops scheduler when config is disabled", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(defaultConfig as never);
      vi.mocked(prisma.ldapConfig.upsert).mockResolvedValue(
        makeConfig({ enabled: false }) as never,
      );

      const { stopScheduler } = await import("../modules/ldap/sync.scheduler.js");

      const { csrfToken, csrfCookie } = await getCsrf();
      await app.inject({
        method: "PUT",
        url: "/admin/ldap/config",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validPayload, enabled: false }),
      });

      expect(stopScheduler).toHaveBeenCalled();
    });
  });

  // ── POST /admin/ldap/test ─────────────────────────────────────────────────

  describe("POST /admin/ldap/test", () => {
    const validTestPayload = {
      serverUrl: "ldaps://ad.corp.local:636",
      bindDn: "cn=svc,dc=corp,dc=local",
      bindPassword: "secret-password",
      searchBase: "DC=corp,DC=local",
      syncGroupDn: "CN=OuiTransfer,OU=Groups,DC=corp,DC=local",
      usernameAttribute: "sAMAccountName",
      emailAttribute: "mail",
      displayNameAttribute: "displayName",
      useTls: true,
    };

    it("returns success and member count on valid connection", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify(validTestPayload),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
      expect(typeof body.memberCount).toBe("number");
      expect(typeof body.message).toBe("string");
    });

    it("returns 400 when bind password is empty (Fastify schema validation)", async () => {
      // Now that routes use LdapTestSchema, Fastify validates the body and
      // returns 400 for validation failures (instead of 500 from raw ZodError).
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validTestPayload, bindPassword: "" }),
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when serverUrl is missing (Fastify schema validation)", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const { serverUrl: _ignored, ...withoutServerUrl } = validTestPayload;
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify(withoutServerUrl),
      });

      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when displayNameAttribute fails RFC 4512 validation", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validTestPayload, displayNameAttribute: "1invalid" }),
      });
      expect(res.statusCode).toBe(400);
    });

    it("returns 401 for unauthenticated request", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
          cookie: `_csrf=${csrfCookie}`,
        },
        payload: JSON.stringify(validTestPayload),
      });

      expect(res.statusCode).toBe(401);
    });

    // ── SSRF / transport guard on the test endpoint (A5-05, A5-07, A5-11) ──────

    it("rejects an LDAP target pointed at the cloud metadata host (SSRF)", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validTestPayload, serverUrl: "ldaps://169.254.169.254:636" }),
      });

      // The route returns 200 with success:false (it never throws the SSRF error
      // to the client; the guard message is config feedback, not a topology leak).
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.memberCount).toBe(0);
      expect(body.message).toMatch(/not permitted|metadata/i);
    });

    it("allows a private/loopback LDAP target by default (admin's internal DC is their choice)", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validTestPayload, serverUrl: "ldaps://127.0.0.1:636" }),
      });

      // The guard no longer blocks private hosts — the (mocked) bind succeeds.
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });

    it("allows cleartext ldap:// to a remote host but only warns (A5-07: warn, never block)", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({
          ...validTestPayload,
          serverUrl: "ldap://ad.corp.local:389",
          useTls: false,
        }),
      });

      // Transport confidentiality is a warning, not a block: the (mocked) bind succeeds.
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(true);
    });

    it("rejects a non-ldap scheme in serverUrl", async () => {
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify({ ...validTestPayload, serverUrl: "http://ad.corp.local" }),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(false);
      expect(body.message).toMatch(/scheme/i);
    });

    it("returns a GENERIC message (no raw error) when the bind fails (A5-11 oracle)", async () => {
      // Make the next ldapts bind reject with a detailed internal error. The
      // route must NOT surface that text — it would be a port-scan/topology oracle.
      const ldapts = await import("ldapts");
      vi.mocked(ldapts.Client).mockImplementationOnce(
        // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
        function (this: any) {
          this.bind = vi
            .fn()
            .mockRejectedValue(new Error("connect ECONNREFUSED 10.1.2.3:636 — internal-dc-07"));
          this.search = vi.fn().mockResolvedValue({ searchEntries: [] });
          this.unbind = vi.fn().mockResolvedValue(undefined);
        } as never,
      );

      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/test",
        headers: adminHeaders(csrfToken, csrfCookie),
        payload: JSON.stringify(validTestPayload),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.success).toBe(false);
      // The raw error (host/IP/internal name) must not leak.
      expect(body.message).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|internal-dc-07/);
      expect(body.message).toMatch(/Connection failed/i);
    });
  });

  // ── POST /admin/ldap/sync ─────────────────────────────────────────────────

  describe("POST /admin/ldap/sync", () => {
    it("triggers sync and returns logId", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(defaultConfig as never);
      vi.mocked(prisma.ldapSyncLog.create).mockResolvedValue({
        id: "log-trigger-1",
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
      } as never);
      vi.mocked(prisma.ldapSyncLog.update).mockResolvedValue(defaultLog as never);
      vi.mocked(prisma.user.findMany).mockResolvedValue([]);
      vi.mocked(prisma.group.findMany).mockResolvedValue([]);

      const { csrfToken, csrfCookie } = await getCsrf();
      const token = signTestToken("admin-1", true);
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/sync",
        // No content-type header — this route takes no body
        headers: {
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(typeof body.logId).toBe("string");
      expect(body.logId).toBe("log-trigger-1");
    });

    it("returns 401 for unauthenticated request", async () => {
      // Use valid CSRF (no auth cookie) so JWT check is reached
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/sync",
        headers: {
          "x-csrf-token": csrfToken,
          cookie: `_csrf=${csrfCookie}`,
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it("returns 500 when LDAP config not found", async () => {
      // No config → sync service throws plain Error ("LDAP configuration not found")
      // which becomes 500 via the global error handler's unknown-error branch.
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.ldapSyncLog.create).mockResolvedValue({
        id: "log-err-1",
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
      } as never);
      vi.mocked(prisma.ldapSyncLog.update).mockResolvedValue({
        ...defaultLog,
        status: "error",
      } as never);

      const { csrfToken, csrfCookie } = await getCsrf();
      const token = signTestToken("admin-1", true);
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/sync",
        headers: {
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
      });

      expect(res.statusCode).toBe(500);
    });
  });

  // ── GET /admin/ldap/sync/logs ─────────────────────────────────────────────

  describe("GET /admin/ldap/sync/logs", () => {
    it("returns empty list when no logs exist", async () => {
      vi.mocked(prisma.ldapSyncLog.findMany).mockResolvedValue([]);
      vi.mocked(prisma.ldapSyncLog.count).mockResolvedValue(0);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/sync/logs",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.logs).toEqual([]);
      expect(body.total).toBe(0);
    });

    it("returns list of logs with total count", async () => {
      vi.mocked(prisma.ldapSyncLog.findMany).mockResolvedValue([defaultLog as never]);
      vi.mocked(prisma.ldapSyncLog.count).mockResolvedValue(1);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/sync/logs",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.logs).toHaveLength(1);
      expect(body.total).toBe(1);
      expect(body.logs[0].id).toBe("log-1");
      expect(body.logs[0].status).toBe("success");
      expect(body.logs[0].usersCreated).toBe(2);
    });

    it("supports pagination via query params", async () => {
      vi.mocked(prisma.ldapSyncLog.findMany).mockResolvedValue([]);
      vi.mocked(prisma.ldapSyncLog.count).mockResolvedValue(25);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/sync/logs?limit=10&offset=20",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(200);
      expect(prisma.ldapSyncLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: 10, skip: 20 }),
      );
    });

    it("returns 401 for unauthenticated request", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/ldap/sync/logs" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-admin", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/sync/logs",
        headers: nonAdminHeaders(),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── GET /admin/ldap/sync/logs/:id ─────────────────────────────────────────

  describe("GET /admin/ldap/sync/logs/:id", () => {
    it("returns log detail for existing log", async () => {
      vi.mocked(prisma.ldapSyncLog.findUnique).mockResolvedValue(defaultLog as never);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/sync/logs/log-1",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe("log-1");
      expect(body.trigger).toBe("manual");
      expect(body.status).toBe("success");
      expect(body.usersCreated).toBe(2);
      expect(body.usersUpdated).toBe(1);
    });

    it("returns 404 for non-existent log", async () => {
      vi.mocked(prisma.ldapSyncLog.findUnique).mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/sync/logs/nonexistent-id",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 401 for unauthenticated request", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/sync/logs/log-1",
      });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-admin", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/sync/logs/log-1",
        headers: nonAdminHeaders(),
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // ── GET /admin/ldap/status ────────────────────────────────────────────────

  describe("GET /admin/ldap/status", () => {
    it("returns status with configured=false when no config", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);
      vi.mocked(prisma.ldapSyncLog.findFirst).mockResolvedValue(null);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/status",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(false);
      expect(body.enabled).toBe(false);
      expect(body.syncInProgress).toBe(false);
      expect(body.lastSync).toBeNull();
      expect(body.nextSyncAt).toBeNull();
    });

    it("returns status with config details when configured", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(defaultConfig as never);
      vi.mocked(prisma.ldapSyncLog.findFirst).mockResolvedValue(defaultLog as never);

      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/status",
        headers: adminReadHeaders(),
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.configured).toBe(true);
      expect(body.enabled).toBe(true);
      expect(body.syncInProgress).toBe(false);
      expect(body.lastSync).not.toBeNull();
      expect(body.lastSync.id).toBe("log-1");
      expect(body.lastSync.status).toBe("success");
      expect(body.lastSync.usersCreated).toBe(2);
      expect(body.lastSync.usersUpdated).toBe(1);
      expect(body.lastSync.usersDeactivated).toBe(0);
      expect(body.lastSync.usersReactivated).toBe(0);
      expect(body.lastSync.usersSkipped).toBe(0);
    });

    it("returns 401 for unauthenticated request", async () => {
      const res = await app.inject({ method: "GET", url: "/admin/ldap/status" });
      expect(res.statusCode).toBe(401);
    });

    it("returns 403 for non-admin", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/admin/ldap/status",
        headers: nonAdminHeaders(),
      });
      expect(res.statusCode).toBe(403);
    });
  });
});
