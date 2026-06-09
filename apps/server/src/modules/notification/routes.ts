import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { prisma } from "../../shared/prisma.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { escapeHtml } from "../../utils/escape-html.js";
import { isNotificationKey, notificationCatalog } from "../email/catalog.js";
import { createTranslationFn, type TranslationFn } from "../email/i18n/loader.js";
import { UNSUBSCRIBE_I18N } from "../email/i18n/unsubscribe-keys.js";
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

// ─── Unsubscribe page i18n ─────────────────────────────────────────────────────
// The localized unsubscribe pages reuse the email i18n system (loader.ts) so they
// share a single source of truth and the same locale-resolution/fallback rules as
// the notification emails themselves (requested locale → English). The unsubscribe
// JWT carries userId + type but not locale, so we resolve the user's locale from
// the DB after token verification. Strings live under the `unsubscribe.*` namespace
// in `../email/i18n/messages/*.json`.

/**
 * Returns the human-readable display name for a notification type.
 * Falls back to the raw type key if the type is not in the catalog.
 */
function getTypeDisplayName(type: string): string {
  if (!isNotificationKey(type)) return type;
  return notificationCatalog[type].displayName;
}

/**
 * Fetch the user's locale from the DB for unsubscribe page localization.
 * Returns "en" if the user is not found (token may reference a deleted account).
 */
async function getUserLocale(userId: string): Promise<string> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { locale: true },
    });
    return user?.locale ?? "en";
  } catch {
    return "en";
  }
}

/**
 * Renders the error page. Used whenever the token is missing, invalid, or
 * expired — at which point no user (and therefore no locale) is known, so it
 * always renders in English, matching the email i18n fallback.
 */
async function renderErrorPage(): Promise<string> {
  const tr = await createTranslationFn("en");
  return renderErrorPageHtml(tr, "en");
}

// `tr` is the HTML-escaping translation function from createTranslationFn: the
// interpolated `{type}` value is escaped, while markup in the template (e.g.
// <strong>) is preserved. All other strings have no placeholders and pass through
// verbatim — translation values are developer-controlled, so they are safe to
// embed directly. The `lang` attribute mirrors the requested locale exactly as the
// email base layout does.

function renderConfirmPage(token: string, type: string, tr: TranslationFn, lang: string): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${tr(UNSUBSCRIBE_I18N.confirmTitle)}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
  <div class="card">
    <h1>${tr(UNSUBSCRIBE_I18N.confirmTitle)}</h1>
    <p>${tr(UNSUBSCRIBE_I18N.confirmAbout)}</p>
    <div class="type-badge">${escapeHtml(type)}</div>
    <p>${tr(UNSUBSCRIBE_I18N.confirmAction)}</p>
    <form method="POST">
      <input type="hidden" name="token" value="${escapeHtml(token)}" />
      <button type="submit" class="btn">${tr(UNSUBSCRIBE_I18N.confirmButton)}</button>
    </form>
  </div>
</body>
</html>`;
}

function renderSuccessPage(type: string, tr: TranslationFn, lang: string): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${tr(UNSUBSCRIBE_I18N.successTitle)}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="success-icon">✅</div>
    <h1>${tr(UNSUBSCRIBE_I18N.successTitle)}</h1>
    <p>${tr(UNSUBSCRIBE_I18N.successMessage, { type })}</p>
    <p>${tr(UNSUBSCRIBE_I18N.successManage)}</p>
  </div>
</body>
</html>`;
}

function renderErrorPageHtml(tr: TranslationFn, lang: string): string {
  return `<!DOCTYPE html>
<html lang="${escapeHtml(lang)}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${tr(UNSUBSCRIBE_I18N.errorTitle)}</title>
  <style>${HTML_STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="error-icon">⚠️</div>
    <h1>${tr(UNSUBSCRIBE_I18N.errorTitle)}</h1>
    <p>${tr(UNSUBSCRIBE_I18N.errorMessage)}</p>
    <p>${tr(UNSUBSCRIBE_I18N.errorManage)}</p>
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
      frequency: z.enum(["immediate", "disabled"]),
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
        const tr = await createTranslationFn(locale);
        // Use human-readable displayName from catalog instead of raw snake_case type key
        const displayName = getTypeDisplayName(type);
        return reply
          .header("Content-Type", "text/html; charset=utf-8")
          .send(renderConfirmPage(token, displayName, tr, locale));
      } catch {
        return reply
          .header("Content-Type", "text/html; charset=utf-8")
          .send(await renderErrorPage());
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
      const body = request.body;
      const query = request.query;
      const token = body?.token ?? query.token;

      if (!token) {
        return reply
          .header("Content-Type", "text/html; charset=utf-8")
          .send(await renderErrorPage());
      }

      try {
        const { userId, type } = verifyUnsubscribeToken(token);
        await unsubscribeUser(userId, type);
        const locale = await getUserLocale(userId);
        const tr = await createTranslationFn(locale);
        // Use human-readable displayName from catalog instead of raw snake_case type key
        const displayName = getTypeDisplayName(type);
        return reply
          .header("Content-Type", "text/html; charset=utf-8")
          .send(renderSuccessPage(displayName, tr, locale));
      } catch {
        return reply
          .header("Content-Type", "text/html; charset=utf-8")
          .send(await renderErrorPage());
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
