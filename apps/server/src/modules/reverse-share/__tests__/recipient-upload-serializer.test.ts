/**
 * recipient-upload-serializer.test.ts
 *
 * Unit tests for 8.3 lot D — the reverse-share recipient serializer must expose
 * the per-recipient upload-tracking fields (`uploadCount`, `uploadedAt`) in the
 * response body. The serializer runs through `ReverseShareResponseSchema.parse`,
 * so this also pins the DTO/serializer in sync (a missing field would fail the
 * Zod parse).
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindById } = vi.hoisted(() => ({
  mockFindById: vi.fn(),
}));

vi.mock("../repository.js", () => ({
  ReverseShareRepository: class {
    findById = mockFindById;
    create = vi.fn();
    update = vi.fn();
    delete = vi.fn();
    findByAlias = vi.fn();
    findByCreatorId = vi.fn();
    addRecipients = vi.fn();
    removeRecipients = vi.fn();
    createFile = vi.fn();
    trackRecipientUpload = vi.fn();
    findFileById = vi.fn();
    deleteFile = vi.fn();
    getFilesByReverseShareId = vi.fn();
    countFilesByReverseShareId = vi.fn();
    updateFile = vi.fn();
    hashPassword = vi.fn();
    comparePassword = vi.fn();
    markExpiredInactive = vi.fn();
  },
}));

vi.mock("../../file/service.js", () => ({
  FileService: class {
    deleteObject = vi.fn();
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
  vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
  vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
  vi.stubEnv("NODE_ENV", "test");
});

function makeReverseShare(recipients: unknown[]) {
  return {
    id: "rs-1",
    name: "Inbox",
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
    notifyOnUpload: false,
    bypassUploadCooldown: false,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    creatorId: "creator-1",
    files: [],
    alias: null,
    recipients,
  };
}

describe("reverse-share recipient serializer — upload tracking fields", () => {
  // biome-ignore lint/suspicious/noExplicitAny: dynamically imported service under test
  let service: any;

  beforeAll(async () => {
    const { ReverseShareService } = await import("../service.js");
    service = new ReverseShareService();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serializes uploadCount and uploadedAt (ISO string) for a recipient that uploaded", async () => {
    mockFindById.mockResolvedValue(
      makeReverseShare([
        {
          id: "rec-1",
          email: "alice@example.com",
          name: "Alice",
          notifiedAt: new Date("2024-01-02"),
          uploadCount: 3,
          uploadedAt: new Date("2024-06-01T10:00:00.000Z"),
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ]),
    );

    const result = await service.getReverseShareById("rs-1", "creator-1");
    const recipient = result.recipients[0];

    expect(recipient).toHaveProperty("uploadCount", 3);
    expect(recipient).toHaveProperty("uploadedAt", "2024-06-01T10:00:00.000Z");
  });

  it("serializes uploadCount 0 / uploadedAt null for a recipient that never uploaded", async () => {
    mockFindById.mockResolvedValue(
      makeReverseShare([
        {
          id: "rec-2",
          email: "bob@example.com",
          name: null,
          notifiedAt: null,
          uploadCount: 0,
          uploadedAt: null,
          createdAt: new Date("2024-01-01"),
          updatedAt: new Date("2024-01-01"),
        },
      ]),
    );

    const result = await service.getReverseShareById("rs-1", "creator-1");
    const recipient = result.recipients[0];

    expect(recipient).toHaveProperty("uploadCount", 0);
    expect(recipient).toHaveProperty("uploadedAt", null);
  });
});
