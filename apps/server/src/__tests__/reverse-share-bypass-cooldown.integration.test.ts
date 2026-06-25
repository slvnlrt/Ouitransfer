/**
 * Integration test — bypassUploadCooldown round-trips through the
 * reverse-share create endpoint and is surfaced in the response payload.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const TOKEN_VERSION = 0;

const mockUserFindUnique = vi.fn();
const mockReverseShareCreate = vi.fn();

vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique, count: vi.fn().mockResolvedValue(1) },
    reverseShare: { create: mockReverseShareCreate },
  },
}));

vi.mock("../modules/audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

function rowFrom(body: Record<string, unknown>) {
  const now = new Date();
  return {
    id: "rs-1",
    name: (body.name as string) ?? null,
    description: null,
    expiration: null,
    maxFiles: null,
    maxFileSize: null,
    allowedFileTypes: null,
    password: null,
    pageLayout: "DEFAULT",
    backgroundImageId: null,
    isActive: true,
    nameFieldRequired: "OPTIONAL",
    emailFieldRequired: "OPTIONAL",
    notifyOnUpload: (body.notifyOnUpload as boolean) ?? false,
    bypassUploadCooldown: (body.bypassUploadCooldown as boolean) ?? false,
    createdAt: now,
    updatedAt: now,
    creatorId: "user-1",
    files: [],
    alias: null,
  };
}

describe("POST /reverse-shares — bypassUploadCooldown (integration)", () => {
  let app: FastifyInstance;

  async function userHeaders(): Promise<Record<string, string>> {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");
    if (!csrfCookie?.value) throw new Error("Test fixture error: _csrf cookie not found");
    const jwt = app.jwt.sign({ userId: "user-1", isAdmin: false, tokenVersion: TOKEN_VERSION });
    return {
      "content-type": "application/json",
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

    const { reverseShareRoutes } = await import("../modules/reverse-share/routes.js");
    app.register(reverseShareRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockUserFindUnique.mockResolvedValue({ id: "user-1", tokenVersion: TOKEN_VERSION });
    mockReverseShareCreate.mockImplementation(async ({ data }) => rowFrom(data));
  });

  it("persists and returns bypassUploadCooldown=true", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/reverse-shares",
      headers: await userHeaders(),
      payload: { name: "Drop", notifyOnUpload: true, bypassUploadCooldown: true },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().reverseShare.bypassUploadCooldown).toBe(true);
    expect(mockReverseShareCreate.mock.calls[0][0].data).toMatchObject({
      notifyOnUpload: true,
      bypassUploadCooldown: true,
    });
  });

  it("defaults bypassUploadCooldown to false when omitted", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/reverse-shares",
      headers: await userHeaders(),
      payload: { name: "Drop" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().reverseShare.bypassUploadCooldown).toBe(false);
    expect(mockReverseShareCreate.mock.calls[0][0].data.bypassUploadCooldown).toBe(false);
  });
});
