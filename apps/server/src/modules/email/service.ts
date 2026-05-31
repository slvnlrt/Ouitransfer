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

/**
 * ISO 8601 datetime regex (e.g. "2026-01-15T09:30:00.000Z" or "2026-01-15T09:30:00+05:30").
 */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Detects date-shaped string values and formats them for human-readable email rendering.
 * A value is considered a date if the key ends with "At" (e.g. expiresAt, accessedAt,
 * downloadedAt, expiredAt) or matches the ISO datetime pattern.
 * Returns the original value unchanged if it's not a date.
 */
function formatDateIfApplicable(key: string, value: string, locale: string): string {
  const isDateKey = key.endsWith("At");
  const isIsoDate = ISO_DATETIME_RE.test(value);

  if (!isDateKey && !isIsoDate) return value;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date);
  } catch {
    // Invalid locale — fall back to English formatting
    return new Intl.DateTimeFormat("en", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "UTC",
    }).format(date);
  }
}

/**
 * Creates a shallow copy of the validated data with date-shaped string values
 * formatted for human-readable rendering in email bodies.
 *
 * This ensures templates receive "December 31, 2026 at 12:00 AM" instead of
 * "2026-12-31T00:00:00.000Z" when interpolating fields like expiresAt, accessedAt, etc.
 */
