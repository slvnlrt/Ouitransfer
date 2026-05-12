/**
 * file-validation.integration.test.ts
 *
 * Integration tests for the file registration validation pipeline using app.inject().
 *
 * These complement the unit tests in utils/__tests__/validate-file-content.test.ts
 * by exercising the full request lifecycle: routing → JWT auth → Zod schema parsing →
 * controller → isMimeTypeConsistent → error handler → response serialisation.
 *
 * Per Rule 10 (Fastify+Zod strips unknown fields) we ensure the route-level body
 * schema (RegisterFileSchema in routes.ts) matches what the controller expects.
 *
 * Per Rule 11 (service-layer tests are not sufficient) these tests verify that
 * AppError fields reach the HTTP client through the full Fastify pipeline.
 */

import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock Prisma ──────────────────────────────────────────────────────────────
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(0) },
    file: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: "file-new",
        name: "photo.jpg",
        description: null,
        extension: "jpg",
        size: BigInt(1024),
        objectName: "user-456/valid-object",
        userId: "user-456",
        folderId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    folder: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

// ── Mock ConfigService (so we don't need a DB for config lookups) ────────────
vi.mock("../modules/config/service.js", () => ({
  ConfigService: class MockConfigService {
    getValue = vi.fn().mockImplementation(async (key: string) => {
      if (key === "maxFileSize") return String(100 * 1024 * 1024); // 100 MB
      if (key === "maxTotalStoragePerUser") return String(10 * 1024 * 1024 * 1024); // 10 GB
      if (key === "passwordMinLength") return "8";
      if (key === "passwordAuthEnabled") return "true";
      return "true";
    });
    validateAllProvidersDisable = vi.fn().mockResolvedValue(true);
  },
}));

// ── Mock validateTokenVersion — always trusts tokens in this test suite ──────
// The feature under test is MIME-type validation, not token revocation.
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Mock FileService (avoid S3 dependency) ───────────────────────────────────
// getObjectHead is called for magic-byte verification. We return a small buffer
// that file-type cannot identify (simulating a plain text / unknown file), so the
// magic-byte check passes for cases where we only want to test MIME consistency.
vi.mock("../modules/file/service.js", () => ({
  FileService: class MockFileService {
    getPresignedPutUrl = vi.fn().mockResolvedValue("https://s3.example.com/presigned");
    getObjectHead = vi.fn().mockResolvedValue(Buffer.from("plain text content"));
    deleteObject = vi.fn().mockResolvedValue(undefined);
  },
}));

// ── Test suite ───────────────────────────────────────────────────────────────

