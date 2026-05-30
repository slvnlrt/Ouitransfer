import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock state ──────────────────────────────────────────────────────

const {
  mockGetConfigValue,
  mockPrisma,
  mockLogger,
  mockRenderLayout,
  mockT,
  mockCreateTranslationFn,
  mockGetAppUrl,
  mockBuildUnsubscribeUrl,
  mockEmailQueueEvents,
} = vi.hoisted(() => ({
  mockGetConfigValue: vi.fn(),
  mockPrisma: {
    emailJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
    },
    notificationPreference: {
      findUnique: vi.fn(),
    },
    share: {
      findUnique: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
  },
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mockRenderLayout: vi.fn(),
  mockT: vi.fn(),
  mockCreateTranslationFn: vi.fn(),
  mockGetAppUrl: vi.fn(),
  mockBuildUnsubscribeUrl: vi.fn(),
  mockEmailQueueEvents: {
    emit: vi.fn(),
  },
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("../../config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

vi.mock("../templates/base-layout.js", () => ({
  renderLayout: mockRenderLayout,
}));

vi.mock("../i18n/loader.js", () => ({
  t: mockT,
  createTranslationFn: mockCreateTranslationFn,
}));

vi.mock("../url-builder.js", () => ({
  getAppUrl: mockGetAppUrl,
  buildUnsubscribeUrl: mockBuildUnsubscribeUrl,
}));

vi.mock("../events.js", () => ({
  emailQueueEvents: mockEmailQueueEvents,
}));

// Mock env module
vi.mock("../../../env.js", () => ({
  env: {
    JWT_SECRET: "test-secret-key-that-is-at-least-32-characters-long",
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { emailService } from "../service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupDefaultMocks() {
  // SMTP enabled
  mockGetConfigValue.mockImplementation(async (key: string) => {
    switch (key) {
      case "smtpEnabled":
        return "true";
      case "appName":
        return "TestApp";
      case "emailQueueMaxRetries":
        return "3";
      default:
        throw new Error(`Unknown config key: ${key}`);
    }
  });

  // appUrl configured
  mockGetAppUrl.mockResolvedValue("https://test.example.com");

  // Render layout returns default output
  mockRenderLayout.mockReturnValue({
    html: "<html>test</html>",
    text: "test email",
  });

  // i18n t() is now async — return a rejected promise for missing keys
  mockT.mockImplementation((_locale: string, key: string) => {
    return Promise.reject(new Error(`Missing i18n key: ${key}`));
  });

  // createTranslationFn returns a dummy (now async — returns a Promise<TranslationFn>)
  mockCreateTranslationFn.mockResolvedValue((_key: string) => "translated");

  // buildUnsubscribeUrl returns a URL
  mockBuildUnsubscribeUrl.mockResolvedValue(
    "https://test.example.com/api/notifications/unsubscribe?token=abc",
  );

  // No existing preferences
  mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);

  // No recent jobs (cooldown)
  mockPrisma.emailJob.findFirst.mockResolvedValue(null);

  // EmailJob create succeeds
  mockPrisma.emailJob.create.mockResolvedValue({ id: "job-1" });
}

function resetAllMocks() {
  mockGetConfigValue.mockReset();
  mockPrisma.emailJob.create.mockReset();
  mockPrisma.emailJob.findFirst.mockReset();
  mockPrisma.notificationPreference.findUnique.mockReset();
  mockPrisma.share.findUnique.mockReset();
  mockPrisma.user.findMany.mockReset();
  mockLogger.info.mockReset();
  mockLogger.warn.mockReset();
  mockLogger.error.mockReset();
  mockLogger.debug.mockReset();
  mockRenderLayout.mockReset();
  mockT.mockReset();
  mockCreateTranslationFn.mockReset();
  mockGetAppUrl.mockReset();
  mockBuildUnsubscribeUrl.mockReset();
  mockEmailQueueEvents.emit.mockReset();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EmailService", () => {
  beforeEach(() => {
    resetAllMocks();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── send() — basic flow ────────────────────────────────────────────────────

  describe("send()", () => {
    it("creates EmailJob with priority 1 for critical types", async () => {
      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
      const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
      expect(createArg.data.type).toBe("welcome");
      expect(createArg.data.to).toBe("user@test.com");
      expect(createArg.data.priority).toBe(1);
      expect(createArg.data.status).toBe("pending");
      expect(createArg.data.htmlBody).toBe("<html>test</html>");
      expect(createArg.data.textBody).toBe("test email");
    });

    it("when SMTP disabled → no job created", async () => {
      mockGetConfigValue.mockImplementation(async (key: string) => {
        if (key === "smtpEnabled") return "false";
        return "value";
      });

      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      expect(mockPrisma.emailJob.create).not.toHaveBeenCalled();
    });

    it("when SMTP config key missing → no job created", async () => {
      mockGetConfigValue.mockRejectedValue(new Error("Configuration smtpEnabled not found"));

      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      expect(mockPrisma.emailJob.create).not.toHaveBeenCalled();
    });

    it("when appUrl not configured → no job created", async () => {
      mockGetAppUrl.mockRejectedValue(new Error("appUrl not configured"));

      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      expect(mockPrisma.emailJob.create).not.toHaveBeenCalled();
    });

    it("for critical types ignores user preferences", async () => {
      // Even if preference says disabled, critical types should still send
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "password_reset",
        frequency: "disabled",
      });

      await emailService.send("password_reset", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        data: { resetUrl: "https://reset.example.com", expiresInMinutes: 60 },
      });

      // Should NOT check preferences for critical types
      expect(mockPrisma.notificationPreference.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
    });

    it("for non-critical checks preference; disabled → no job", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "share_expiring",
        frequency: "disabled",
      });

      await emailService.send("share_expiring", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        data: {
          shareName: "My Share",
          expiresAt: "2025-12-31",
          shareManageUrl: "https://test.example.com/shares/1",
        },
      });

      expect(mockPrisma.emailJob.create).not.toHaveBeenCalled();
    });

    it("with notifyOnDownload=true upgrades to immediate", async () => {
      // User preference is daily_digest
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "share_downloaded",
        frequency: "daily_digest",
      });

      // Share has notifyOnDownload=true
      mockPrisma.share.findUnique.mockResolvedValue({ notifyOnDownload: true });

      await emailService.send("share_downloaded", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        shareId: "share-1",
        data: {
          shareName: "My Share",
          fileName: "file.txt",
          downloadedAt: "2025-01-01T00:00:00Z",
        },
      });

      expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
      const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
      // Should be pending (immediate), not digest_pending
      expect(createArg.data.status).toBe("pending");
    });

    it("calls template render + renderLayout with locale and translation fn", async () => {
      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "fr",
        data: { firstName: "Jean", loginUrl: "https://test.example.com" },
      });

      expect(mockCreateTranslationFn).toHaveBeenCalledWith("fr", { appName: "TestApp" });
      expect(mockRenderLayout).toHaveBeenCalledOnce();
      const layoutCall = mockRenderLayout.mock.calls[0];
      // First arg is slots, second is config (with locale), third is translation fn
      expect(layoutCall[1]).toEqual({ appName: "TestApp", locale: "fr" });
      expect(typeof layoutCall[2]).toBe("function"); // translation fn
    });

    it("adds unsubscribe URL for hasUnsubscribe=true + userId", async () => {
      await emailService.send("share_expiring", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        data: {
          shareName: "My Share",
          expiresAt: "2025-12-31",
          shareManageUrl: "https://test.example.com/shares/1",
        },
      });

      expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
      const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
      // share_expiring has hasUnsubscribe=true, so listUnsubscribe should be set
      expect(createArg.data.listUnsubscribe).toContain("<");
      expect(createArg.data.listUnsubscribe).toContain(">");
    });

    it("does not add unsubscribe URL for hasUnsubscribe=false", async () => {
      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
      expect(createArg.data.listUnsubscribe).toBeUndefined();
    });

    it("does not add unsubscribe URL when no userId", async () => {
      await emailService.send("share_expiring", {
        to: "anonymous@test.com",
        locale: "en",
        // no userId
        data: {
          shareName: "My Share",
          expiresAt: "2025-12-31",
          shareManageUrl: "https://test.example.com/shares/1",
        },
      });

      const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
      expect(createArg.data.listUnsubscribe).toBeUndefined();
    });

    it("emits 'wake' event for priority 1 jobs", async () => {
      await emailService.send("password_reset", {
        to: "user@test.com",
        locale: "en",
        data: { resetUrl: "https://reset.example.com", expiresInMinutes: 60 },
      });

      expect(mockEmailQueueEvents.emit).toHaveBeenCalledWith("wake");
    });

    it("does not emit 'wake' event for priority 0 jobs", async () => {
      await emailService.send("share_expiring", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        data: {
          shareName: "My Share",
          expiresAt: "2025-12-31",
          shareManageUrl: "https://test.example.com/shares/1",
        },
      });

      expect(mockEmailQueueEvents.emit).not.toHaveBeenCalled();
    });

    it("on render failure creates FAILED job with error message", async () => {
      mockRenderLayout.mockImplementation(() => {
        throw new Error("Template syntax error");
      });

      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
      const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
      expect(createArg.data.status).toBe("failed");
      expect(createArg.data.lastError).toContain("Render failed");
      expect(createArg.data.lastError).toContain("Template syntax error");
      expect(createArg.data.maxAttempts).toBe(0);
    });

    it("uses fallback subject when i18n key is missing and logs warning", async () => {
      mockT.mockImplementation(() => {
        return Promise.reject(new Error("Missing i18n key"));
      });

      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
      // Fallback subject is the type name
      expect(createArg.data.subject).toBe("welcome");
      // FIX 11: Should log a warning when falling back
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ type: "welcome", locale: "en" }),
        expect.stringContaining("Missing subject i18n key"),
      );
    });

    it("falls back to 'Ouitransfer' when appName config throws", async () => {
      mockGetConfigValue.mockImplementation(async (key: string) => {
        if (key === "smtpEnabled") return "true";
        if (key === "appName") throw new Error("Config not found");
        if (key === "emailQueueMaxRetries") return "3";
        throw new Error(`Unknown config key: ${key}`);
      });

      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      // Job should still be created (fallback name used, not a failure)
      expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
      // createTranslationFn should have been called with the fallback appName
      expect(mockCreateTranslationFn).toHaveBeenCalledWith("en", { appName: "Ouitransfer" });
    });

    it("with cooldown: skips when recent job exists for same type/to/shareId", async () => {
      // share_accessed has cooldownSeconds: 900
      mockPrisma.emailJob.findFirst.mockResolvedValue({
        id: "recent-job",
        type: "share_accessed",
        to: "user@test.com",
        createdAt: new Date(),
      });

      await emailService.send("share_accessed", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        shareId: "share-1",
        data: {
          shareName: "My Share",
          accessedAt: "2025-01-01T00:00:00Z",
        },
      });

      expect(mockPrisma.emailJob.create).not.toHaveBeenCalled();
      expect(mockLogger.debug).toHaveBeenCalled();
    });

    it("with cooldown but no recent job: job IS created and findFirst was called with correct cutoff", async () => {
      // share_accessed has cooldownSeconds: 900 and defaultFrequency: "disabled"
      // We must set the user preference to "immediate" so the flow reaches the cooldown check
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "share_accessed",
        frequency: "immediate",
      });

      // No recent job found → should proceed to create
      mockPrisma.emailJob.findFirst.mockResolvedValue(null);

      await emailService.send("share_accessed", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        shareId: "share-1",
        data: {
          shareName: "My Share",
          accessedAt: "2025-01-01T00:00:00Z",
        },
      });

      // findFirst should have been called for cooldown check
      expect(mockPrisma.emailJob.findFirst).toHaveBeenCalledOnce();
      const findFirstArg = mockPrisma.emailJob.findFirst.mock.calls[0][0];
      expect(findFirstArg.where.type).toBe("share_accessed");
      expect(findFirstArg.where.to).toBe("user@test.com");
      // Cutoff should be approximately 900 seconds ago
      const cutoff = findFirstArg.where.createdAt.gt as Date;
      const expectedCutoff = Date.now() - 900 * 1000;
      expect(Math.abs(cutoff.getTime() - expectedCutoff)).toBeLessThan(5000); // within 5s tolerance

      // Job should have been created (cooldown did not block)
      expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
    });

    it("without cooldown: types without cooldownSeconds do not check", async () => {
      // welcome has no cooldownSeconds
      await emailService.send("welcome", {
        to: "user@test.com",
        locale: "en",
        data: { firstName: "John", loginUrl: "https://test.example.com" },
      });

      // Should not call findFirst for cooldown check
      expect(mockPrisma.emailJob.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
    });

    it("sets status to digest_pending when frequency is daily_digest", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "share_expiring",
        frequency: "daily_digest",
      });

      await emailService.send("share_expiring", {
        to: "user@test.com",
        locale: "en",
        userId: "user-1",
        data: {
          shareName: "My Share",
          expiresAt: "2025-12-31",
          shareManageUrl: "https://test.example.com/shares/1",
        },
      });

      const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
      expect(createArg.data.status).toBe("digest_pending");
    });
  });

  // ── resolveFrequency() ─────────────────────────────────────────────────────

  describe("resolveFrequency()", () => {
    it("returns catalog default when no preference exists", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);

      const freq = await emailService.resolveFrequency("share_expiring", "user-1");
      // share_expiring defaults to "immediate"
      expect(freq).toBe("immediate");
    });

    it("returns catalog default 'disabled' for noisy types", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);

      const freq = await emailService.resolveFrequency("share_accessed", "user-1");
      expect(freq).toBe("disabled");
    });

    it("returns disabled when user preference is disabled", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "share_expiring",
        frequency: "disabled",
      });

      const freq = await emailService.resolveFrequency("share_expiring", "user-1");
      expect(freq).toBe("disabled");
    });

    it("explicit disabled wins over notifyOnDownload=true", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "share_downloaded",
        frequency: "disabled",
      });

      mockPrisma.share.findUnique.mockResolvedValue({ notifyOnDownload: true });

      const freq = await emailService.resolveFrequency("share_downloaded", "user-1", "share-1");
      expect(freq).toBe("disabled");
    });

    it("notifyOnDownload=true upgrades daily_digest to immediate", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "share_downloaded",
        frequency: "daily_digest",
      });

      mockPrisma.share.findUnique.mockResolvedValue({ notifyOnDownload: true });

      const freq = await emailService.resolveFrequency("share_downloaded", "user-1", "share-1");
      expect(freq).toBe("immediate");
    });

    it("returns daily_digest when user prefers it", async () => {
      mockPrisma.notificationPreference.findUnique.mockResolvedValue({
        id: "pref-1",
        userId: "user-1",
        type: "share_expiring",
        frequency: "daily_digest",
      });

      const freq = await emailService.resolveFrequency("share_expiring", "user-1");
      expect(freq).toBe("daily_digest");
    });

    it("no preference + notifyOnDownload=true → immediate (catalog default overridden)", async () => {
      // No user preference row — catalog default for share_downloaded is "disabled"
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
      // Share has notifyOnDownload=true
      mockPrisma.share.findUnique.mockResolvedValue({ notifyOnDownload: true });

      const freq = await emailService.resolveFrequency("share_downloaded", "user-1", "share-1");
      expect(freq).toBe("immediate");
    });

    it("no preference + notifyOnDownload=false → disabled (catalog default)", async () => {
      // No user preference row — catalog default for share_downloaded is "disabled"
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
      // Share has notifyOnDownload=false
      mockPrisma.share.findUnique.mockResolvedValue({ notifyOnDownload: false });

      const freq = await emailService.resolveFrequency("share_downloaded", "user-1", "share-1");
      expect(freq).toBe("disabled");
    });

    it("no preference + notifyOnDownload=true for share_accessed → immediate", async () => {
      // No user preference row — catalog default for share_accessed is "disabled"
      mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
      // Share has notifyOnDownload=true
      mockPrisma.share.findUnique.mockResolvedValue({ notifyOnDownload: true });

      const freq = await emailService.resolveFrequency("share_accessed", "user-1", "share-1");
      expect(freq).toBe("immediate");
    });
  });

  // ── generateUnsubscribeUrl() ───────────────────────────────────────────────

  describe("generateUnsubscribeUrl()", () => {
    it("returns valid JWT-based URL with exp=90d", async () => {
      mockBuildUnsubscribeUrl.mockImplementation(async (token: string) => {
        return `https://test.example.com/api/notifications/unsubscribe?token=${token}`;
      });

      const url = await emailService.generateUnsubscribeUrl("user-1", "share_expiring");

      expect(url).toContain("https://test.example.com/api/notifications/unsubscribe?token=");

      // Extract the JWT token
      const token = url.split("token=")[1];
      expect(token).toBeDefined();

      // Should be a valid 3-part JWT
      const parts = token.split(".");
      expect(parts).toHaveLength(3);

      // Decode the payload
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
      expect(payload.userId).toBe("user-1");
      expect(payload.type).toBe("share_expiring");
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();

      // Check 90-day expiry (within 5s tolerance)
      const expectedExp = payload.iat + 90 * 24 * 60 * 60;
      expect(payload.exp).toBe(expectedExp);
    });
  });

  // ── sendToAdmins() ────────────────────────────────────────────────────────

  describe("sendToAdmins()", () => {
    it("sends to all active admins", async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: "admin-1", email: "admin1@test.com", locale: "en" },
        { id: "admin-2", email: "admin2@test.com", locale: "fr" },
      ]);

      await emailService.sendToAdmins("admin_user_registered", {
        userName: "New User",
        userEmail: "new@test.com",
        registrationMethod: "password",
      });

      // Should create 2 jobs, one per admin
      expect(mockPrisma.emailJob.create).toHaveBeenCalledTimes(2);

      // First admin
      const call1 = mockPrisma.emailJob.create.mock.calls[0][0];
      expect(call1.data.to).toBe("admin1@test.com");
      expect(call1.data.locale).toBe("en");

      // Second admin
      const call2 = mockPrisma.emailJob.create.mock.calls[1][0];
      expect(call2.data.to).toBe("admin2@test.com");
      expect(call2.data.locale).toBe("fr");
    });

    it("uses 'en' locale when admin has no locale set", async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: "admin-1", email: "admin1@test.com", locale: null },
      ]);

      await emailService.sendToAdmins("admin_user_registered", {
        userName: "New User",
        userEmail: "new@test.com",
        registrationMethod: "password",
      });

      const call = mockPrisma.emailJob.create.mock.calls[0][0];
      expect(call.data.locale).toBe("en");
    });

    it("queries only active admin users", async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);

      await emailService.sendToAdmins("admin_quota_alert", {
        userName: "User",
        userEmail: "user@test.com",
        usedPercent: 95,
        usedBytes: 9500000000,
        maxBytes: 10000000000,
      });

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { isAdmin: true, isActive: true },
        select: { id: true, email: true, locale: true },
      });
    });
  });
});
