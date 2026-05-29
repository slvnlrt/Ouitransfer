import crypto from "node:crypto";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";

import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SmtpConfig {
  smtpEnabled: string;
  smtpHost: string;
  smtpPort: string;
  smtpUser: string;
  smtpPass: string;
  smtpFromName: string;
  smtpFromEmail: string;
  smtpSecure: string;
  smtpNoAuth: string;
  smtpTrustSelfSigned: string;
}

interface NodemailerTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  pool: boolean;
  maxConnections: number;
  maxMessages: number;
  tls?: { rejectUnauthorized: boolean };
  auth?: { user: string; pass: string };
}

// ─── SmtpTransport ───────────────────────────────────────────────────────────

/**
 * Pooled, config-hash-aware SMTP transport.
 *
 * - Caches a nodemailer `Transporter` instance and reuses it across calls.
 * - Recomputes a SHA-256 hash of the SMTP config on every `getTransporter()`
 *   call; recreates the transporter only when the hash changes (e.g. after an
 *   admin saves new SMTP settings).
 * - `testConnection()` accepts an optional config override so the admin UI can
 *   test a draft configuration before saving it to the database.
 * - `sendMail()` automatically prepends the configured `from` address.
 */
export class SmtpTransport {
  private transporter: Transporter | null = null;
  private configHash: string | null = null;

  // ── Public API ─────────────────────────────────────────────────────────

  /**
   * Returns a pooled nodemailer `Transporter`.
   * Recreates it only when the SMTP config has changed since last call.
   */
  async getTransporter(): Promise<Transporter> {
    const config = await this.loadConfig();
    const hash = this.hashConfig(config);

    if (this.transporter !== null && hash === this.configHash) {
      return this.transporter;
    }

    // Config changed or first call — (re)create the transporter
    this.transporter?.close();
    this.transporter = nodemailer.createTransport(this.buildTransportOptions(config));
    this.configHash = hash;

    return this.transporter;
  }

