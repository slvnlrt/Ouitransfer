/**
 * notify-recipients.test.ts
 *
 * Unit tests for ReverseShareService.notifyRecipients().
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Hoisted mocks (must be declared before any imports that trigger module loading) ──

const {
  mockFindById,
  mockEmailServiceSend,
  mockBuildReverseShareUploadLink,
  mockPrismaUserFindUnique,
  mockPrismaRecipientUpdate,
  mockLogAuditEvent,
} = vi.hoisted(() => ({
  mockFindById: vi.fn(),
  mockEmailServiceSend: vi.fn().mockResolvedValue({ enqueued: true }),
  mockBuildReverseShareUploadLink: vi.fn().mockResolvedValue("https://app.example.com/r/my-alias"),
  mockPrismaUserFindUnique: vi.fn(),
  mockPrismaRecipientUpdate: vi.fn().mockResolvedValue({}),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../email/service.js", () => ({
  emailService: { send: (...args: unknown[]) => mockEmailServiceSend(...args) },
}));

vi.mock("../../email/url-builder.js", () => ({
  buildReverseShareUploadLink: (...args: unknown[]) => mockBuildReverseShareUploadLink(...args),
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => mockPrismaUserFindUnique(...args) },
    reverseShareRecipient: { update: (...args: unknown[]) => mockPrismaRecipientUpdate(...args) },
  },
}));

vi.mock("../../audit/service.js", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })),
}));

vi.mock("../../file/service.js", () => ({
  FileService: class {
    deleteObject = vi.fn();
  },
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

// ── Env stubs (required for env.ts validation at import time) ─────────────────
// Must be done in beforeAll so they are in place before the first dynamic import of service.ts.

beforeAll(() => {
  vi.stubEnv("JWT_SECRET", "a]test-jwt-secret-32-chars-long!");
  vi.stubEnv("CSRF_SECRET", "b]test-csrf-secret-32chars-long!");
  vi.stubEnv("COOKIE_SECRET", "c]test-cookie-secret-32chars-lon");
  vi.stubEnv("NODE_ENV", "test");
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRecipient(
  overrides: Partial<{
    id: string;
    email: string;
    name: string | null;
    notifiedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: "recipient-1",
    email: "bob@example.com",
    name: null,
    notifiedAt: null,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    ...overrides,
  };
}

function makeReverseShare(overrides: Record<string, unknown> = {}) {
  return {
    id: "rs-1",
    name: "Upload Request",
    description: null,
    expiration: null,
    maxFiles: null,
    maxFileSize: null,
    allowedFileTypes: null,
    password: null,
    pageLayout: "DEFAULT",
    backgroundImageId: null,
    isActive: true,
    deactivatedAt: null,
    deactivationReason: null,
    nameFieldRequired: "OPTIONAL",
    emailFieldRequired: "OPTIONAL",
    notifyOnUpload: false,
    bypassUploadCooldown: false,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    notifiedForPendingDeletion: false,
    createdAt: new Date("2025-01-01"),
    updatedAt: new Date("2025-01-01"),
    creatorId: "user-1",
    creator: {
      id: "user-1",
      firstName: "Alice",
      lastName: "Smith",
      email: "alice@example.com",
      isActive: true,
    },
    files: [],
    alias: {
      id: "alias-1",
      alias: "my-alias",
      reverseShareId: "rs-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    recipients: [makeRecipient()],
    ...overrides,
  };
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    firstName: "Alice",
    lastName: "Smith",
    username: "alice",
    email: "alice@example.com",
    locale: "en",
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ReverseShareService.notifyRecipients()", () => {
  // ReverseShareService is imported dynamically so that env stubs are in place
  // before env.ts is evaluated (same pattern as lifecycle.test.ts).
  let ReverseShareService: Awaited<typeof import("../service.js")>["ReverseShareService"];

  beforeAll(async () => {
    ({ ReverseShareService } = await import("../service.js"));
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrismaUserFindUnique.mockResolvedValue(makeUser());
    mockPrismaRecipientUpdate.mockResolvedValue({});
    mockEmailServiceSend.mockResolvedValue({ enqueued: true });
    mockBuildReverseShareUploadLink.mockResolvedValue("https://app.example.com/r/my-alias");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls emailService.send('reverse_share_invitation') for each recipient", async () => {
    mockFindById.mockResolvedValue(makeReverseShare());
    const service = new ReverseShareService();

    await service.notifyRecipients("rs-1", "user-1");

    expect(mockEmailServiceSend).toHaveBeenCalledOnce();
    expect(mockEmailServiceSend).toHaveBeenCalledWith(
      "reverse_share_invitation",
      expect.objectContaining({
        to: "bob@example.com",
        locale: "en",
        data: expect.objectContaining({
          senderName: "Alice Smith",
          reverseShareName: "Upload Request",
          reverseShareLink: "https://app.example.com/r/my-alias",
          hasPassword: false,
        }),
      }),
    );
  });

  it("sets notifiedAt on successfully notified recipients", async () => {
    mockFindById.mockResolvedValue(makeReverseShare());
    const service = new ReverseShareService();

    await service.notifyRecipients("rs-1", "user-1");

    expect(mockPrismaRecipientUpdate).toHaveBeenCalledWith({
      where: { id: "recipient-1" },
      data: { notifiedAt: expect.any(Date) },
    });
  });

  it("returns only notified recipient emails", async () => {
    mockFindById.mockResolvedValue(makeReverseShare());
    const service = new ReverseShareService();

    const result = await service.notifyRecipients("rs-1", "user-1");

    expect(result.notifiedRecipients).toEqual(["bob@example.com"]);
  });

  it("with selectedEmails only notifies the selected subset", async () => {
    const rs = makeReverseShare({
      recipients: [
        makeRecipient({ id: "r-1", email: "bob@example.com" }),
        makeRecipient({ id: "r-2", email: "carol@example.com" }),
      ],
    });
    mockFindById.mockResolvedValue(rs);
    const service = new ReverseShareService();

    const result = await service.notifyRecipients("rs-1", "user-1", ["carol@example.com"]);

    expect(mockEmailServiceSend).toHaveBeenCalledOnce();
    expect(mockEmailServiceSend).toHaveBeenCalledWith(
      "reverse_share_invitation",
      expect.objectContaining({ to: "carol@example.com" }),
    );
    expect(result.notifiedRecipients).toEqual(["carol@example.com"]);
  });

  it("throws when reverse share not found", async () => {
    mockFindById.mockResolvedValue(null);
    const service = new ReverseShareService();

    await expect(service.notifyRecipients("rs-1", "user-1")).rejects.toThrow(
      "Reverse share not found",
    );
  });

  it("throws when user is not the creator", async () => {
    mockFindById.mockResolvedValue(makeReverseShare({ creatorId: "other-user" }));
    const service = new ReverseShareService();

    await expect(service.notifyRecipients("rs-1", "user-1")).rejects.toThrow("Unauthorized");
  });

  it("throws when no recipients exist", async () => {
    mockFindById.mockResolvedValue(makeReverseShare({ recipients: [] }));
    const service = new ReverseShareService();

    await expect(service.notifyRecipients("rs-1", "user-1")).rejects.toThrow("No recipients");
  });

  it("throws when selectedEmails is an empty array", async () => {
    mockFindById.mockResolvedValue(makeReverseShare());
    const service = new ReverseShareService();

    await expect(service.notifyRecipients("rs-1", "user-1", [])).rejects.toThrow(
      "selectedEmails must not be empty",
    );
  });

  it("throws when no alias is set", async () => {
    mockFindById.mockResolvedValue(makeReverseShare({ alias: null }));
    const service = new ReverseShareService();

    await expect(service.notifyRecipients("rs-1", "user-1")).rejects.toThrow("alias");
  });

  it("includes hasPassword: true when reverse share has a password", async () => {
    mockFindById.mockResolvedValue(makeReverseShare({ password: "$2b$10$hashedpassword" }));
    const service = new ReverseShareService();

    await service.notifyRecipients("rs-1", "user-1");

    expect(mockEmailServiceSend).toHaveBeenCalledWith(
      "reverse_share_invitation",
      expect.objectContaining({
        data: expect.objectContaining({ hasPassword: true }),
      }),
    );
  });

  it("includes expiresAt when reverse share has expiration", async () => {
    const expiration = new Date("2025-12-31T23:59:59Z");
    mockFindById.mockResolvedValue(makeReverseShare({ expiration }));
    const service = new ReverseShareService();

    await service.notifyRecipients("rs-1", "user-1");

    expect(mockEmailServiceSend).toHaveBeenCalledWith(
      "reverse_share_invitation",
      expect.objectContaining({
        data: expect.objectContaining({ expiresAt: expiration.toISOString() }),
      }),
    );
  });

  it("continues notifying remaining recipients when one email send fails", async () => {
    const rs = makeReverseShare({
      recipients: [
        makeRecipient({ id: "r-1", email: "fail@example.com" }),
        makeRecipient({ id: "r-2", email: "success@example.com" }),
      ],
    });
    mockFindById.mockResolvedValue(rs);
    mockEmailServiceSend
      .mockRejectedValueOnce(new Error("SMTP error"))
      .mockResolvedValueOnce({ enqueued: true });
    const service = new ReverseShareService();

    const result = await service.notifyRecipients("rs-1", "user-1");

    expect(result.notifiedRecipients).toEqual(["success@example.com"]);
    expect(mockPrismaRecipientUpdate).toHaveBeenCalledOnce();
  });
});