function formatDataForRendering<T>(data: T, locale: string): T {
  if (typeof data !== "object" || data === null) return data;

  const formatted = { ...data } as Record<string, unknown>;
  for (const [key, value] of Object.entries(formatted)) {
    if (typeof value === "string") {
      formatted[key] = formatDateIfApplicable(key, value, locale);
    }
    // Non-string values (numbers, booleans, arrays, objects) are left unchanged
  }
  return formatted as T;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Fallback application name used when the `appName` config key is unavailable. */
const DEFAULT_APP_NAME = "Ouitransfer";

// ─── EmailService ─────────────────────────────────────────────────────────────

class EmailService {
  /**
   * Send a typed notification email.
   *
   * This is the single entry point for all notification emails.
   * It validates the payload, checks preferences, renders the template,
   * and inserts an EmailJob for the queue worker to pick up.
   *
   * **No-throw contract**: this method never throws. All internal errors are
   * caught and logged; the caller always receives `{ enqueued: boolean }`.
   */
  async send<T extends NotificationKey>(
    type: T,
    options: {
      to: string;
      locale: string;
      userId?: string;
      data: EmailPayloads[T];
      /**
       * Free-form identifier for cooldown scoping and DB tracking.
       * For share notifications: the shareId. For reverse-share notifications: the reverseShareId.
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

    const effectiveRelatedId = options.relatedId;

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

    // 1b. Check appUrl is configured (required for links in emails).
    //     Read once here and pass to URL builders below to avoid redundant DB reads.
    let appUrl: string;
    try {
      appUrl = await getAppUrl();
    } catch {
      log.warn({ type }, "appUrl not configured, skipping email");
      return { enqueued: false };
    }

    // 2. Resolve appName once (used in render, subject, and layout)
    let appName: string;
    try {
      appName = await getConfigValue("appName");
    } catch {
      appName = DEFAULT_APP_NAME;
    }

    // 3. For non-critical types, resolve frequency ONCE and reuse
    let frequency: "immediate" | "daily_digest" | "disabled" | null = null;
    let skipCooldown = false;
    if (!entry.isCritical && options.userId) {
      const resolved = await this.resolveFrequency(type, options.userId, effectiveRelatedId);
      frequency = resolved.frequency;
      skipCooldown = resolved.overridden;
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
    //    When the frequency was overridden by a per-share flag (e.g. notifyOnDownload),
    //    the cooldown is bypassed — the owner explicitly opted in to every notification.
    const cooldown = (entry as NotificationTypeConfig).cooldownSeconds;
    if (cooldown && cooldown > 0 && !skipCooldown) {
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

    // 5. Generate unsubscribe URL ONCE (used in both footer link and List-Unsubscribe header).
    //    Pass the already-resolved appUrl to avoid a second DB round-trip.
    let unsubscribeUrl: string | undefined;
    if (entry.hasUnsubscribe && options.userId) {
      unsubscribeUrl = await this.generateUnsubscribeUrl(options.userId, type, appUrl);
    }

    // 6. Build string params from payload data for i18n interpolation.
    //    Convert all payload values to strings so they can be used in subjects and templates.
    //    Date-shaped values (keys ending in "At" or ISO datetime strings) are automatically
    //    formatted with Intl.DateTimeFormat for human-readable rendering in emails.
    const dataParams: Record<string, string> = {};
    for (const [key, value] of Object.entries(validatedData as Record<string, unknown>)) {
      if (typeof value === "string") {
        dataParams[key] = formatDateIfApplicable(key, value, options.locale);
      } else if (typeof value === "number" || typeof value === "boolean") {
        dataParams[key] = String(value);
      }
      // Arrays and objects are skipped — they don't interpolate into {key} placeholders
    }

    // 7. Render template
    //    Pass formatted data (dates as human-readable strings) to the render function
    //    so email bodies show "December 31, 2026 at 12:00 AM" instead of ISO strings.
    let htmlBody: string;
    let textBody: string;
    try {
      const tr = await createTranslationFn(options.locale, { appName });
      const formattedData = formatDataForRendering(validatedData, options.locale);
      const slots = entry.render(formattedData as unknown, tr);

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

      try {
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
      } catch (dbError) {
        log.error({ type, error: dbError }, "Failed to persist render-failure job to DB");
      }
      return { enqueued: true };
    }

    // 8. Sanitize data params AND appName: strip CR/LF to prevent SMTP header injection
    //    via user-controlled values (senderName, shareName, appName, etc.)
    const sanitizedParams = sanitizeForSubject({ appName, ...dataParams });

    // 9. Resolve subject from i18n with full payload params (plain text, no HTML escaping).
    // Note: subject is frozen at enqueue time — admin appName changes won't affect queued jobs.
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
    try {
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
    } catch (dbError) {
      log.error({ type, to: options.to, error: dbError }, "Failed to persist email job to DB");
      return { enqueued: false };
    }

    // 13. Wake the queue for priority 1 jobs
    if (entry.priority === 1) {
      emailQueueEvents.emit("wake");
    }

    return { enqueued: true };
  }

  /**
   * Resolves the effective notification frequency for a user + type.
   *
   * Returns `{ frequency, overridden }`:
   * - `frequency`: the resolved frequency ("immediate", "daily_digest", or "disabled")
   * - `overridden`: true when the frequency was upgraded by a per-share flag (e.g.
   *   notifyOnDownload). When overridden, the caller should bypass the cooldown check
   *   because the share owner explicitly opted in to every notification.
   *
   * Cascade:
   * 1. User has an *explicit* NotificationPreference row → use its frequency
   * 2. Explicit user "disabled" always wins — no override can change it
   * 3a. Per-share override: if share.notifyOnDownload=true → upgrade to "immediate"
   * 3b. Per-reverse-share override: if reverseShare.notifyOnUpload=true → upgrade to "immediate"
   *    (checked BEFORE falling back to catalog default so that per-share toggles
   *    work for users who have never set a preference)
   * 4. Fall back to explicit preference or catalog defaultFrequency
   */
  async resolveFrequency(
    type: string,
    userId: string,
    shareId?: string,
  ): Promise<{
    frequency: "immediate" | "daily_digest" | "disabled";
    overridden: boolean;
  }> {
    // Step 1: Check user preference
    const pref = await prisma.notificationPreference.findUnique({
      where: { userId_type: { userId, type } },
    });

    const explicitFrequency = pref?.frequency;
    const catalogEntry = notificationCatalog[type as NotificationKey];
    const defaultFrequency = catalogEntry?.defaultFrequency ?? "immediate";

    // Step 2: Explicit user "disabled" always wins — no override can change it
    if (explicitFrequency === "disabled") {
      return { frequency: "disabled", overridden: false };
    }

    // Step 3: Per-share/reverse-share notification overrides.
    // Checked BEFORE the catalog default so that users who never set a preference
    // can still get notified when the per-share toggle is on.
    if (shareId) {
      // Step 3a: notifyOnDownload (only for share_downloaded — not share_accessed)
      if (type === "share_downloaded") {
        const share = await prisma.share.findUnique({
          where: { id: shareId },
          select: { notifyOnDownload: true },
        });
        if (share?.notifyOnDownload) {
          return { frequency: "immediate", overridden: true };
        }
      }

      // Step 3b: notifyOnUpload (only for reverse_share_uploaded)
      if (type === "reverse_share_uploaded") {
        const reverseShare = await prisma.reverseShare.findUnique({
          where: { id: shareId },
          select: { notifyOnUpload: true },
        });
        if (reverseShare?.notifyOnUpload) {
          return { frequency: "immediate", overridden: false };
        }
      }
    }

    // Step 4: Fall back to explicit pref or catalog default
    const frequency = (explicitFrequency ?? defaultFrequency) as
      | "immediate"
      | "daily_digest"
      | "disabled";
    return { frequency, overridden: false };
  }

  /**
   * Generates a signed unsubscribe URL for the given user + notification type.
   * The token is a compact HS256 JWT with a 90-day expiry.
   *
   * Pass a pre-fetched `appUrl` to avoid a redundant DB round-trip when the
   * caller has already resolved it.
   */
  async generateUnsubscribeUrl(userId: string, type: string, appUrl?: string): Promise<string> {
    const token = signUnsubscribeToken({ userId, type });
    return buildUnsubscribeUrl(token, appUrl);
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
