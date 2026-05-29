import crypto from "node:crypto";

import { env } from "../../env.js";
import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";
import { getConfigValue } from "../config/service.js";
import {
  type EmailPayloads,
  type NotificationKey,
  type NotificationTypeConfig,
  notificationCatalog,
  typeToI18nPrefix,
} from "./catalog.js";
import { emailQueueEvents } from "./events.js";
import { createTranslationFn, t } from "./i18n/loader.js";
import { getMaxRetries } from "./queue.js";
import { renderLayout } from "./templates/base-layout.js";
import { buildUnsubscribeUrl, getAppUrl } from "./url-builder.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** HMAC sub-key derivation label for unsubscribe tokens. */
const UNSUBSCRIBE_KEY_LABEL = "unsubscribe";

/** Unsubscribe token expiry in seconds: 90 days. */
const UNSUBSCRIBE_TOKEN_EXPIRY_SECONDS = 90 * 24 * 60 * 60;

// ─── JWT helpers (standalone, no Fastify instance needed) ─────────────────────

/**
 * Derives a purpose-specific HMAC key from the global JWT_SECRET.
 * This prevents cross-purpose token reuse (e.g. an auth JWT being
 * accepted as an unsubscribe token).
 */
function deriveKey(label: string): Buffer {
  return crypto.createHmac("sha256", env.JWT_SECRET).update(label).digest();
}

/** Base64url encode (no padding). */
function base64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

/**
 * Creates a compact HS256 JWT token for unsubscribe links.
 * We avoid importing jsonwebtoken (not a project dependency) and instead
 * use Node's native crypto — the token format is standard JWT.
 *
 * // Tech debt: Hand-rolled JWT. Consider migrating to jose library if validation
 * // requirements grow (e.g. key rotation, RS256, audience checks). See review finding Core M-8.
 */
function signUnsubscribeToken(payload: { userId: string; type: string }): string {
  const key = deriveKey(UNSUBSCRIBE_KEY_LABEL);
  const now = Math.floor(Date.now() / 1000);

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64url(
    JSON.stringify({
      ...payload,
      iat: now,
      exp: now + UNSUBSCRIBE_TOKEN_EXPIRY_SECONDS,
    }),
  );

  const signature = base64url(
    crypto.createHmac("sha256", key).update(`${header}.${body}`).digest(),
  );

  return `${header}.${body}.${signature}`;
}

// ─── EmailService ─────────────────────────────────────────────────────────────

class EmailService {
  /**
   * Send a typed notification email.
   *
   * This is the single entry point for all notification emails.
   * It validates the payload, checks preferences, renders the template,
   * and inserts an EmailJob for the queue worker to pick up.
   */
  async send<T extends NotificationKey>(
    type: T,
    options: {
      to: string;
      locale: string;
      userId?: string;
      data: EmailPayloads[T];
      shareId?: string;
    },
  ): Promise<void> {
    const log = getLogger();
    const entry = notificationCatalog[type];

    // 1. Check SMTP is enabled
    let smtpEnabled: string;
    try {
      smtpEnabled = await getConfigValue("smtpEnabled");
    } catch {
      // Config key missing — SMTP not configured
      log.debug({ type }, "SMTP not configured, skipping email");
      return;
    }
    if (smtpEnabled !== "true") {
      log.debug({ type }, "SMTP disabled, skipping email");
      return;
    }

    // 1b. Check appUrl is configured (required for links in emails)
    try {
      await getAppUrl();
    } catch {
      log.warn({ type }, "appUrl not configured, skipping email");
      return;
    }

    // 2. Resolve appName once (used in render, subject, and layout)
    let appName: string;
    try {
      appName = await getConfigValue("appName");
    } catch {
      appName = "Ouitransfer";
    }

    // 3. For non-critical types, resolve frequency ONCE and reuse
    let frequency: "immediate" | "daily_digest" | "disabled" | null = null;
    if (!entry.isCritical && options.userId) {
      frequency = await this.resolveFrequency(type, options.userId, options.shareId);
      if (frequency === "disabled") {
        log.debug({ type, userId: options.userId }, "Notification disabled by user preference");
        return;
      }
    }

    // 4. Check cooldown for noisy types
    const cooldown = (entry as NotificationTypeConfig).cooldownSeconds;
    if (cooldown && cooldown > 0) {
      const cutoff = new Date(Date.now() - cooldown * 1000);
      const recent = await prisma.emailJob.findFirst({
        where: {
          type,
          to: options.to,
          relatedId: options.shareId ?? null,
          createdAt: { gt: cutoff },
          status: { notIn: ["failed", "processing"] },
        },
      });
      if (recent) {
        log.debug({ type, to: options.to, shareId: options.shareId }, "Cooldown active, skipping");
        return;
      }
    }

    // 5. Generate unsubscribe URL ONCE (used in both footer link and List-Unsubscribe header)
    let unsubscribeUrl: string | undefined;
    if (entry.hasUnsubscribe && options.userId) {
      unsubscribeUrl = await this.generateUnsubscribeUrl(options.userId, type);
    }

    // 6. Build string params from payload data for i18n interpolation.
    //    Convert all payload values to strings so they can be used in subjects and templates.
    const dataParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(options.data as Record<string, unknown>)) {
      if (typeof value === "string") {
        dataParams[key] = value;
      } else if (typeof value === "number" || typeof value === "boolean") {
        dataParams[key] = String(value);
      }
      // Arrays and objects are skipped — they don't interpolate into {key} placeholders
    }

