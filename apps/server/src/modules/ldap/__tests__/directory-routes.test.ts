/**
 * Integration tests (app.inject()) for the LDAP directory-browser routes:
 *   POST /admin/ldap/browse
 *   POST /admin/ldap/search-groups
 *
 * Covers the admin gate, masked-password resolution (typed / stored-decrypt /
 * no-config / ENCRYPTION_SECRET-unset), body validation, error genericization
 * (no topology leak), the truncation flag, and the naming-context vs children
 * branches.
 *
 * The ldapts-backed LdapClient is mocked so no socket is opened; the
 * masked-password resolver's repository + decrypt are driven via the mocked
 * prisma + encryption modules.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma ──────────────────────────────────────────────────────────────
// admin-prevalidation uses user.count; the bind-password resolver uses
// ldapConfig.findUnique (via LdapConfigRepository.get()).
vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: vi.fn().mockResolvedValue(1),
      findUnique: vi.fn(),
    },
    ldapConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    ldapSyncLog: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
    },
  },
}));

vi.mock("../../../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    if (key === "passwordMinLength") return "8";
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

vi.mock("../../../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Mock the encryption helper used by the bind-password resolver ────────────
const decryptMock = vi.fn();
vi.mock("../encryption.js", () => ({
  encrypt: vi.fn((v: string) => `ENC(${v})`),
  decrypt: (...args: unknown[]) => decryptMock(...args),
}));

// ── Mock the LdapClient (no real network / SSRF) ─────────────────────────────
const connectMock = vi.fn();
const disconnectMock = vi.fn();
const readRootDseMock = vi.fn();
const browseContainersMock = vi.fn();
const searchGroupsMock = vi.fn();

vi.mock("../ldap.client.js", () => ({
  LdapClient: class MockLdapClient {
    connect = connectMock;
    disconnect = disconnectMock;
    readRootDse = readRootDseMock;
    browseContainers = browseContainersMock;
    searchGroups = searchGroupsMock;
  },
}));

import { prisma } from "../../../shared/prisma.js";
import { AppError } from "../../../utils/app-error.js";

const VALID_CONN = {
  serverUrl: "ldap://dc.corp.local",
  bindDn: "CN=svc,DC=corp,DC=local",
  bindPassword: "typed-secret",
  useTls: false,
  tlsSkipVerify: false,
};

describe("LDAP directory routes — integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("NODE_ENV", "test");
    const { buildApp } = await import("../../../app.js");
    app = await buildApp();
    const { ldapRoutes } = await import("../routes.js");
    app.register(ldapRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.count).mockResolvedValue(1);
    vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);
    connectMock.mockResolvedValue(undefined);
    disconnectMock.mockResolvedValue(undefined);
  });

  function signAdminToken(): string {
    const jwt = app.jwt.sign({ userId: "admin-user", isAdmin: true, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  function signUserToken(): string {
    const jwt = app.jwt.sign({ userId: "regular-user", isAdmin: false, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  async function getCsrf(): Promise<{ csrfToken: string; csrfCookie: string }> {
    const res = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = res.json();
    const csrfCookie = res.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture: _csrf cookie not found");
    return { csrfToken, csrfCookie: csrfCookie.value };
  }

  async function postAsAdmin(url: string, payload: unknown) {
    const token = signAdminToken();
    const { csrfToken, csrfCookie } = await getCsrf();
    return app.inject({
      method: "POST",
      url,
      headers: {
        "content-type": "application/json",
        cookie: `token=${token}; _csrf=${csrfCookie}`,
        "x-csrf-token": csrfToken,
      },
      payload: JSON.stringify(payload),
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Admin gate
  // ═══════════════════════════════════════════════════════════════════════════

  describe("admin gate", () => {
    it("POST /admin/ldap/browse returns 401 or 403 without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/browse",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify(VALID_CONN),
      });
      expect([401, 403]).toContain(res.statusCode);
    });

    it("POST /admin/ldap/browse returns 403 for a non-admin user", async () => {
      const token = signUserToken();
      const { csrfToken, csrfCookie } = await getCsrf();
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/browse",
        headers: {
          "content-type": "application/json",
          cookie: `token=${token}; _csrf=${csrfCookie}`,
          "x-csrf-token": csrfToken,
        },
        payload: JSON.stringify(VALID_CONN),
      });
      expect(res.statusCode).toBe(403);
    });

    it("POST /admin/ldap/search-groups returns 401 or 403 without auth", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/admin/ldap/search-groups",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ ...VALID_CONN, searchBase: "DC=corp,DC=local", query: "x" }),
      });
      expect([401, 403]).toContain(res.statusCode);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /admin/ldap/browse — RootDSE vs children branches
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /admin/ldap/browse", () => {
    it("with no baseDn returns naming contexts as domain roots + defaultBaseDn", async () => {
      readRootDseMock.mockResolvedValue({
        namingContexts: ["DC=corp,DC=local", "CN=Configuration,DC=corp,DC=local"],
        defaultNamingContext: "DC=corp,DC=local",
      });

      const res = await postAsAdmin("/admin/ldap/browse", VALID_CONN);

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.defaultBaseDn).toBe("DC=corp,DC=local");
      expect(body.nodes).toEqual([
        { dn: "DC=corp,DC=local", name: "DC=corp,DC=local", type: "domain", hasChildren: true },
        {
          dn: "CN=Configuration,DC=corp,DC=local",
          name: "CN=Configuration,DC=corp,DC=local",
          type: "domain",
          hasChildren: true,
        },
      ]);
      expect(readRootDseMock).toHaveBeenCalledTimes(1);
      expect(browseContainersMock).not.toHaveBeenCalled();
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("with a null defaultNamingContext (non-AD) returns defaultBaseDn null", async () => {
      readRootDseMock.mockResolvedValue({
        namingContexts: ["dc=example,dc=org"],
        defaultNamingContext: null,
      });

      const res = await postAsAdmin("/admin/ldap/browse", VALID_CONN);

      expect(res.statusCode).toBe(200);
      expect(res.json().defaultBaseDn).toBeNull();
    });

    it("with a baseDn returns its container children and defaultBaseDn null", async () => {
      browseContainersMock.mockResolvedValue([
        { dn: "OU=Sales,DC=corp,DC=local", name: "Sales", type: "ou", hasChildren: true },
      ]);

      const res = await postAsAdmin("/admin/ldap/browse", {
        ...VALID_CONN,
        baseDn: "DC=corp,DC=local",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.defaultBaseDn).toBeNull();
      expect(body.nodes).toHaveLength(1);
      expect(body.nodes[0].name).toBe("Sales");
      expect(browseContainersMock).toHaveBeenCalledWith("DC=corp,DC=local");
      expect(readRootDseMock).not.toHaveBeenCalled();
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("rejects an invalid baseDn with 400", async () => {
      const res = await postAsAdmin("/admin/ldap/browse", {
        ...VALID_CONN,
        baseDn: "not-a-dn",
      });
      expect(res.statusCode).toBe(400);
      expect(connectMock).not.toHaveBeenCalled();
    });

    it("rejects a missing serverUrl with 400", async () => {
      const { serverUrl: _omit, ...rest } = VALID_CONN;
      const res = await postAsAdmin("/admin/ldap/browse", rest);
      expect(res.statusCode).toBe(400);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Masked-password resolution
  // ═══════════════════════════════════════════════════════════════════════════

  describe("masked-password resolution", () => {
    it("passes a typed password through to connect()", async () => {
      readRootDseMock.mockResolvedValue({ namingContexts: [], defaultNamingContext: null });

      await postAsAdmin("/admin/ldap/browse", VALID_CONN);

      expect(connectMock).toHaveBeenCalledTimes(1);
      expect(connectMock.mock.calls[0][0].bindPassword).toBe("typed-secret");
      expect(decryptMock).not.toHaveBeenCalled();
    });

    it("decrypts the stored password when the body sends the masked placeholder", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue({
        bindPassword: "ENC(stored)",
      } as never);
      decryptMock.mockReturnValue("stored-plaintext");
      readRootDseMock.mockResolvedValue({ namingContexts: [], defaultNamingContext: null });

      const res = await postAsAdmin("/admin/ldap/browse", {
        ...VALID_CONN,
        bindPassword: "••••••••",
      });

      expect(res.statusCode).toBe(200);
      expect(decryptMock).toHaveBeenCalledWith("ENC(stored)");
      expect(connectMock.mock.calls[0][0].bindPassword).toBe("stored-plaintext");
    });

    it("surfaces LDAP_BIND_PASSWORD_REQUIRED when masked but no config is stored", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue(null);

      const res = await postAsAdmin("/admin/ldap/browse", {
        ...VALID_CONN,
        bindPassword: "",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("LDAP_BIND_PASSWORD_REQUIRED");
      expect(connectMock).not.toHaveBeenCalled();
      // disconnect() still runs in the route's finally even on a pre-connect throw.
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("surfaces LDAP_ENCRYPTION_UNAVAILABLE when decrypt fails (ENCRYPTION_SECRET unset)", async () => {
      vi.mocked(prisma.ldapConfig.findUnique).mockResolvedValue({
        bindPassword: "ENC(stored)",
      } as never);
      decryptMock.mockImplementation(() => {
        throw new Error("ENCRYPTION_SECRET not set");
      });

      const res = await postAsAdmin("/admin/ldap/browse", {
        ...VALID_CONN,
        bindPassword: "••••••••",
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("LDAP_ENCRYPTION_UNAVAILABLE");
      expect(connectMock).not.toHaveBeenCalled();
      // disconnect() still runs in the route's finally even on a pre-connect throw.
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Error genericization (no topology leak)
  // ═══════════════════════════════════════════════════════════════════════════

  describe("error genericization", () => {
    it("returns a generic message on a raw bind/connection failure (no topology leak)", async () => {
      connectMock.mockRejectedValue(
        new Error("connect ECONNREFUSED 10.0.0.5:389 — internal-dc.secret.lan"),
      );

      const res = await postAsAdmin("/admin/ldap/browse", VALID_CONN);

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("LDAP_CONNECTION_FAILED");
      expect(body.error).not.toContain("ECONNREFUSED");
      expect(body.error).not.toContain("10.0.0.5");
      expect(body.error).not.toContain("internal-dc");
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("surfaces our own LDAP_* config errors verbatim (scheme/SSRF)", async () => {
      connectMock.mockRejectedValue(
        new AppError(
          400,
          "LDAP server URL must use the ldap:// or ldaps:// scheme",
          "LDAP_INVALID_SCHEME",
        ),
      );

      const res = await postAsAdmin("/admin/ldap/browse", VALID_CONN);

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("LDAP_INVALID_SCHEME");
      expect(body.error).toContain("ldaps://");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /admin/ldap/search-groups
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /admin/ldap/search-groups", () => {
    it("returns groups + truncated flag for a valid request", async () => {
      searchGroupsMock.mockResolvedValue({
        groups: [
          { dn: "CN=Admins,DC=corp,DC=local", name: "Admins", type: "group", hasChildren: false },
        ],
        truncated: true,
      });

      const res = await postAsAdmin("/admin/ldap/search-groups", {
        ...VALID_CONN,
        searchBase: "DC=corp,DC=local",
        query: "adm",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.truncated).toBe(true);
      expect(body.groups).toHaveLength(1);
      expect(body.groups[0].type).toBe("group");
      expect(searchGroupsMock).toHaveBeenCalledWith("DC=corp,DC=local", "adm");
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });

    it("rejects a missing/invalid searchBase with 400", async () => {
      const res = await postAsAdmin("/admin/ldap/search-groups", {
        ...VALID_CONN,
        searchBase: "not-a-dn",
        query: "adm",
      });
      expect(res.statusCode).toBe(400);
      expect(connectMock).not.toHaveBeenCalled();
    });

    it("rejects an empty query with 400", async () => {
      const res = await postAsAdmin("/admin/ldap/search-groups", {
        ...VALID_CONN,
        searchBase: "DC=corp,DC=local",
        query: "",
      });
      expect(res.statusCode).toBe(400);
    });

    it("rejects an over-long query (>256) with 400", async () => {
      const res = await postAsAdmin("/admin/ldap/search-groups", {
        ...VALID_CONN,
        searchBase: "DC=corp,DC=local",
        query: "a".repeat(257),
      });
      expect(res.statusCode).toBe(400);
    });

    it("genericizes a raw search failure (no topology leak)", async () => {
      searchGroupsMock.mockRejectedValue(new Error("search failed on internal-dc.secret.lan"));

      const res = await postAsAdmin("/admin/ldap/search-groups", {
        ...VALID_CONN,
        searchBase: "DC=corp,DC=local",
        query: "adm",
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("LDAP_CONNECTION_FAILED");
      expect(body.error).not.toContain("internal-dc");
      expect(disconnectMock).toHaveBeenCalledTimes(1);
    });
  });
});
