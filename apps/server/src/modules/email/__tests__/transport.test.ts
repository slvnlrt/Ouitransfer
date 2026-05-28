import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted mock state ───────────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() factories, making these variables
// available inside the factory closures without TDZ issues.

const { mockSendMail, mockVerify, mockClose, mockTransporter, mockCreateTransport, mockLogger } =
  vi.hoisted(() => {
    const mockSendMail = vi.fn();
    const mockVerify = vi.fn();
    const mockClose = vi.fn();
    const mockTransporter = { sendMail: mockSendMail, verify: mockVerify, close: mockClose };
    const mockCreateTransport = vi.fn(() => mockTransporter);
    const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    return {
      mockSendMail,
      mockVerify,
      mockClose,
      mockTransporter,
      mockCreateTransport,
      mockLogger,
    };
  });

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("nodemailer", () => ({
  default: {
    createTransport: mockCreateTransport,
  },
  createTransport: mockCreateTransport,
}));

vi.mock("../../config/service.js", () => ({
  getConfigValue: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => mockLogger),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { getConfigValue } from "../../config/service.js";
import { SmtpTransport } from "../transport.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Sets up a default "SMTP enabled" config mock */
function setupSmtpConfig(overrides: Record<string, string> = {}) {
  const defaults: Record<string, string> = {
    smtpEnabled: "true",
    smtpHost: "smtp.example.com",
    smtpPort: "587",
    smtpUser: "user@example.com",
    smtpPass: "secret",
    smtpSecure: "auto",
    smtpNoAuth: "false",
    smtpTrustSelfSigned: "false",
    smtpFromName: "Test App",
    smtpFromEmail: "noreply@example.com",
    ...overrides,
  };
  vi.mocked(getConfigValue).mockImplementation(async (key: string) => {
    if (key in defaults) return defaults[key];
    throw new Error(`Unexpected config key: ${key}`);
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SmtpTransport", () => {
  let transport: SmtpTransport;

  beforeEach(() => {
    vi.clearAllMocks();
    transport = new SmtpTransport();
    // Re-establish factory return and default implementations after clearAllMocks()
    mockCreateTransport.mockReturnValue(mockTransporter);
    mockVerify.mockResolvedValue(true);
    mockSendMail.mockResolvedValue({ messageId: "default" });
    mockClose.mockReturnValue(undefined);
  });

  afterEach(() => {
    transport.close();
  });

  // ── Transporter pooling ────────────────────────────────────────────────────

  it("creates a pooled nodemailer transporter on first getTransporter() call", async () => {
    setupSmtpConfig();

    await transport.getTransporter();

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
  });

  it("reuses the same transporter when SMTP config has not changed", async () => {
    setupSmtpConfig();

    const t1 = await transport.getTransporter();
    const t2 = await transport.getTransporter();

    expect(mockCreateTransport).toHaveBeenCalledTimes(1);
    expect(t1).toBe(t2);
  });

  it("recreates the transporter when SMTP config changes (hash mismatch)", async () => {
    setupSmtpConfig();
    await transport.getTransporter();

    // Change the config
    setupSmtpConfig({ smtpHost: "smtp.other.com" });
    await transport.getTransporter();

    expect(mockCreateTransport).toHaveBeenCalledTimes(2);
  });

  // ── testConnection() ──────────────────────────────────────────────────────

  it("testConnection() returns { success: true } when SMTP server verifies", async () => {
    setupSmtpConfig();
    mockVerify.mockResolvedValue(true);

    const result = await transport.testConnection();

    expect(result.success).toBe(true);
    expect(result.message).toBeTruthy();
  });

  it("testConnection() returns { success: false, message } on SMTP error", async () => {
    setupSmtpConfig();
    mockVerify.mockRejectedValue(new Error("Connection refused"));

    const result = await transport.testConnection();

    expect(result.success).toBe(false);
    expect(result.message).toContain("Connection refused");
  });

  // ── sendMail() ────────────────────────────────────────────────────────────

  it("sendMail() calls transporter.sendMail with from address from config", async () => {
    setupSmtpConfig();

    await transport.sendMail({ to: "dest@example.com", subject: "Hello", html: "<p>Hi</p>" });

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"Test App" <noreply@example.com>',
        to: "dest@example.com",
      }),
    );
  });

  it("sendMail() logs duration and recipient via Pino", async () => {
    setupSmtpConfig();

    await transport.sendMail({ to: "someone@example.com", subject: "Test", html: "<p>Hi</p>" });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ to: "someone@example.com" }),
      expect.any(String),
    );
  });

  it("sendMail() re-throws transport errors for caller handling", async () => {
    setupSmtpConfig();
    mockSendMail.mockRejectedValue(new Error("Send failed"));

    await expect(
      transport.sendMail({ to: "fail@example.com", subject: "Test", html: "<p>Hi</p>" }),
    ).rejects.toThrow("Send failed");
  });

  // ── getTransporter() config key coverage ──────────────────────────────────

  it("getTransporter() reads all SMTP config keys from DB", async () => {
    setupSmtpConfig();

    await transport.getTransporter();

    expect(getConfigValue).toHaveBeenCalledWith("smtpEnabled");
    expect(getConfigValue).toHaveBeenCalledWith("smtpHost");
    expect(getConfigValue).toHaveBeenCalledWith("smtpPort");
    expect(getConfigValue).toHaveBeenCalledWith("smtpSecure");
    expect(getConfigValue).toHaveBeenCalledWith("smtpNoAuth");
    expect(getConfigValue).toHaveBeenCalledWith("smtpTrustSelfSigned");
  });

  // ── SMTP secure mode handling ──────────────────────────────────────────────

  it("handles smtpSecure='ssl' (secure=true, requireTLS=false)", async () => {
    setupSmtpConfig({ smtpSecure: "ssl", smtpPort: "465" });

    await transport.getTransporter();

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, requireTLS: false }),
    );
  });

  it("handles smtpSecure='tls' (secure=false, requireTLS=true)", async () => {
    setupSmtpConfig({ smtpSecure: "tls", smtpPort: "587" });

    await transport.getTransporter();

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true }),
    );
  });

  it("handles smtpSecure='none' (secure=false, requireTLS=false, no tls object)", async () => {
    setupSmtpConfig({ smtpSecure: "none", smtpPort: "25" });

    await transport.getTransporter();

    const callArgs = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.secure).toBe(false);
    expect(callArgs.requireTLS).toBe(false);
    expect(callArgs.tls).toBeUndefined();
  });

  it("handles smtpSecure='auto' on port 465 (ssl mode)", async () => {
    setupSmtpConfig({ smtpSecure: "auto", smtpPort: "465" });

    await transport.getTransporter();

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, requireTLS: false }),
    );
  });

  it("handles smtpSecure='auto' on port 587 (tls/starttls mode)", async () => {
    setupSmtpConfig({ smtpSecure: "auto", smtpPort: "587" });

    await transport.getTransporter();

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, requireTLS: true }),
    );
  });

  // ── Auth and TLS options ───────────────────────────────────────────────────

  it("handles smtpNoAuth='true' (skips auth credentials)", async () => {
    setupSmtpConfig({ smtpNoAuth: "true" });

    await transport.getTransporter();

    const callArgs = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.auth).toBeUndefined();
    // User/pass config keys should not be fetched when noAuth is true
    expect(getConfigValue).not.toHaveBeenCalledWith("smtpUser");
    expect(getConfigValue).not.toHaveBeenCalledWith("smtpPass");
  });

  it("handles smtpTrustSelfSigned='true' (rejectUnauthorized: false)", async () => {
    setupSmtpConfig({ smtpTrustSelfSigned: "true" });

    await transport.getTransporter();

    const callArgs = mockCreateTransport.mock.calls[0][0] as Record<string, unknown>;
    expect(callArgs.tls).toEqual({ rejectUnauthorized: false });
  });

  // ── close() ───────────────────────────────────────────────────────────────

  it("close() disposes the transporter and clears the hash (forces recreation)", async () => {
    setupSmtpConfig();

    await transport.getTransporter();
    transport.close();

    // After close, next call should recreate
    await transport.getTransporter();
    expect(mockCreateTransport).toHaveBeenCalledTimes(2);
  });
});
