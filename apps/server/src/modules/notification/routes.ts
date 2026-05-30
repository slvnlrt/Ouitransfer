import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { prisma } from "../../shared/prisma.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { escapeHtml } from "../../utils/escape-html.js";
import { type NotificationKey, notificationCatalog } from "../email/catalog.js";
import { emailService } from "../email/service.js";
import {
  getUserPreferences,
  unsubscribeUser,
  updateUserPreferences,
  verifyUnsubscribeToken,
} from "./service.js";

const jwtPreValidation = createJwtPreValidation();
const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

const BRAND_INDIGO = "#6366f1";

const HTML_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #f8fafc; margin: 0; padding: 0; min-height: 100vh;
         display: flex; align-items: center; justify-content: center; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.08);
          padding: 40px; max-width: 480px; width: 100%; text-align: center; }
  h1 { color: #1e293b; font-size: 1.5rem; margin: 0 0 12px; }
  p { color: #64748b; font-size: 1rem; margin: 0 0 24px; line-height: 1.6; }
  .type-badge { display: inline-block; background: #f1f5f9; color: #334155;
                border-radius: 6px; padding: 4px 12px; font-size: 0.875rem;
                font-family: monospace; margin-bottom: 24px; }
  .btn { display: inline-block; background: ${BRAND_INDIGO}; color: #fff;
         border: none; border-radius: 8px; padding: 12px 28px;
         font-size: 1rem; cursor: pointer; text-decoration: none; }
  .btn:hover { background: #4f46e5; }
  .success-icon { font-size: 3rem; margin-bottom: 16px; }
  .error-icon { font-size: 3rem; margin-bottom: 16px; }
`.trim();

// ─── Unsubscribe page i18n strings ────────────────────────────────────────────
// Minimal inline map for localized unsubscribe pages. Covers English and French;
// other locales fall back to English. The unsubscribe JWT contains userId + type
// but not locale, so we fetch the user's locale from the DB after token verification.
// TODO: These inline strings should eventually use the email i18n system (loader.ts)
// for full locale coverage. Deferred — only en/fr are needed for the unsubscribe flow.

interface UnsubscribePageStrings {
  lang: string;
  confirmTitle: string;
  confirmAbout: string;
  confirmAction: string;
  confirmButton: string;
  successTitle: string;
  successMessage: (type: string) => string;
  successManage: string;
  errorTitle: string;
  errorMessage: string;
  errorManage: string;
}

const PAGE_STRINGS: Record<string, UnsubscribePageStrings> = {
  en: {
    lang: "en",
    confirmTitle: "Unsubscribe from notifications",
    confirmAbout: "You are about to unsubscribe from:",
    confirmAction: "You will no longer receive emails for this notification type.",
    confirmButton: "Confirm Unsubscribe",
    successTitle: "Successfully unsubscribed",
    successMessage: (type) =>
      `You have been unsubscribed from <strong>${escapeHtml(type)}</strong> notifications.`,
    successManage: "You can manage all your notification preferences in your account settings.",
    errorTitle: "Invalid or expired unsubscribe link",
    errorMessage:
      "This unsubscribe link is no longer valid. It may have expired or already been used.",
    errorManage:
      "You can manage your notification preferences directly from your account settings.",
  },
  fr: {
    lang: "fr",
    confirmTitle: "Se désabonner des notifications",
    confirmAbout: "Vous êtes sur le point de vous désabonner de :",
    confirmAction: "Vous ne recevrez plus d'e-mails pour ce type de notification.",
    confirmButton: "Confirmer le désabonnement",
    successTitle: "Désabonnement réussi",
    successMessage: (type) =>
      `Vous avez été désabonné des notifications <strong>${escapeHtml(type)}</strong>.`,
    successManage:
      "Vous pouvez gérer toutes vos préférences de notification dans les paramètres de votre compte.",
    errorTitle: "Lien invalide ou expiré",
    errorMessage:
      "Ce lien de désabonnement n'est plus valide. Il a peut-être expiré ou a déjà été utilisé.",
    errorManage:
      "Vous pouvez gérer vos préférences de notification directement depuis les paramètres de votre compte.",
  },
};

/**
 * Returns the human-readable display name for a notification type.
 * Falls back to the raw type key if the type is not in the catalog.
 */
function getTypeDisplayName(type: string): string {
  const entry = notificationCatalog[type as NotificationKey];
  return entry?.displayName ?? type;
}

function getPageStrings(locale?: string | null): UnsubscribePageStrings {
  if (locale && locale in PAGE_STRINGS) return PAGE_STRINGS[locale];
  // Try base language (e.g. "fr-CA" → "fr")
  if (locale) {
    const base = locale.split("-")[0];
    if (base in PAGE_STRINGS) return PAGE_STRINGS[base];
  }
  return PAGE_STRINGS.en;
}

/**
 * Fetch the user's locale from the DB for unsubscribe page localization.
 * Returns null if the user is not found (token may reference a deleted account).
 */
async function getUserLocale(userId: string): Promise<string | null> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return user?.locale ?? null;
  } catch {
    return null;
  }
}

function renderConfirmPage(token: string, type: string, strings: UnsubscribePageStrings): string {
  return `<!DOCTYPE html>
<html lang="${strings.lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${strings.confirmTitle}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
  <div class="card">
    <h1>${strings.confirmTitle}</h1>
    <p>${strings.confirmAbout}</p>
    <div class="type-badge">${escapeHtml(type)}</div>
    <p>${strings.confirmAction}</p>
    <form method="POST">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <button type="submit" class="btn">${strings.confirmButton}</button>
    </form>
  </div>
</body>
</html>`;
}

function renderSuccessPage(type: string, strings: UnsubscribePageStrings): string {
  return `<!DOCTYPE html>
<html lang="${strings.lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${strings.successTitle}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="success-icon">✅</div>
    <h1>${strings.successTitle}</h1>
    <p>${strings.successMessage(type)}</p>
    <p>${strings.successManage}</p>
  </div>
</body>
</html>`;
}

function renderErrorPage(strings?: UnsubscribePageStrings): string {
  const s = strings ?? PAGE_STRINGS.en;
  return `<!DOCTYPE html>
<html lang="${s.lang}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${s.errorTitle}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="error-icon">⚠️</div>
    <h1>${s.errorTitle}</h1>
    <p>${s.errorMessage}</p>
    <p>${s.errorManage}</p>
  </div>
</body>
</html>`;
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const PreferenceItemSchema = z.object({
  type: z.string(),
  frequency: z.string(),
  configurable: z.boolean(),
  isCritical: z.boolean(),
  defaultFrequency: z.string(),
});

const UpdatePreferencesBodySchema = z.object({
  preferences: z.array(
    z.object({
      type: z.string(),
      frequency: z.string(),
    }),
  ),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export const notificationRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── GET /notifications/preferences ─────────────────────────────────────────

  app.route({
    method: "GET",
    url: "/notifications/preferences",
    preValidation: jwtPreValidation,
    schema: {
      tags: ["Notifications"],
      operationId: "getNotificationPreferences",
      summary: "Get notification preferences for the authenticated user",
      response: {
        200: z.object({ preferences: z.array(PreferenceItemSchema) }),
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const preferences = await getUserPreferences(request.user.userId);
      return reply.send({ preferences });
    },
  });

  // ── PUT /notifications/preferences ─────────────────────────────────────────

  app.route({
    method: "PUT",
    url: "/notifications/preferences",
    preValidation: jwtPreValidation,
    schema: {
      tags: ["Notifications"],
      operationId: "updateNotificationPreferences",
      summary: "Update notification preferences for the authenticated user",
      body: UpdatePreferencesBodySchema,
      response: {
        200: z.object({ message: z.string() }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      await updateUserPreferences(request.user.userId, request.body.preferences);
      return reply.send({ message: "Notification preferences updated" });
    },
  });

  // ── GET /notifications/unsubscribe ─────────────────────────────────────────
  // Public — renders an HTML confirmation page. Does NOT perform the unsubscribe.

  app.route({
    method: "GET",
    url: "/notifications/unsubscribe",
    config: {
      rateLimit: {
        max: 30,
        timeWindow: "1 hour",
      },
    },
    schema: {
      tags: ["Notifications"],
      operationId: "getUnsubscribePage",
      summary: "Render unsubscribe confirmation page (public)",
      querystring: z.object({ token: z.string() }),
      response: {
        200: z.string(),
        400: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { token } = request.query;

      try {
        const { userId, type } = verifyUnsubscribeToken(token);
        const locale = await getUserLocale(userId);
        const strings = getPageStrings(locale);
        // Use human-readable displayName from catalog instead of raw snake_case type key
        const displayName = getTypeDisplayName(type);
        return reply
          .header("Content-Type", "text/html; charset=utf-8")
          .send(renderConfirmPage(token, displayName, strings));
      } catch {
        return reply.header("Content-Type", "text/html; charset=utf-8").send(renderErrorPage());
      }
    },
  });

  // ── POST /notifications/unsubscribe ────────────────────────────────────────
  // Public, CSRF-exempt — performs the unsubscribe action.

  app.route({
    method: "POST",
    url: "/notifications/unsubscribe",
    config: {
      csrfExempt: true,
      rateLimit: {
        max: 30,
        timeWindow: "1 hour",
      },
    },
    schema: {
      tags: ["Notifications"],
      operationId: "processUnsubscribe",
      summary: "Process unsubscribe (public, CSRF-exempt)",
      // Body is permissive: HTML form sends {token}, RFC 8058 one-click sends
      // {List-Unsubscribe: "One-Click"} with token in query string only.
      body: z.object({ token: z.string().optional() }).passthrough().optional(),
      querystring: z.object({ token: z.string().optional() }),
      response: {
        200: z.string(),
      },
    },
    handler: async (request, reply) => {
      // Accept token from form body or query string (RFC 8058 one-click)
      const body = request.body as { token?: string } | undefined;
      const query = request.query as { token?: string };
      const token = body?.token ?? query.token;

      if (!token) {
        return reply.header("Content-Type", "text/html; charset=utf-8").send(renderErrorPage());
      }

      try {
        const { userId, type } = verifyUnsubscribeToken(token);
        await unsubscribeUser(userId, type);
        const locale = await getUserLocale(userId);
        const strings = getPageStrings(locale);
        // Use human-readable displayName from catalog instead of raw snake_case type key
        const displayName = getTypeDisplayName(type);
        return reply
          .header("Content-Type", "text/html; charset=utf-8")
          .send(renderSuccessPage(displayName, strings));
      } catch {
        return reply.header("Content-Type", "text/html; charset=utf-8").send(renderErrorPage());
      }
    },
  });

  // ── GET /admin/email/stats ─────────────────────────────────────────────────
  // Admin-only — returns email queue counters.

  app.route({
    method: "GET",
    url: "/admin/email/stats",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Admin"],
      operationId: "getEmailStats",
      summary: "Get email queue statistics (admin only)",
      response: {
        200: z.object({
          pending: z.number(),
          sentLast24h: z.number(),
          failed: z.number(),
          digestPending: z.number(),
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const [pending, sentLast24h, failed, digestPending] = await Promise.all([
        prisma.emailJob.count({ where: { status: "pending" } }),
        prisma.emailJob.count({
          where: {
            status: "sent",
            sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
          },
        }),
        prisma.emailJob.count({ where: { status: "failed" } }),
        prisma.emailJob.count({ where: { status: "digest_pending" } }),
      ]);
      return reply.send({ pending, sentLast24h, failed, digestPending });
    },
  });

  // ── POST /admin/email/test ─────────────────────────────────────────────────
  // Admin-only — sends a test email via the email service.

  app.route({
    method: "POST",
    url: "/admin/email/test",
    preValidation: adminPreValidation,
    schema: {
      tags: ["Admin"],
      operationId: "sendTestEmail",
      summary: "Send a test email (admin only)",
      body: z.object({
        to: z.string().email(),
      }),
      response: {
        200: z.object({
          success: z.literal(true),
          message: z.string(),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { to } = request.body;
      const admin = await prisma.user.findUnique({
        where: { id: request.user.userId },
        select: { locale: true },
      });
      const result = await emailService.send("test_email", {
        to,
        locale: admin?.locale ?? "en",
        data: {},
      });
      if (!result.enqueued) {
        return reply.code(400).send({
          statusCode: 400,
          error: "Email not sent — SMTP is not configured or disabled",
        });
      }
      return reply.send({ success: true, message: "Test email queued" });
    },
  });
};
