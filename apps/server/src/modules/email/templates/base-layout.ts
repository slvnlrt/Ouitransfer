import { escapeHtml } from "../../../utils/escape-html.js";
import { getLogger } from "../../../utils/logger.js";
import type { TranslationFn } from "../i18n/loader.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LayoutSlots {
  /** Short subtitle shown below the app name in the header (e.g. "Password Reset") */
  subtitle: string;
  /** Main HTML body content — already-rendered HTML string */
  body: string;
  /** Optional call-to-action button */
  cta?: { url: string; label: string };
  /** Optional info/notice box with a left indigo border */
  infoBox?: string;
  /** Optional unsubscribe URL — renders unsubscribe link in footer when provided */
  unsubscribeUrl?: string;
}

export interface LayoutConfig {
  /** Application display name (e.g. "Ouitransfer") */
  appName: string;
  /** Locale code for the `<html lang>` attribute (defaults to "en") */
  locale?: string;
}

export interface LayoutOutput {
  html: string;
  text: string;
}

// ─── Colours / tokens (inline, Outlook-safe) ─────────────────────────────────

const COLOR = {
  indigo: "#6366f1",
  indigoLight: "#e0e7ff",
  white: "#ffffff",
  bodyBg: "#f3f4f6",
  cardBg: "#ffffff",
  textPrimary: "#1f2937",
  textSecondary: "#4b5563",
  textMuted: "#9ca3af",
  border: "#e5e7eb",
  infoBg: "#f9fafb",
} as const;

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Converts newline characters (`\n`) to `<br>` tags for HTML rendering.
 * Translation body strings use `\n\n` for paragraph breaks; without this
 * conversion browsers collapse whitespace into a single line.
 */
function nlToBr(text: string): string {
  return text.replace(/\n/g, "<br>");
}

/**
 * Validates a URL scheme and HTML-escapes it for safe use in `href` attributes.
 * Only allows `http:`, `https:`, and `mailto:` schemes. Returns `"#"` for
 * invalid URLs or dangerous schemes (e.g., `javascript:`), and logs a warning
 * so the operator can detect misconfigured URLs (e.g. wrong appUrl).
 */
export function safeHref(url: string): string {
  try {
    const u = new URL(url);
    if (!["http:", "https:", "mailto:"].includes(u.protocol)) {
      getLogger().warn(
        { url, protocol: u.protocol },
        "Rejected URL with disallowed protocol in email template",
      );
      return "#";
    }
    return escapeHtml(url);
  } catch {
    getLogger().warn({ url }, "Rejected invalid URL in email template");
    return "#";
  }
}

/**
 * Returns `url` only if it is a safe `http:`/`https:`/`mailto:` URL, otherwise the
 * placeholder `"#"` (A6-07). The HTML renderer escapes hrefs via {@link safeHref};
 * the plain-text renderer has no escaping, so a non-http(s) `appUrl` (e.g. from a
 * misconfigured config key) would otherwise print a raw `javascript:`/`data:` URL.
 * This applies the same scheme allowlist for the text body.
 */
