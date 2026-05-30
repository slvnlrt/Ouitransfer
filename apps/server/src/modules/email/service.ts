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
import { type EmailJobStatus, getMaxRetries } from "./queue.js";
import { renderLayout } from "./templates/base-layout.js";
import { signUnsubscribeToken } from "./unsubscribe-token.js";
import { buildUnsubscribeUrl, getAppUrl } from "./url-builder.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Strips CR/LF characters from all string values in a params record.
 * Prevents SMTP header injection when interpolating user-controlled data
 * into email subjects via i18n templates.
 */
function sanitizeForSubject(params: Record<string, string>): Record<string, string> {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    clean[k] = v.replace(/[\r\n]/g, " ");
  }
  return clean;
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
      /** @deprecated Use `relatedId` instead. Alias kept for backward compatibility. */
      shareId?: string;
      /**
       * Free-form identifier for cooldown scoping and DB tracking.
       * For share notifications: the shareId. For reverse-share notifications: the reverseShareId.
       * Falls back to `shareId` if not provided (backward compatibility).
       */
      relatedId?: string;
    },
  ): Promise<{ enqueued: boolean; reason?: "invalid_payload" }> {
    const log = getLogger();
    const entry = notificationCatalog[type];

    // 0. Validate payload against the catalog's Zod schema
    const parsed = entry.payloadSchema.safeParse(options.data);
    if (!parsed.success) {
      log.error({ type, issues: parsed.error.issues }, "Invalid email payload — refusing to send");
      return { enqueued: false, reason: "invalid_payload" as const };
    }
    // Use validated/parsed data for the rest of the method
    const validatedData = parsed.data as EmailPayloads[T];

    // Resolve effective relatedId (relatedId takes priority over deprecated shareId)
    const effectiveRelatedId = options.relatedId ?? options.shareId;

    // 1. Check SMTP is enabled
    let smtpEnabled: string;
    try {
      smtpEnabled = await getConfigValue("smtpEnabled");
    } catch {
      // Config key missing — SMTP not configured
      log.debug({ type }, "SMTP not configured, skipping email");
      return { enqueued: false };
    }
    if (smtpEnabled !== "true") {
      log.debug({ type }, "SMTP disabled, skipping email");
      return { enqueued: false };
    }

    // 1b. Check appUrl is configured (required for links in emails)
    try {
      await getAppUrl();
    } catch {
      log.warn({ type }, "appUrl not configured, skipping email");
      return { enqueued: false };
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
      frequency = await this.resolveFrequency(type, options.userId, effectiveRelatedId);
      if (frequency === "disabled") {
        log.debug({ type, userId: options.userId }, "Notification disabled by user preference");
        return { enqueued: false };
      }
    }

    // 4. Check cooldown for noisy types
    //    Only non-failed jobs count toward the cooldown window. A failed send
    //    should not prevent a legitimate retry.
    //    Cooldown key is scoped by (type, to, relatedId) — not per-visitor. This means
    //    all visitors to the same share share the same cooldown window for the owner.
    //    Per-visitor segregation was considered but adds complexity without significant
    //    value — the owner still learns "someone accessed your share" within the window.
    const cooldown = (entry as NotificationTypeConfig).cooldownSeconds;
    if (cooldown && cooldown > 0) {
      const cutoff = new Date(Date.now() - cooldown * 1000);
      const recent = await prisma.emailJob.findFirst({
        where: {
          type,
          to: options.to,
          relatedId: effectiveRelatedId ?? null,
          createdAt: { gt: cutoff },
          status: { in: ["pending", "processing", "sent", "digest_pending"] },
        },
      });
      if (recent) {
        log.debug(
          { type, to: options.to, relatedId: effectiveRelatedId },
          "Cooldown active, skipping",
        );
        return { enqueued: false };
      }
    }

    // 5. Generate unsubscribe URL ONCE (used in both footer link and List-Unsubscribe header)
    let unsubscribeUrl: string | undefined;
    if (entry.hasUnsubscribe && options.userId) {
      unsubscribeUrl = await this.generateUnsubscribeUrl(options.userId, type);
    }

    // 6. Build string params from payload data for i18n interpolation.
    //    Convert all payload values to strings so they can be used in subjects and templates.
    // TODO: Date localization — ISO datetime strings (expiresAt, accessedAt, downloadedAt, etc.)
    // are currently rendered as raw ISO format in email bodies. For user-friendly emails, format
    // date values with `Intl.DateTimeFormat(locale, { dateStyle: 'long' })` before interpolation.
    // Requires identifying which payload keys are dates (via catalog metadata or naming convention)
    // and threading the locale into this formatting step. Deferred — raw ISO dates are unambiguous.
    const dataParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(validatedData as Record<string, unknown>)) {
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
      const slots = entry.render(validatedData as unknown, tr);

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
          relatedId: effectiveRelatedId,
          maxAttempts: 0,
        },
      });
      return { enqueued: true };
    }

    // 8. Sanitize data params AND appName: strip CR/LF to prevent SMTP header injection
    //    via user-controlled values (senderName, shareName, appName, etc.)
    const sanitizedParams = sanitizeForSubject({ appName, ...dataParams });

    // 9. Resolve subject from i18n with full payload params (plain text, no HTML escaping)
    let subject: string;
    try {
      const prefix = typeToI18nPrefix(type);
      subject = await t(options.locale, `${prefix}.subject`, sanitizedParams);
    } catch {
      // i18n key not found — use type as fallback subject
      log.warn(
        { type, locale: options.locale },
        "Missing subject i18n key, using type as fallback",
      );
      subject = type;
    }

    // 10. Resolve unsubscribe header
    let listUnsubscribe: string | undefined;
    if (unsubscribeUrl) {
      listUnsubscribe = `<${unsubscribeUrl}>`;
    }

    // 11. Determine job status based on frequency (already resolved above)
    let status: EmailJobStatus = "pending";
    if (frequency === "daily_digest") {
      status = "digest_pending";
    }

    // 12. Insert EmailJob
    // Digest jobs store raw data as JSON payload (htmlBody/textBody null) — the digest
    // aggregator will render a combined template at send time. Immediate jobs store
    // pre-rendered HTML/text bodies (payload null).
    const isDigest = status === "digest_pending";
    const maxAttempts = await getMaxRetries();
    await prisma.emailJob.create({
      data: {
        type,
        to: options.to,
        subject,
        htmlBody: isDigest ? null : htmlBody,
        textBody: isDigest ? null : textBody,
        payload: isDigest ? JSON.stringify({ v: 1, type, data: validatedData }) : undefined,
        locale: options.locale,
        status,
        priority: entry.priority,
        relatedId: effectiveRelatedId,
        listUnsubscribe,
        maxAttempts,
      },
    });

    // 13. Wake the queue for priority 1 jobs
    if (entry.priority === 1) {
      emailQueueEvents.emit("wake");
    }

    return { enqueued: true };
  }

  /**
   * Resolves the effective notification frequency for a user + type.
   *
   * Cascade:
   * 1. User has an *explicit* NotificationPreference row → use its frequency
   * 2. Explicit user "disabled" always wins — no override can change it
   * 3. Per-share override: if share.notifyOnDownload=true → upgrade to "immediate"
   *    (checked BEFORE falling back to catalog default so that per-share toggles
   *    work for users who have never set a preference)
   * 4. Fall back to explicit preference or catalog defaultFrequency
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

    const explicitFrequency = pref?.frequency;
    const catalogEntry = notificationCatalog[type as NotificationKey];
    const defaultFrequency = catalogEntry?.defaultFrequency ?? "immediate";

    // Step 2: Explicit user "disabled" always wins — no override can change it
    if (explicitFrequency === "disabled") {
      return "disabled";
    }

    // Step 3: Per-share notifyOnDownload upgrade (only for share_downloaded / share_accessed).
    // Checked BEFORE the catalog default so that users who never set a preference
    // can still get notified when the per-share toggle is on.
    if (shareId && ["share_downloaded", "share_accessed"].includes(type)) {
      const share = await prisma.share.findUnique({
        where: { id: shareId },
        select: { notifyOnDownload: true },
      });
      if (share?.notifyOnDownload) {
        return "immediate";
      }
    }

    // Step 4: Fall back to explicit pref or catalog default
    return (explicitFrequency ?? defaultFrequency) as "immediate" | "daily_digest" | "disabled";
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
  async sendToAdmins<T extends NotificationKey>(
    type: T,
    data: EmailPayloads[T],
  ): Promise<{ enqueued: boolean }> {
    const admins = await prisma.user.findMany({
      where: { isAdmin: true, isActive: true },
      select: { id: true, email: true, locale: true },
    });

    let anyEnqueued = false;
    for (const admin of admins) {
      const result = await this.send(type, {
        to: admin.email,
        locale: admin.locale ?? "en",
        userId: admin.id,
        data,
      });
      if (result.enqueued) anyEnqueued = true;
    }

    return { enqueued: anyEnqueued };
  }
}

export const emailService = new EmailService();
