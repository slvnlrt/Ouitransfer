/**
 * Integration tests for EmailService subject building with real i18n.
 *
 * Unlike email-service.test.ts which mocks all i18n functions, these tests
 * exercise the real `t()` and `createTranslationFn` against en.json to verify
 * that subject lines are correctly built with interpolated values.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock state ──────────────────────────────────────────────────────

const {
  mockGetConfigValue,
  mockPrisma,
  mockLogger,
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
  mockGetAppUrl: vi.fn(),
  mockBuildUnsubscribeUrl: vi.fn(),
  mockEmailQueueEvents: {
    emit: vi.fn(),
  },
}));

// ─── Mocks (only infrastructure — i18n is REAL) ──────────────────────────────

vi.mock("../../config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: mockPrisma,
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// NOTE: We do NOT mock ../i18n/loader.js — we use the real implementation

vi.mock("../url-builder.js", () => ({
  getAppUrl: mockGetAppUrl,
  buildUnsubscribeUrl: mockBuildUnsubscribeUrl,
}));

vi.mock("../events.js", () => ({
  emailQueueEvents: mockEmailQueueEvents,
}));

vi.mock("../../../env.js", () => ({
  env: {
    JWT_SECRET: "test-secret-key-that-is-at-least-32-characters-long",
  },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { clearLocaleCache } from "../i18n/loader.js";
import { emailService } from "../service.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("EmailService — integration with real i18n", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocaleCache();

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

    mockGetAppUrl.mockResolvedValue("https://test.example.com");
    mockBuildUnsubscribeUrl.mockResolvedValue(
      "https://test.example.com/api/notifications/unsubscribe?token=abc",
    );
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
    mockPrisma.emailJob.findFirst.mockResolvedValue(null);
    mockPrisma.emailJob.create.mockResolvedValue({ id: "job-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("builds welcome subject with real en.json interpolation", async () => {
    await emailService.send("welcome", {
      to: "user@test.com",
      locale: "en",
      userId: "user-1",
      data: { firstName: "Alice", loginUrl: "https://test.example.com" },
    });

    expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
    const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
    // en.json: "welcome.subject" = "{appName} - Welcome!"
    expect(createArg.data.subject).toBe("TestApp - Welcome!");
  });

  it("builds password_reset subject with interpolated appName", async () => {
    await emailService.send("password_reset", {
      to: "user@test.com",
      locale: "en",
      data: { resetUrl: "https://test.example.com/reset/abc", expiresInMinutes: 60 },
    });

    expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
    const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
    // en.json: "passwordReset.subject" = "{appName} - Password Reset Request"
    expect(createArg.data.subject).toBe("TestApp - Password Reset Request");
  });

  it("renders HTML body with real translation and HTML-escaped user data", async () => {
    await emailService.send("welcome", {
      to: "user@test.com",
      locale: "en",
      userId: "user-1",
      data: { firstName: '<script>alert("xss")</script>', loginUrl: "https://test.example.com" },
    });

    expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
    const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
    // The body should contain escaped HTML
    expect(createArg.data.htmlBody).toContain("&lt;script&gt;");
    expect(createArg.data.htmlBody).not.toContain("<script>");
    // Subject should NOT have XSS payload in script tags (CR/LF sanitized, but HTML is not escaped in subjects)
    expect(createArg.data.subject).toBe("TestApp - Welcome!");
  });

  it("falls back to en.json when requested locale is unavailable", async () => {
    await emailService.send("welcome", {
      to: "user@test.com",
      locale: "zz", // non-existent locale
      userId: "user-1",
      data: { firstName: "Alice", loginUrl: "https://test.example.com" },
    });

    expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();
    const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
    // Should fall back to English
    expect(createArg.data.subject).toBe("TestApp - Welcome!");
  });
});