export function safeTextUrl(url: string): string {
  try {
    const u = new URL(url);
    if (!["http:", "https:", "mailto:"].includes(u.protocol)) {
      getLogger().warn(
        { url, protocol: u.protocol },
        "Rejected URL with disallowed protocol in plain-text email",
      );
      return "#";
    }
    return url;
  } catch {
    getLogger().warn({ url }, "Rejected invalid URL in plain-text email");
    return "#";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders a complete email in both HTML and plain-text formats.
 *
 * All styles are inline (no `<style>` block) for Outlook compatibility.
 * Max width: 600px. Primary colour: indigo (#6366f1).
 *
 * @param tr - Optional translation function for i18n footer strings.
 *   When omitted (e.g. in tests), falls back to hardcoded English.
 */
export function renderLayout(
  slots: LayoutSlots,
  config: LayoutConfig,
  tr?: TranslationFn,
): LayoutOutput {
  return {
    html: renderHtml(slots, config, tr),
    text: renderText(slots, config, tr),
  };
}

// ─── HTML renderer ────────────────────────────────────────────────────────────

function renderHtml(slots: LayoutSlots, config: LayoutConfig, tr?: TranslationFn): string {
  const safeAppName = escapeHtml(config.appName);
  const safeSubtitle = escapeHtml(slots.subtitle);
  const lang = config.locale ?? "en";

  // Footer i18n — use translation function when available, fall back to English
  const footerSentBy = tr
    ? tr("common.footer", { appName: safeAppName })
    : `This email was sent by <strong>${safeAppName}</strong>`;
  const footerIgnore = tr
    ? tr("common.footerIgnore")
    : "If you didn't expect this email, you can safely ignore it.";
  const footerPoweredBy = tr ? tr("common.poweredBy") : "Powered by Ouitransfer";
  const footerUnsubscribe = tr ? tr("common.unsubscribe") : "Unsubscribe from these notifications";

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>${safeAppName}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.bodyBg};font-family:${FONT_STACK};color:${COLOR.textPrimary};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLOR.bodyBg};padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${COLOR.cardBg};border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background-color:${COLOR.indigo};padding:32px 24px;text-align:center;">
              <h1 style="margin:0;color:${COLOR.white};font-size:26px;font-weight:700;letter-spacing:-0.5px;font-family:${FONT_STACK};">${safeAppName}</h1>
              <p style="margin:6px 0 0 0;color:${COLOR.white};font-size:15px;opacity:0.9;font-family:${FONT_STACK};">${safeSubtitle}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 32px;background-color:${COLOR.cardBg};">
              <div style="font-size:15px;line-height:1.7;color:${COLOR.textPrimary};font-family:${FONT_STACK};">
                <!-- SAFETY: slots.body is pre-escaped — template renders use tHtml() which HTML-escapes
                     all interpolated values. Do NOT inject raw user strings into body without escaping. -->
                ${nlToBr(slots.body)}
              </div>
              ${slots.cta ? renderCtaHtml(slots.cta) : ""}
              ${slots.infoBox ? renderInfoBoxHtml(slots.infoBox) : ""}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:${COLOR.infoBg};padding:24px 32px;text-align:center;border-top:1px solid ${COLOR.border};">
              <p style="margin:0;color:${COLOR.textSecondary};font-size:13px;font-family:${FONT_STACK};">
                ${footerSentBy}
              </p>
              <p style="margin:6px 0 0 0;color:${COLOR.textMuted};font-size:12px;font-family:${FONT_STACK};">
                ${footerIgnore}
              </p>
              ${slots.unsubscribeUrl ? renderUnsubscribeHtml(slots.unsubscribeUrl, footerUnsubscribe) : ""}
              <p style="margin:8px 0 0 0;color:${COLOR.textMuted};font-size:11px;font-family:${FONT_STACK};">
                <a href="https://github.com/slvnlrt/ouitransfer" style="color:${COLOR.textMuted};text-decoration:none;">${footerPoweredBy}</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function renderCtaHtml(cta: { url: string; label: string }): string {
  const safeLabel = escapeHtml(cta.label);
  const safeUrl = safeHref(cta.url);
  return `
               <div style="text-align:center;margin:32px 0;">
                 <a href="${safeUrl}" style="display:inline-block;background-color:${COLOR.indigo};color:${COLOR.white};text-decoration:none;padding:13px 28px;font-weight:600;font-size:15px;border-radius:6px;font-family:${FONT_STACK};">${safeLabel}</a>
               </div>`;
}

function renderInfoBoxHtml(content: string): string {
  return `
              <div style="background-color:${COLOR.infoBg};border-left:4px solid ${COLOR.indigo};padding:16px 20px;margin-top:28px;border-radius:0 4px 4px 0;">
                <p style="margin:0;color:${COLOR.textSecondary};font-size:14px;line-height:1.6;font-family:${FONT_STACK};">${content}</p>
              </div>`;
}

function renderUnsubscribeHtml(url: string, label: string): string {
  const safeUrl = safeHref(url);
  return `
               <p style="margin:8px 0 0 0;color:${COLOR.textMuted};font-size:12px;font-family:${FONT_STACK};">
                 <a href="${safeUrl}" style="color:${COLOR.textMuted};text-decoration:underline;">${label}</a>
               </p>`;
}

// ─── Plain-text renderer ──────────────────────────────────────────────────────

/**
 * Generates a plain-text version of the email by stripping HTML tags,
 * then applying minimal formatting (indentation, separators).
 */
function renderText(slots: LayoutSlots, config: LayoutConfig, tr?: TranslationFn): string {
  const lines: string[] = [];

  // Footer i18n — strip HTML from translated strings for plain text
  const footerSentBy = tr
    ? stripHtml(tr("common.footer", { appName: config.appName }))
    : `This email was sent by ${config.appName}`;
  const footerIgnore = tr
    ? tr("common.footerIgnore")
    : "If you didn't expect this email, you can safely ignore it.";
  const footerPoweredBy = tr ? tr("common.poweredBy") : "Powered by Ouitransfer";

  // Header
  lines.push(`${config.appName}`);
  lines.push(`${slots.subtitle}`);
  lines.push("─".repeat(60));
  lines.push("");

  // Body (strip HTML tags)
  const bodyText = stripHtml(slots.body);
  lines.push(bodyText);
  lines.push("");

  // CTA
  if (slots.cta) {
    lines.push(`${slots.cta.label}: ${safeTextUrl(slots.cta.url)}`);
    lines.push("");
  }

  // Info box
  if (slots.infoBox) {
    lines.push(`  ${stripHtml(slots.infoBox)}`);
    lines.push("");
  }

  // Footer
  lines.push("─".repeat(60));
  lines.push(footerSentBy);
  lines.push(footerIgnore);

  if (slots.unsubscribeUrl) {
    const unsubLabel = tr ? tr("common.unsubscribe") : "Unsubscribe";
    lines.push(`${unsubLabel}: ${safeTextUrl(slots.unsubscribeUrl)}`);
  }

  lines.push(`${footerPoweredBy} — https://github.com/slvnlrt/ouitransfer`);

  return lines.join("\n");
}

/**
 * Removes all HTML tags from a string and collapses whitespace.
 * Also converts `<br>` / `<br />` to newlines before stripping.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
