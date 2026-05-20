/**
 * multipart-list-parts.integration.test.ts
 *
 * Integration tests for the GET /files/multipart/list-parts endpoint using app.inject().
 *
 * Tests the full request lifecycle: routing → JWT auth → Zod schema validation →
 * controller → service → storage provider → response serialisation.
 */

import fastifyJwt from "@fastify/jwt";
import type { FastifyInstance } from "fastify";
import { fastify } from "fastify";
import { serializerCompiler, validatorCompiler } from "fastify-type-provider-zod";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Mock env (avoid mandatory JWT_SECRET/CSRF_SECRET/COOKIE_SECRET) ─────────
vi.mock("../env.js", () => ({
  env: {
    PRESIGNED_URL_EXPIRATION: 3600,
    PRESIGNED_GET_URL_EXPIRATION: 900,
    SECURE_SITE: "false",
    PORT: 3333,
  },
}));

// ── Mock storage config ─────────────────────────────────────────────────────
vi.mock("../config/storage.config.js", () => {
  const mockS3Client = {
    send: vi.fn(),
  };
  return {
    s3Client: mockS3Client,
    bucketName: "test-bucket",
    isExternalS3: false,
    isInternalStorage: true,
    rejectUnauthorized: true,
    storageConfig: {},
    createPublicS3Client: vi.fn().mockReturnValue(mockS3Client),
    ensureBucket: vi.fn().mockResolvedValue(undefined),
  };
});

// ── Mock validateTokenVersion — always trusts tokens in this test suite ──────
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  invalidateTokenVersionCache: vi.fn(),
  incrementTokenVersion: vi.fn(),
}));

// ── Mock Prisma ─────────────────────────────────────────────────────────────
vi.mock("../shared/prisma.js", () => ({
  prisma: {
    user: { count: vi.fn().mockResolvedValue(0) },
  },
}));

// ── Mock config service (needed by FileController, imported via routes.ts) ──
vi.mock("../modules/config/service.js", () => ({
  getConfigValue: vi.fn().mockImplementation(async (key: string) => {
    if (key === "maxFileSize") return String(100 * 1024 * 1024);
    if (key === "maxTotalStoragePerUser") return String(10 * 1024 * 1024 * 1024);
    return "true";
  }),
  validatePasswordAuthDisable: vi.fn().mockResolvedValue(true),
  validateAllProvidersDisable: vi.fn().mockResolvedValue(true),
}));

import type { Mock } from "vitest";
import { s3Client } from "../config/storage.config.js";
import { fileRoutes } from "../modules/file/routes.js";
import { globalErrorHandler } from "../utils/error-handler.js";

// Cast the mocked S3 send to a generic mock so we can call mockResolvedValueOnce
// with partial ListParts responses without fighting the overloaded S3Client.send signature.
const mockS3Send = s3Client!.send as unknown as Mock;

describe("GET /files/multipart/list-parts", () => {
  let app: FastifyInstance;
  let authToken: string;

  beforeAll(async () => {
    app = fastify({ logger: false });
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    app.setErrorHandler(globalErrorHandler);

    // Register JWT plugin
    await app.register(fastifyJwt, {
      secret: "test-secret-key-for-jwt-signing-1234567890",
      cookie: { cookieName: "token", signed: true },
      trusted: () => true,
    });

    await app.register(fileRoutes);
    await app.ready();

    // Generate a valid JWT token
    authToken = app.jwt.sign({ userId: "user-123", isAdmin: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns parts array from S3 ListParts", async () => {
    mockS3Send.mockResolvedValueOnce({
      Parts: [
        { PartNumber: 1, Size: 5242880, ETag: '"etag1"' },
        { PartNumber: 2, Size: 5242880, ETag: '"etag2"' },
        { PartNumber: 3, Size: 1234, ETag: '"etag3"' },
      ],
      IsTruncated: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/files/multipart/list-parts",
      query: {
        uploadId: "test-upload-id",
        objectName: "user-123/test-object",
      },
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      parts: Array<{ PartNumber: number; Size: number; ETag: string }>;
    }>();
    expect(body.parts).toHaveLength(3);
    expect(body.parts[0]).toEqual({ PartNumber: 1, Size: 5242880, ETag: '"etag1"' });
    expect(body.parts[1]).toEqual({ PartNumber: 2, Size: 5242880, ETag: '"etag2"' });
    expect(body.parts[2]).toEqual({ PartNumber: 3, Size: 1234, ETag: '"etag3"' });
  });

  it("returns empty array when no parts uploaded yet", async () => {
    mockS3Send.mockResolvedValueOnce({
      Parts: [],
      IsTruncated: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/files/multipart/list-parts",
      query: {
        uploadId: "test-upload-id",
        objectName: "user-123/test-object",
      },
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ parts: unknown[] }>();
    expect(body.parts).toHaveLength(0);
  });

  it("handles S3 pagination (IsTruncated)", async () => {
    // First call: truncated
    mockS3Send.mockResolvedValueOnce({
      Parts: [{ PartNumber: 1, Size: 5242880, ETag: '"etag1"' }],
      IsTruncated: true,
      NextPartNumberMarker: "1",
    });
    // Second call: final page
    mockS3Send.mockResolvedValueOnce({
      Parts: [{ PartNumber: 2, Size: 5242880, ETag: '"etag2"' }],
      IsTruncated: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/files/multipart/list-parts",
      query: {
        uploadId: "test-upload-id",
        objectName: "user-123/test-object",
      },
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      parts: Array<{ PartNumber: number; Size: number; ETag: string }>;
    }>();
    expect(body.parts).toHaveLength(2);
    expect(mockS3Send).toHaveBeenCalledTimes(2);
  });

  it("returns 400 when uploadId is missing", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/files/multipart/list-parts",
      query: {
        objectName: "user-123/test-object",
      },
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 400 when objectName is missing", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/files/multipart/list-parts",
      query: {
        uploadId: "test-upload-id",
      },
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 401 when not authenticated", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/files/multipart/list-parts",
      query: {
        uploadId: "test-upload-id",
        objectName: "user-123/test-object",
      },
    });

    expect(response.statusCode).toBe(401);
  });

  it("filters out parts with null fields from S3 response", async () => {
    mockS3Send.mockResolvedValueOnce({
      Parts: [
        { PartNumber: 1, Size: 5242880, ETag: '"etag1"' },
        { PartNumber: undefined, Size: 5242880, ETag: '"etag2"' }, // invalid
        { PartNumber: 3, Size: undefined, ETag: '"etag3"' }, // invalid
        { PartNumber: 4, Size: 1234, ETag: undefined }, // invalid
        { PartNumber: 5, Size: 999, ETag: '"etag5"' },
      ],
      IsTruncated: false,
    });

    const response = await app.inject({
      method: "GET",
      url: "/files/multipart/list-parts",
      query: {
        uploadId: "test-upload-id",
        objectName: "user-123/test-object",
      },
      headers: {
        authorization: `Bearer ${authToken}`,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      parts: Array<{ PartNumber: number; Size: number; ETag: string }>;
    }>();
    // Only parts 1 and 5 have all required fields
    expect(body.parts).toHaveLength(2);
    expect(body.parts[0].PartNumber).toBe(1);
    expect(body.parts[1].PartNumber).toBe(5);
  });
});
