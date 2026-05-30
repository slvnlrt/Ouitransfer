/**
 * email-integration.test.ts
 *
 * Integration test wiring EmailService → catalog → i18n → renderLayout → queue → transport.
 *
 * Mocked layers:
 *   - Prisma (database) — we simulate EmailJob creation/retrieval via mock
 *   - SmtpTransport.sendMail — captures outgoing mail instead of sending via SMTP
 *   - Config service — returns test config values
 *   - env module — provides test JWT_SECRET
 *
 * Real layers (NOT mocked):
 *   - Email catalog (notification types, Zod schemas, render functions)
 *   - i18n (translation loading from real messages files)
 *   - Template rendering (renderLayout, individual template renderers)
 *   - URL builder (buildUnsubscribeUrl)
 *   - Unsubscribe token (signUnsubscribeToken)
 *
 * The test verifies the full pipeline: calling emailService.send() creates an
 * EmailJob with correctly rendered subject, HTML body (with escaped data),
 * text body, and List-Unsubscribe header.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock state ──────────────────────────────────────────────────────

const { mockGetConfigValue, mockPrisma } = vi.hoisted(() => ({
  mockGetConfigValue: vi.fn(),
  mockPrisma: {
    emailJob: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
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
}));

// ─── Mocks — ONLY infrastructure layers ──────────────────────────────────────

vi.mock("../../config/service.js", () => ({
  getConfigValue: mockGetConfigValue,
}));

vi.mock("../../../shared/prisma.js", () => ({
  prisma: mockPrisma,
}));

// Mock env module for JWT_SECRET (needed by unsubscribe-token.ts)
vi.mock("../../../env.js", () => ({
  env: {
    JWT_SECRET: "test-secret-key-that-is-at-least-32-characters-long",
  },
}));

// Mock logger (getLogger requires setLogger to be called first in real app)
vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  })),
}));

// ─── Imports (after mocks — these are REAL implementations) ──────────────────

import { emailService } from "../service.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupIntegrationConfig() {
  mockGetConfigValue.mockImplementation(async (key: string) => {
    const config: Record<string, string> = {
      smtpEnabled: "true",
      appName: "TestApp Integration",
      appUrl: "https://integration.example.com",
      emailQueueMaxRetries: "3",
    };
    if (key in config) return config[key];
    throw new Error(`Config key "${key}" not found`);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Email integration: send → catalog → i18n → renderLayout → job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupIntegrationConfig();

    // Default: no existing preferences, no cooldown hits
    mockPrisma.notificationPreference.findUnique.mockResolvedValue(null);
    mockPrisma.emailJob.findFirst.mockResolvedValue(null);
    mockPrisma.emailJob.create.mockResolvedValue({ id: "integration-job-1" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("share_invitation: full pipeline produces correct EmailJob data", async () => {
    const result = await emailService.send("share_invitation", {
      to: "recipient@example.com",
      locale: "en",
      data: {
        senderName: "Alice <script>alert('xss')</script>",
        shareName: "My Important Files",
        shareLink: "https://integration.example.com/s/abc123",
        hasPassword: true,
        expiresAt: "2026-12-31T23:59:59Z",
      },
    });

    expect(result.enqueued).toBe(true);
    expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();

    const createArg = mockPrisma.emailJob.create.mock.calls[0][0];
    const jobData = createArg.data;

    // ── to ──
    expect(jobData.to).toBe("recipient@example.com");

    // ── type ──
    expect(jobData.type).toBe("share_invitation");

    // ── subject contains appName ──
    expect(jobData.subject).toContain("TestApp Integration");

    // ── subject has no CR/LF (SMTP header injection prevention) ──
    expect(jobData.subject).not.toContain("\r");
    expect(jobData.subject).not.toContain("\n");

    // ── HTML body exists and contains escaped data ──
    expect(jobData.htmlBody).toBeTruthy();
    // The HTML should escape the XSS attempt in senderName
    expect(jobData.htmlBody).not.toContain("<script>");
    expect(jobData.htmlBody).toContain("&lt;script&gt;");

    // ── text body exists ──
    expect(jobData.textBody).toBeTruthy();
    expect(typeof jobData.textBody).toBe("string");

    // ── share_invitation has no unsubscribe (hasUnsubscribe=false) ──
    expect(jobData.listUnsubscribe).toBeUndefined();

    // ── locale preserved ──
    expect(jobData.locale).toBe("en");

    // ── status is pending (immediate) ──
    expect(jobData.status).toBe("pending");
  });

  it("share_expiring with userId: includes List-Unsubscribe header", async () => {
    const result = await emailService.send("share_expiring", {
      to: "owner@example.com",
      locale: "en",
      userId: "user-123",
      data: {
        shareName: "Expiring Share",
        expiresAt: "2026-06-30T00:00:00Z",
        shareManageUrl: "https://integration.example.com/shares/share-1",
      },
    });

    expect(result.enqueued).toBe(true);
    expect(mockPrisma.emailJob.create).toHaveBeenCalledOnce();

    const jobData = mockPrisma.emailJob.create.mock.calls[0][0].data;

    // ── List-Unsubscribe header set ──
    expect(jobData.listUnsubscribe).toBeTruthy();
    expect(jobData.listUnsubscribe).toContain("<");
    expect(jobData.listUnsubscribe).toContain(">");
    expect(jobData.listUnsubscribe).toContain("unsubscribe");

    // ── subject contains appName ──
    expect(jobData.subject).toContain("TestApp Integration");

    // ── HTML and text bodies exist ──
    expect(jobData.htmlBody).toBeTruthy();
    expect(jobData.textBody).toBeTruthy();
  });

  it("welcome (critical): bypasses preferences, renders HTML and text", async () => {
    // Set preference to disabled — should be ignored for critical types
    mockPrisma.notificationPreference.findUnique.mockResolvedValue({
      id: "pref-1",
      userId: "user-1",
      type: "welcome",
      frequency: "disabled",
    });

    const result = await emailService.send("welcome", {
      to: "newuser@example.com",
      locale: "en",
      userId: "user-1",
      data: {
        firstName: "Bob",
        loginUrl: "https://integration.example.com/auth/login",
      },
    });

    expect(result.enqueued).toBe(true);

    // Preferences should NOT have been checked (critical type)
    expect(mockPrisma.notificationPreference.findUnique).not.toHaveBeenCalled();

    const jobData = mockPrisma.emailJob.create.mock.calls[0][0].data;

    // ── Both HTML and text exist ──
    expect(jobData.htmlBody).toBeTruthy();
    expect(jobData.textBody).toBeTruthy();

    // ── HTML contains the first name ──
    expect(jobData.htmlBody).toContain("Bob");

    // ── Priority 1 for critical ──
    expect(jobData.priority).toBe(1);
  });

  it("appName with CR/LF is sanitized in subject (I-4 integration)", async () => {
    mockGetConfigValue.mockImplementation(async (key: string) => {
      if (key === "smtpEnabled") return "true";
      if (key === "appName") return "Injected\r\nBcc: attacker@evil.com";
      if (key === "appUrl") return "https://integration.example.com";
      if (key === "emailQueueMaxRetries") return "3";
      throw new Error(`Config key "${key}" not found`);
    });

    await emailService.send("welcome", {
      to: "user@test.com",
      locale: "en",
      data: {
        firstName: "Test",
        loginUrl: "https://integration.example.com/auth/login",
      },
    });

    const jobData = mockPrisma.emailJob.create.mock.calls[0][0].data;
    // Subject must NOT contain CR/LF — header injection prevented
    expect(jobData.subject).not.toContain("\r");
    expect(jobData.subject).not.toContain("\n");
  });
});
