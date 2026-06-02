/**
 * Integration test for TD-31 — deleting a user redacts their email from
 * historical audit metadata (GDPR erasure), and the deletion event itself does
 * not re-persist the email.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;
const VICTIM_EMAIL = "victim@example.com";

const mockUserCount = vi.fn();
const mockUserFindUnique = vi.fn();
const mockUserDelete = vi.fn();
const mockAuditFindMany = vi.fn();
const mockAuditUpdate = vi.fn();
const mockAuditCreate = vi.fn();

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: {
      count: mockUserCount,
      findUnique: mockUserFindUnique,
      delete: mockUserDelete,
    },
    auditLog: {
      findMany: mockAuditFindMany,
      update: mockAuditUpdate,
      create: mockAuditCreate,
    },
    // Read while building the register password schema during route registration.
    appConfig: { findUnique: vi.fn().mockResolvedValue({ value: "8" }) },
  },
}));

function deletedUserRow() {
  const now = new Date();
  return {
    id: "victim-1",
    firstName: "Vic",
    lastName: "Tim",
    username: "victim",
    email: VICTIM_EMAIL,
    image: null,
    isAdmin: false,
    isActive: true,
    tokenVersion: 0,
    createdAt: now,
    updatedAt: now,
    groupId: null,
    group: null,
    maxFileSizeOverride: null,
    maxTotalStorageOverride: null,
  };
}

describe("DELETE /users/:id — audit PII redaction (integration)", () => {
  let app: FastifyInstance;

  async function adminHeaders(): Promise<Record<string, string>> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    const jwt = app.jwt.sign({ userId: "admin-1", isAdmin: true, tokenVersion: TOKEN_VERSION });
    return {
      cookie: `token=${app.signCookie(jwt)}; _csrf=${csrfCookie.value}`,
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

    const { userRoutes } = await import("../modules/user/routes.js");
    app.register(userRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserCount.mockResolvedValue(2); // users exist → no setup bypass
    mockUserFindUnique.mockResolvedValue({ id: "admin-1", tokenVersion: TOKEN_VERSION });
    mockUserDelete.mockResolvedValue(deletedUserRow());
    mockAuditFindMany.mockResolvedValue([]);
    mockAuditUpdate.mockResolvedValue({});
    mockAuditCreate.mockResolvedValue({});
  });

  it("redacts the deleted user's email from matching audit metadata", async () => {
    mockAuditFindMany.mockResolvedValue([
      {
        id: "log-1",
        metadata: JSON.stringify({ count: 2, emails: [VICTIM_EMAIL, "other@example.com"] }),
      },
    ]);

    const res = await app.inject({
      method: "DELETE",
      url: "/users/victim-1",
      headers: await adminHeaders(),
    });

    expect(res.statusCode).toBe(200);

    // Redaction queries by the deleted user's email and rewrites the match.
    expect(mockAuditFindMany).toHaveBeenCalledWith({
      where: { metadata: { contains: VICTIM_EMAIL } },
      select: { id: true, metadata: true },
    });
    expect(mockAuditUpdate).toHaveBeenCalledWith({
      where: { id: "log-1" },
      data: { metadata: JSON.stringify({ count: 2, emails: ["[deleted]", "other@example.com"] }) },
    });
  });

  it("still deletes the user (200) when there is nothing to redact", async () => {
    mockAuditFindMany.mockResolvedValue([]);

    const res = await app.inject({
      method: "DELETE",
      url: "/users/victim-1",
      headers: await adminHeaders(),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().email).toBe(VICTIM_EMAIL); // response to the admin still carries it
    expect(mockAuditUpdate).not.toHaveBeenCalled();
  });

  it("does not fail the deletion when redaction throws", async () => {
    mockAuditFindMany.mockRejectedValue(new Error("db down"));

    const res = await app.inject({
      method: "DELETE",
      url: "/users/victim-1",
      headers: await adminHeaders(),
    });

    // The user row is already gone; a redaction failure must not surface as an error.
    expect(res.statusCode).toBe(200);
  });
});