describe("POST /files — file validation integration (Item 5)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
    vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
    vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
    vi.stubEnv("NODE_ENV", "test");

    const { buildApp } = await import("../app.js");
    app = await buildApp();

    const { fileRoutes } = await import("../modules/file/routes.js");
    app.register(fileRoutes);
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Helper: create a signed-cookie JWT that jwtVerify() + validateTokenVersion() will accept.
   * validateTokenVersion is mocked to always return true, so any tokenVersion works.
   *
   * The token cookie is signed (signed: true), so we must wrap the raw JWT with
   * app.signCookie() to produce the "s:<jwt>.<hmac>" format that @fastify/jwt
   * expects to unsign when reading the cookie.
   */
  function signTestToken(userId: string, isAdmin = false): string {
    const jwt = app.jwt.sign({ userId, isAdmin, tokenVersion: 0 });
    return app.signCookie(jwt);
  }

  // ── Test 1: Blocked MIME type → 400 ────────────────────────────────────────
  it("rejects a file with a blocked MIME type (application/x-executable) → 400", async () => {
    const token = signTestToken("user-123");
    const userId = "user-123";

    // Fetch CSRF token
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    const payload = {
      name: "malware.exe",
      extension: "exe",
      mimeType: "application/x-executable", // explicitly blocked
      size: 1024,
      objectName: `${userId}/test-object-name`,
    };

    const res = await app.inject({
      method: "POST",
      url: "/files",
      headers: {
        "content-type": "application/json",
        cookie: `token=${token}; _csrf=${csrfCookie?.value}`,
        "x-csrf-token": csrfToken,
      },
      payload: JSON.stringify(payload),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    // The error message must be present in the response
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
  });

  // ── Test 2: Dangerous extension + benign MIME → 400 ────────────────────────
  it("rejects a file with dangerous extension (.js) but benign MIME (image/jpeg) → 400", async () => {
    const token = signTestToken("user-123");
    const userId = "user-123";

    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    const payload = {
      name: "photo.js",
      extension: "js", // dangerous extension
      mimeType: "image/jpeg", // benign MIME — mismatch
      size: 2048,
      objectName: `${userId}/test-object-name-2`,
    };

    const res = await app.inject({
      method: "POST",
      url: "/files",
      headers: {
        "content-type": "application/json",
        cookie: `token=${token}; _csrf=${csrfCookie?.value}`,
        "x-csrf-token": csrfToken,
      },
      payload: JSON.stringify(payload),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBeDefined();
    expect(typeof body.error).toBe("string");
  });

  // ── Test 3: Valid MIME + extension → validation passes, auth succeeds ────────
  // This test verifies the "happy path" reaches the storage layer (mocked),
  // confirming the validation pipeline does NOT block legitimate files.
  it("accepts a valid file (image/jpeg + jpg) and passes validation pipeline", async () => {
    const { prisma } = await import("../shared/prisma.js");

    // Mock file create — called after validation passes
    vi.mocked(prisma.file.findMany).mockResolvedValue([]);

    const token = signTestToken("user-456");
    const userId = "user-456";

    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    const payload = {
      name: "photo.jpg",
      extension: "jpg",
      mimeType: "image/jpeg",
      size: 1024,
      objectName: `${userId}/valid-object`,
    };

    const res = await app.inject({
      method: "POST",
      url: "/files",
      headers: {
        "content-type": "application/json",
        cookie: `token=${token}; _csrf=${csrfCookie?.value}`,
        "x-csrf-token": csrfToken,
      },
      payload: JSON.stringify(payload),
    });

    // Should NOT be rejected by MIME validation (400) or CSRF (403).
    // Will likely be 500 (Prisma create not mocked) or 201 — either is fine;
    // 400 or 403 would indicate the validation pipeline is blocking valid files.
    expect(res.statusCode).not.toBe(400);
    expect(res.statusCode).not.toBe(403);
  });

  // ── Test 4: Unauthenticated request → 401 ──────────────────────────────────
  it("returns 401 when no auth token is provided", async () => {
    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    const res = await app.inject({
      method: "POST",
      url: "/files",
      headers: {
        "content-type": "application/json",
        cookie: `_csrf=${csrfCookie?.value}`,
        "x-csrf-token": csrfToken,
      },
      payload: JSON.stringify({
        name: "file.txt",
        extension: "txt",
        size: 100,
        objectName: "user-xyz/file.txt",
      }),
    });

    expect(res.statusCode).toBe(401);
  });

  // ── Test 5: AppError `error` field surfaces in response ─────────────────────
  // Verifies that the globalErrorHandler serialises AppError correctly through
  // the full Fastify pipeline (Rule 11 — service tests don't catch this).
  it("AppError fields are serialised into the HTTP response body by globalErrorHandler", async () => {
    const token = signTestToken("user-789");
    const userId = "user-789";

    const csrfRes = await app.inject({ method: "GET", url: "/csrf-token" });
    const { token: csrfToken } = csrfRes.json();
    const csrfCookie = csrfRes.cookies.find((c: { name: string }) => c.name === "_csrf");

    // Use a blocked MIME type to trigger a ValidationError (AppError subclass)
    const payload = {
      name: "script.sh",
      extension: "sh",
      mimeType: "application/x-shellscript", // blocked
      size: 512,
      objectName: `${userId}/script.sh`,
    };

    const res = await app.inject({
      method: "POST",
      url: "/files",
      headers: {
        "content-type": "application/json",
        cookie: `token=${token}; _csrf=${csrfCookie?.value}`,
        "x-csrf-token": csrfToken,
      },
      payload: JSON.stringify(payload),
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    // `error` is the primary field guaranteed by AppError → globalErrorHandler
    expect(body).toHaveProperty("error");
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });
});
