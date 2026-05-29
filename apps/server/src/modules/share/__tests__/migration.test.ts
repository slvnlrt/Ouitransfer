/**
 * migration.test.ts
 *
 * Unit tests verifying that:
 * - ShareService.notifyRecipients() delegates to emailService.send() (not direct SMTP)
 * - Selective notification (selectedEmails filter) works
 * - notifiedAt is set on each notified recipient
 * - Missing tracking tokens are generated before sending
 * - ShareService.updateShare() preserves existing recipient tracking tokens (upsert)
 * - ShareService.updateShare() removes deleted and adds new recipients
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock state ────────────────────────────────────────────────────────

const { mockEmailServiceSend, mockPrisma, mockLogger, mockGetAppUrl } = vi.hoisted(() => ({
  mockEmailServiceSend: vi.fn().mockResolvedValue(undefined),
  mockGetAppUrl: vi.fn().mockResolvedValue("https://app.example.com"),
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
    },
    shareRecipient: {
      update: vi.fn(),
      updateMany: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
    share: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("../../email/service.js", () => ({
  emailService: {
    send: mockEmailServiceSend,
  },
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// Mock the share repository
const mockShareRepository = {
  findShareById: vi.fn(),
  updateShare: vi.fn(),
  updateShareSecurity: vi.fn(),
  createShare: vi.fn(),
  findSharesByUserId: vi.fn(),
  findShareByAlias: vi.fn(),
  findShareBySecurityId: vi.fn(),
  incrementViewsAtomic: vi.fn(),
  addFilesToShare: vi.fn(),
  removeFilesFromShare: vi.fn(),
  addFoldersToShare: vi.fn(),
  removeFoldersFromShare: vi.fn(),
  findFilesByIds: vi.fn(),
  findFoldersByIds: vi.fn(),
  addRecipients: vi.fn(),
  removeRecipients: vi.fn(),
};

vi.mock("../repository.js", () => ({
  PrismaShareRepository: vi.fn().mockImplementation(() => mockShareRepository),
}));

vi.mock("../user/service.js", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
  UserService: vi.fn().mockImplementation(function (this: any) {
    this.getUserById = vi.fn();
  }),
}));

vi.mock("../folder/service.js", () => ({
  // biome-ignore lint/suspicious/noExplicitAny: vi mock constructor
  FolderService: vi.fn().mockImplementation(function (this: any) {
    this.calculateFolderSize = vi.fn().mockResolvedValue(BigInt(0));
  }),
}));

vi.mock("../audit/service.js", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../email/url-builder.js", () => ({
  getAppUrl: mockGetAppUrl,
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("hashed-password"),
    compare: vi.fn().mockResolvedValue(false),
  },
}));

// Mock env to avoid ZodError at module load time (share/service.ts transitively imports env.ts)
vi.mock("../../../env.js", () => ({
  env: {
    JWT_SECRET: "test-secret-key-that-is-at-least-32-characters-long",
    CSRF_SECRET: "test-csrf-secret-32-characters-long!",
    COOKIE_SECRET: "test-cookie-secret-32-chars-long!",
    NODE_ENV: "test",
    SECURE_SITE: "false",
  },
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────────

import { ShareService } from "../service.js";

// ─── Helpers ────────────────────────────────────────────────────────────────────

function makeRecipient(overrides: Record<string, unknown> = {}) {
  return {
    id: "recipient-1",
    shareId: "share-1",
    email: "alice@example.com",
    name: null,
    trackingToken: "existing-token-abc",
    notifiedAt: null,
    lastAccessedAt: null,
    accessCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeShare(overrides: Record<string, unknown> = {}) {
  return {
    id: "share-1",
    name: "Test Share",
    description: null,
    expiration: null,
    views: 0,
    maxViews: null,
    creatorId: "user-1",
    securityId: "sec-1",
    notifyOnDownload: false,
    nameFieldRequired: "HIDDEN",
    emailFieldRequired: "HIDDEN",
    inactivityAlertDays: null,
    inactivityAlertSent: false,
    lastDownloadedAt: null,
    notifiedForExpiring: false,
    notifiedForExpired: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    files: [],
    folders: [],
    recipients: [makeRecipient()],
    alias: {
      id: "alias-1",
      alias: "share-1",
      shareId: "share-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    security: {
      id: "sec-1",
      password: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    creator: { email: "creator@example.com", locale: "en" },
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Email migration — ShareService.notifyRecipients()", () => {
  let shareService: ShareService;

  beforeEach(() => {
    vi.clearAllMocks();
    shareService = new ShareService(mockShareRepository as never);
    mockPrisma.user.findUnique.mockResolvedValue(makeUser());
    mockPrisma.shareRecipient.update.mockResolvedValue({});
    // updateMany used for race-safe token backfill: returns { count: 1 } by default
    mockPrisma.shareRecipient.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls emailService.send() instead of direct SMTP for each recipient", async () => {
    mockShareRepository.findShareById.mockResolvedValue(makeShare());

    await shareService.notifyRecipients("share-1", "user-1");

    expect(mockEmailServiceSend).toHaveBeenCalledOnce();
    expect(mockEmailServiceSend).toHaveBeenCalledWith(
      "share_invitation",
      expect.objectContaining({
        to: "alice@example.com",
        locale: "en",
        data: expect.objectContaining({
          senderName: "Alice Smith",
          shareName: "Test Share",
          hasPassword: false,
        }),
      }),
    );
  });

  it("includes personalized link with tracking token in share invitation", async () => {
    const recipient = makeRecipient({ trackingToken: "my-token-123" });
    mockShareRepository.findShareById.mockResolvedValue(makeShare({ recipients: [recipient] }));

    await shareService.notifyRecipients("share-1", "user-1");

    expect(mockEmailServiceSend).toHaveBeenCalledWith(
      "share_invitation",
      expect.objectContaining({
        data: expect.objectContaining({
          shareLink: "https://app.example.com/s/share-1?t=my-token-123",
        }),
      }),
    );
  });

  it("generates a tracking token for recipients without one", async () => {
    const recipient = makeRecipient({ trackingToken: null });
    mockShareRepository.findShareById.mockResolvedValue(makeShare({ recipients: [recipient] }));

    await shareService.notifyRecipients("share-1", "user-1");

    // Should use conditional updateMany (race-safe backfill): only writes when token is still null
    expect(mockPrisma.shareRecipient.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "recipient-1", trackingToken: null },
        data: expect.objectContaining({
          trackingToken: expect.any(String),
        }),
      }),
    );

    // The send call should include the newly generated token
    expect(mockEmailServiceSend).toHaveBeenCalledWith(
      "share_invitation",
      expect.objectContaining({
        data: expect.objectContaining({
          shareLink: expect.stringContaining("?t="),
        }),
      }),
    );
  });

  it("sets notifiedAt on each successfully notified recipient", async () => {
    mockShareRepository.findShareById.mockResolvedValue(makeShare());

    await shareService.notifyRecipients("share-1", "user-1");

    // The second shareRecipient.update call should set notifiedAt
    const calls = mockPrisma.shareRecipient.update.mock.calls;
    const notifiedAtCall = calls.find(
      (c: unknown[]) =>
        (c[0] as { data?: { notifiedAt?: unknown } }).data?.notifiedAt !== undefined,
    );
    expect(notifiedAtCall).toBeDefined();
    expect(
      (notifiedAtCall as [{ data: { notifiedAt: unknown } }])[0].data.notifiedAt,
    ).toBeInstanceOf(Date);
  });

  it("returns only notified recipient emails", async () => {
    mockShareRepository.findShareById.mockResolvedValue(makeShare());

    const result = await shareService.notifyRecipients("share-1", "user-1");

    expect(result.notifiedRecipients).toEqual(["alice@example.com"]);
  });

  it("with selectedEmails only notifies selected recipients", async () => {
    const share = makeShare({
      recipients: [
        makeRecipient({ id: "r-1", email: "alice@example.com", trackingToken: "tok-a" }),
        makeRecipient({ id: "r-2", email: "bob@example.com", trackingToken: "tok-b" }),
        makeRecipient({ id: "r-3", email: "carol@example.com", trackingToken: "tok-c" }),
      ],
    });
    mockShareRepository.findShareById.mockResolvedValue(share);

    const result = await shareService.notifyRecipients("share-1", "user-1", [
      "alice@example.com",
      "carol@example.com",
    ]);

    // Only 2 recipients notified
    expect(mockEmailServiceSend).toHaveBeenCalledTimes(2);
    expect(result.notifiedRecipients).toHaveLength(2);
    expect(result.notifiedRecipients).toContain("alice@example.com");
    expect(result.notifiedRecipients).toContain("carol@example.com");
    expect(result.notifiedRecipients).not.toContain("bob@example.com");
  });

  it("with omitted selectedEmails notifies all recipients", async () => {
    const share = makeShare({
      recipients: [
        makeRecipient({ id: "r-1", email: "alice@example.com", trackingToken: "tok-a" }),
        makeRecipient({ id: "r-2", email: "bob@example.com", trackingToken: "tok-b" }),
      ],
    });
    mockShareRepository.findShareById.mockResolvedValue(share);

    const result = await shareService.notifyRecipients("share-1", "user-1");

    expect(mockEmailServiceSend).toHaveBeenCalledTimes(2);
    expect(result.notifiedRecipients).toHaveLength(2);
  });

  it("rejects notification for shares without an alias", async () => {
    const share = makeShare({ alias: null });
    mockShareRepository.findShareById.mockResolvedValue(share);

    await expect(shareService.notifyRecipients("share-1", "user-1")).rejects.toThrow(
      "Share must have an alias before sending notifications",
    );

    expect(mockEmailServiceSend).not.toHaveBeenCalled();
  });

  it("rejects notification when alias object exists but alias field is null", async () => {
    const share = makeShare({
      alias: {
        id: "alias-1",
        alias: null,
        shareId: "share-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    mockShareRepository.findShareById.mockResolvedValue(share);

    await expect(shareService.notifyRecipients("share-1", "user-1")).rejects.toThrow(
      "Share must have an alias before sending notifications",
    );

    expect(mockEmailServiceSend).not.toHaveBeenCalled();
  });

  it("uses username as senderName when no firstName set", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(makeUser({ firstName: null, lastName: null }));
    mockShareRepository.findShareById.mockResolvedValue(makeShare());

    await shareService.notifyRecipients("share-1", "user-1");

    expect(mockEmailServiceSend).toHaveBeenCalledWith(
      "share_invitation",
      expect.objectContaining({
        data: expect.objectContaining({
          senderName: "alice",
        }),
      }),
    );
  });

  it("continues to next recipient if emailService.send() throws", async () => {
    const share = makeShare({
      recipients: [
        makeRecipient({ id: "r-1", email: "alice@example.com", trackingToken: "tok-a" }),
        makeRecipient({ id: "r-2", email: "bob@example.com", trackingToken: "tok-b" }),
      ],
    });
    mockShareRepository.findShareById.mockResolvedValue(share);

    // First send fails, second succeeds
    mockEmailServiceSend
      .mockRejectedValueOnce(new Error("Queue error"))
      .mockResolvedValueOnce(undefined);

    const result = await shareService.notifyRecipients("share-1", "user-1");

    // Only bob was successfully notified
    expect(result.notifiedRecipients).toEqual(["bob@example.com"]);
    expect(mockLogger.error).toHaveBeenCalled();
  });
});

describe("Email migration — ShareService.updateShare() recipient upsert", () => {
  let shareService: ShareService;

  beforeEach(() => {
    vi.clearAllMocks();
    shareService = new ShareService(mockShareRepository as never);

    // Default: $transaction executes the callback
    mockPrisma.$transaction.mockImplementation(
      async (fn: (tx: typeof mockPrisma) => Promise<void>) => {
        await fn(mockPrisma);
      },
    );

    mockPrisma.shareRecipient.findMany.mockResolvedValue([]);
    mockPrisma.shareRecipient.deleteMany.mockResolvedValue({ count: 0 });
    mockPrisma.shareRecipient.create.mockResolvedValue({});
    mockShareRepository.updateShare.mockResolvedValue({});
    mockShareRepository.findShareById.mockResolvedValue(makeShare({ recipients: [] }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("preserves tracking token for existing recipient when updating share", async () => {
    const existingRecipient = {
      id: "r-existing",
      shareId: "share-1",
      email: "alice@example.com",
      trackingToken: "preserved-token-xyz",
      notifiedAt: new Date("2025-01-01"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const share = makeShare({ recipients: [existingRecipient] });
    mockShareRepository.findShareById.mockResolvedValue(share);
    mockPrisma.shareRecipient.findMany.mockResolvedValue([existingRecipient]);

    // Update the share keeping alice and adding bob
    await shareService.updateShare(
      "share-1",
      { recipients: ["alice@example.com", "bob@example.com"] },
      "user-1",
    );

    // Alice (existing) should NOT be in deleteMany
    const deleteCalls = mockPrisma.shareRecipient.deleteMany.mock.calls;
    for (const call of deleteCalls) {
      const ids = (call as [{ where: { id: { in: string[] } } }])[0].where?.id?.in ?? [];
      expect(ids).not.toContain("r-existing");
    }

    // Bob (new) should be in create with a fresh tracking token
    expect(mockPrisma.shareRecipient.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: "bob@example.com",
          trackingToken: expect.any(String),
        }),
      }),
    );
  });

  it("removes recipients no longer in the list", async () => {
    const alice = {
      id: "r-alice",
      shareId: "share-1",
      email: "alice@example.com",
      trackingToken: "tok-alice",
      notifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const bob = {
      id: "r-bob",
      shareId: "share-1",
      email: "bob@example.com",
      trackingToken: "tok-bob",
      notifiedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const share = makeShare({ recipients: [alice, bob] });
    mockShareRepository.findShareById.mockResolvedValue(share);
    mockPrisma.shareRecipient.findMany.mockResolvedValue([alice, bob]);

    // Update: keep only alice (remove bob)
    await shareService.updateShare("share-1", { recipients: ["alice@example.com"] }, "user-1");

    // Bob should be removed
    expect(mockPrisma.shareRecipient.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          shareId: "share-1",
          id: { in: ["r-bob"] },
        }),
      }),
    );

    // Alice should NOT be in create (already exists)
    const createCalls = mockPrisma.shareRecipient.create.mock.calls;
    const aliceCreated = createCalls.some(
      (c: unknown[]) => (c[0] as { data?: { email?: string } }).data?.email === "alice@example.com",
    );
    expect(aliceCreated).toBe(false);
  });

  it("adds new recipients with unique tracking tokens", async () => {
    const share = makeShare({ recipients: [] });
    mockShareRepository.findShareById.mockResolvedValue(share);
    mockPrisma.shareRecipient.findMany.mockResolvedValue([]);

    await shareService.updateShare(
      "share-1",
      { recipients: ["new1@example.com", "new2@example.com"] },
      "user-1",
    );

    const createCalls = mockPrisma.shareRecipient.create.mock.calls as [
      { data: { email: string; trackingToken: string } },
    ][];
    expect(createCalls).toHaveLength(2);

    const tokens = createCalls.map((c) => c[0].data.trackingToken);
    // Tokens should be unique
    expect(new Set(tokens).size).toBe(2);
    // Each token should be a non-empty string
    for (const token of tokens) {
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    }
  });

  it("does nothing when recipients is undefined", async () => {
    const share = makeShare({ recipients: [] });
    mockShareRepository.findShareById.mockResolvedValue(share);

    await shareService.updateShare("share-1", { name: "Updated Name" }, "user-1");

    // No recipient transaction operations
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.shareRecipient.findMany).not.toHaveBeenCalled();
  });
});