    // 7. Render template
    let htmlBody: string;
    let textBody: string;
    try {
      const tr = await createTranslationFn(options.locale, { appName });
      const slots = entry.render(options.data as unknown, tr);

      // Add unsubscribe URL if applicable
      if (unsubscribeUrl) {
        slots.unsubscribeUrl = unsubscribeUrl;
      }

      const output = renderLayout(slots, { appName, locale: options.locale }, tr);
      htmlBody = output.html;
      textBody = output.text;
    } catch (renderError) {
      // Render failure → create FAILED job immediately (no retry)
      log.error({ type, error: renderError }, "Email render failed, creating FAILED job");

      const errorMessage =
        renderError instanceof Error ? renderError.message : "Unknown render error";

      await prisma.emailJob.create({
        data: {
          type,
          to: options.to,
          subject: type,
          locale: options.locale,
          status: "failed",
          priority: entry.priority,
          lastError: `Render failed: ${errorMessage}`,
          relatedId: options.shareId,
          maxAttempts: 0,
        },
      });
      return;
    }

    // 8. Resolve subject from i18n with full payload params (plain text, no HTML escaping)
    let subject: string;
    try {
      const prefix = typeToI18nPrefix(type);
      subject = await t(options.locale, `${prefix}.subject`, { appName, ...dataParams });
    } catch {
      // i18n key not found — use type as fallback subject
      log.warn(
        { type, locale: options.locale },
        "Missing subject i18n key, using type as fallback",
      );
      subject = type;
    }

    // 9. Resolve unsubscribe header
    let listUnsubscribe: string | undefined;
    if (unsubscribeUrl) {
      listUnsubscribe = `<${unsubscribeUrl}>`;
    }

    // 10. Determine job status based on frequency (already resolved above)
    let status = "pending";
    if (frequency === "daily_digest") {
      status = "digest_pending";
    }

    // 11. Insert EmailJob
    const maxAttempts = await getMaxRetries();
    await prisma.emailJob.create({
      data: {
        type,
        to: options.to,
        subject,
        htmlBody,
        textBody,
        locale: options.locale,
        status,
        priority: entry.priority,
        relatedId: options.shareId,
        listUnsubscribe,
        maxAttempts,
      },
    });

    // 12. Wake the queue for priority 1 jobs
    if (entry.priority === 1) {
      emailQueueEvents.emit("wake");
    }
  }

  /**
   * Resolves the effective notification frequency for a user + type.
   *
   * Cascade:
   * 1. User has a NotificationPreference row → use its frequency
   * 2. No row → use catalog defaultFrequency
   * 3. Per-share override: if share.notifyOnDownload=true → upgrade to "immediate"
   * 4. "disabled" always wins (no upgrade overrides it)
   */
  async resolveFrequency(
    type: string,
    userId: string,
    shareId?: string,
  ): Promise<"immediate" | "daily_digest" | "disabled"> {
    // Step 1: Check user preference
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
    });

    const catalogEntry = notificationCatalog[type as NotificationKey];
    const baseFrequency = pref ? pref.frequency : (catalogEntry?.defaultFrequency ?? "immediate");

    // Step 2: "disabled" always wins — no override can change it
    if (baseFrequency === "disabled") {
      return "disabled";
    }

    // Step 3: Per-share notifyOnDownload upgrade (only for share_downloaded)
    if (shareId && type === "share_downloaded") {
      const share = await prisma.share.findUnique({
        where: { id: shareId },
        select: { notifyOnDownload: true },
      });
      if (share?.notifyOnDownload) {
        return "immediate";
      }
    }

    return baseFrequency as "immediate" | "daily_digest";
  }

  /**
   * Generates a signed unsubscribe URL for the given user + notification type.
   * The token is a compact HS256 JWT with a 90-day expiry.
   */
  async generateUnsubscribeUrl(userId: string, type: string): Promise<string> {
    const token = signUnsubscribeToken({ userId, type });
    return buildUnsubscribeUrl(token);
  }

  /**
   * Sends a notification to all active admin users.
   * Each admin receives a separate `send()` call so that individual
   * preference checks and locale selection apply per-admin.
   */
  async sendToAdmins<T extends NotificationKey>(type: T, data: EmailPayloads[T]): Promise<void> {
    const admins = await prisma.user.findMany({
      where: { isAdmin: true, isActive: true },
      select: { id: true, email: true, locale: true },
    });

    for (const admin of admins) {
      await this.send(type, {
        to: admin.email,
        locale: admin.locale ?? "en",
        userId: admin.id,
        data,
      });
    }
  }
}

export const emailService = new EmailService();