  /**
   * Tests the SMTP connection.
   *
   * @param overrideConfig - Optional partial config to test before saving (admin UI).
   *   When provided, merges over the current DB config.
   * @returns `{ success: true, message }` on success,
   *          `{ success: false, message }` on failure (never throws).
   */
  async testConnection(
    overrideConfig?: Partial<SmtpConfig>,
  ): Promise<{ success: boolean; message: string }> {
    const dbConfig = await this.loadConfig();
    const config: SmtpConfig = overrideConfig ? { ...dbConfig, ...overrideConfig } : dbConfig;

    const transportOptions = this.buildTransportOptions(config);
    const testTransporter = nodemailer.createTransport(transportOptions);

    try {
      await testTransporter.verify();
      return { success: true, message: "SMTP connection successful" };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, message };
    } finally {
      testTransporter.close();
    }
  }

  /**
   * Sends an email. Automatically adds the `from` address from the DB config.
   * Translates `listUnsubscribeHeader` → nodemailer `headers` (RFC 8058).
   * Logs send duration and recipient via Pino.
   * Re-throws transport errors so the caller can handle them.
   */
  async sendMail(
    options: Omit<SendMailOptions, "from"> & {
      from?: string;
      listUnsubscribeHeader?: string;
    },
  ): Promise<void> {
    const transporter = await this.getTransporter();

    // Load from address from DB (needed even if transporter is cached)
    const fromName = await getConfigValue("smtpFromName");
    const fromEmail = await getConfigValue("smtpFromEmail");
    const from = options.from ?? { name: fromName, address: fromEmail };

    // Translate listUnsubscribeHeader → nodemailer headers (RFC 8058)
    if (options.listUnsubscribeHeader) {
      const existingHeaders =
        typeof options.headers === "object" && !Array.isArray(options.headers)
          ? (options.headers as Record<string, string>)
          : {};
      options.headers = {
        ...existingHeaders,
        "List-Unsubscribe": options.listUnsubscribeHeader,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      };
      delete options.listUnsubscribeHeader;
    }

    const start = Date.now();
    await transporter.sendMail({ ...options, from });
    const durationMs = Date.now() - start;

    getLogger().info({ to: options.to, subject: options.subject, durationMs }, "Email sent");
  }

  /**
   * Disposes the cached transporter and clears the config hash.
   * Forces the next `getTransporter()` call to recreate it.
   */
  close(): void {
    this.transporter?.close();
    this.transporter = null;
    this.configHash = null;
  }

  // ── Private helpers ────────────────────────────────────────────────────

  /**
   * Reads all SMTP config keys from the database.
   * Returns the auth keys only when `smtpNoAuth !== "true"`.
   */
  private async loadConfig(): Promise<SmtpConfig> {
    const smtpEnabled = await getConfigValue("smtpEnabled");
    const smtpHost = await getConfigValue("smtpHost");
    const smtpPort = await getConfigValue("smtpPort");
    const smtpSecure = (await getConfigValue("smtpSecure")) || "auto";
    const smtpNoAuth = (await getConfigValue("smtpNoAuth")) || "false";
    const smtpTrustSelfSigned = (await getConfigValue("smtpTrustSelfSigned")) || "false";
    const smtpFromName = await getConfigValue("smtpFromName");
    const smtpFromEmail = await getConfigValue("smtpFromEmail");

    let smtpUser = "";
    let smtpPass = "";
    if (smtpNoAuth !== "true") {
      smtpUser = await getConfigValue("smtpUser");
      smtpPass = await getConfigValue("smtpPass");
    }

    return {
      smtpEnabled,
      smtpHost,
      smtpPort,
      smtpSecure,
      smtpNoAuth,
      smtpTrustSelfSigned,
      smtpFromName,
      smtpFromEmail,
      smtpUser,
      smtpPass,
    };
  }

  /**
   * Converts a `SmtpConfig` into nodemailer transport options.
   * Replicates the exact logic from the legacy `EmailService.createTransporter()`
   * and `EmailService.testConnection()`, consolidating the duplication.
   */
  private buildTransportOptions(config: SmtpConfig): NodemailerTransportOptions {
    const port = Number(config.smtpPort);
    const smtpSecure = config.smtpSecure || "auto";

    let secure = false;
    let requireTLS = false;

    if (smtpSecure === "ssl") {
      secure = true;
    } else if (smtpSecure === "tls") {
      requireTLS = true;
    } else if (smtpSecure === "none") {
      secure = false;
      requireTLS = false;
    } else if (smtpSecure === "auto") {
      if (port === 465) {
        secure = true;
      } else if (port === 587 || port === 25) {
        requireTLS = true;
      }
    }

    const transportOptions: NodemailerTransportOptions = {
      host: config.smtpHost,
      port,
      secure,
      requireTLS,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
    };

    if (smtpSecure !== "none") {
      transportOptions.tls = {
        rejectUnauthorized: config.smtpTrustSelfSigned !== "true",
      };
    }

    if (config.smtpNoAuth !== "true") {
      transportOptions.auth = {
        user: config.smtpUser,
        pass: config.smtpPass,
      };
    }

    return transportOptions;
  }

  /**
   * Computes a SHA-256 hex digest of the SMTP config for change detection.
   * Only fields that affect the transport connection are included.
   */
  private hashConfig(config: SmtpConfig): string {
    // Exclude from/display fields (smtpFromName, smtpFromEmail) — they don't
    // affect the transport connection and changing them shouldn't force a
    // transporter recreation.
    const relevant = {
      smtpEnabled: config.smtpEnabled,
      smtpHost: config.smtpHost,
      smtpPort: config.smtpPort,
      smtpSecure: config.smtpSecure,
      smtpNoAuth: config.smtpNoAuth,
      smtpTrustSelfSigned: config.smtpTrustSelfSigned,
      smtpUser: config.smtpUser,
      smtpPass: config.smtpPass,
    };
    return crypto.createHash("sha256").update(JSON.stringify(relevant)).digest("hex");
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

/** Application-level singleton SmtpTransport instance. */
export const smtpTransport = new SmtpTransport();
