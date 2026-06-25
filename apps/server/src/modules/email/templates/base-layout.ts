import { escapeHtml } from "../../../utils/escape-html.js";
import { getLogger } from "../../../utils/logger.js";
import { EMAIL_LOGO_CID } from "../assets/logo.js";
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
  /**
   * Visual variant. `"hero"` renders a larger, glowing brand header — reserved
   * for high-impact emails (e.g. welcome). Defaults to the sober `"default"`
   * header used by transactional/service emails.
   */
  variant?: "default" | "hero";
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

// ─── Colours / tokens (inline, Outlook-safe, light theme + brand header) ─────
// Light, readable body (white card on a soft grey page) that renders
// predictably across all clients (no dark-mode wash-out), topped by a vivid
// indigo→violet→blue brand-gradient header for impact. The gradient degrades to
// a solid indigo (`brandVia` = #6366f1) on clients that ignore CSS gradients
// (Outlook/Word). Header text/logo are white; body text is dark.

const COLOR = {
  brandFrom: "#8b5cf6", // violet
  brandVia: "#6366f1", // indigo (solid fallback for the gradient)
  brandTo: "#3b82f6", // blue
  indigo: "#6366f1",
  indigoText: "#4f46e5", // indigo dark enough to read on white (links/accents)
  white: "#ffffff",
  pageBg: "#eef0f6", // soft grey page background around the card
  cardBg: "#ffffff", // white card
  headerText: "#ffffff", // text/logo on the gradient header
  headerSubtitle: "rgba(255,255,255,0.88)",
  headerDivider: "rgba(255,255,255,0.55)",
  textPrimary: "#1b1b2b",
  textBody: "#3f3f4e",
  textSecondary: "#6b6b78",
  textMuted: "#9a9aab",
  border: "#e7e7f0",
  infoBg: "rgba(99,102,241,0.08)",
} as const;

/** The brand gradient, used on the accent bar, hero glow, and CTA button. */
const BRAND_GRADIENT = `linear-gradient(120deg, ${COLOR.brandFrom}, ${COLOR.brandVia} 50%, ${COLOR.brandTo})`;

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
 * Validates a URL scheme and HTML-escapes it for safe use in `href`/`src`
 * attributes. Only allows `http:`, `https:`, and `mailto:` schemes. Returns
 * `"#"` for invalid URLs or dangerous schemes (e.g., `javascript:`), and logs a
 * warning so the operator can detect misconfigured URLs (e.g. wrong appUrl).
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

/**
 * Build the brand logo `<img>` for the header. The logo (a white paper-plane on
 * a transparent background) is attached inline at send time and referenced by
 * Content-ID, so it always renders — no dependency on a public `appUrl`, remote
 * image loading, or auth on the asset path. `size` is the rendered square in px.
 */
function renderLogoImg(appName: string, size: number): string {
  const alt = escapeHtml(appName);
  return `<img src="cid:${EMAIL_LOGO_CID}" width="${size}" height="${size}" alt="${alt}" style="display:block;border:0;margin:0 auto;" />`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Renders a complete email in both HTML and plain-text formats.
 *
 * All styles are inline (no `<style>` block) for Outlook compatibility.
 * Max width: 600px. Light theme with a brand-gradient header; the gradient
 * degrades to solid indigo on clients that ignore CSS gradients.
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
  const footerPoweredBy = tr
    ? tr("common.poweredBy", { appName: safeAppName })
    : `Powered by ${safeAppName}`;
  const footerUnsubscribe = tr ? tr("common.unsubscribe") : "Unsubscribe from these notifications";

  const header =
    slots.variant === "hero"
      ? renderHeroHeader(safeAppName, safeSubtitle)
      : renderDefaultHeader(safeAppName, safeSubtitle);

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${safeAppName}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.pageBg};font-family:${FONT_STACK};color:${COLOR.textPrimary};">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLOR.pageBg};padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${COLOR.cardBg};border-radius:16px;overflow:hidden;border:1px solid ${COLOR.border};box-shadow:0 8px 30px rgba(17,17,40,0.10);">

          ${header}

          <!-- Body -->
          <tr>
            <td style="padding:28px 40px 8px;background-color:${COLOR.cardBg};">
              <div style="font-size:15px;line-height:1.7;color:${COLOR.textBody};font-family:${FONT_STACK};">
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
            <td style="background-color:${COLOR.cardBg};padding:28px 40px 36px;text-align:center;border-top:1px solid ${COLOR.border};">
              <p style="margin:0;color:${COLOR.textSecondary};font-size:13px;line-height:1.5;font-family:${FONT_STACK};">
                ${footerSentBy}
              </p>
              <p style="margin:4px 0 0 0;color:${COLOR.textMuted};font-size:12px;line-height:1.5;font-family:${FONT_STACK};">
                ${footerIgnore}
              </p>
              ${slots.unsubscribeUrl ? renderUnsubscribeHtml(slots.unsubscribeUrl, footerUnsubscribe) : ""}
              <p style="margin:16px 0 0 0;color:${COLOR.textMuted};font-size:11px;font-family:${FONT_STACK};">
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

/**
 * Sober header (transactional / service emails): the brand-gradient block with
 * the white logo, wordmark and subtitle. Solid indigo fallback on Outlook.
 */
function renderDefaultHeader(safeAppName: string, safeSubtitle: string): string {
  const logo = renderLogoImg(safeAppName, 44);
  return `
          <tr>
            <td style="padding:32px 40px;text-align:center;background-color:${COLOR.brandVia};background-image:${BRAND_GRADIENT};">
              <div style="margin:0 0 12px;">${logo}</div>
              <h1 style="margin:0;color:${COLOR.headerText};font-size:22px;font-weight:700;letter-spacing:-0.3px;font-family:${FONT_STACK};">${safeAppName}</h1>
              <p style="margin:6px 0 0 0;color:${COLOR.headerSubtitle};font-size:14px;font-weight:500;font-family:${FONT_STACK};">${safeSubtitle}</p>
            </td>
          </tr>`;
}

/**
 * High-impact "hero" header (welcome): a taller brand-gradient block with a
 * larger white logo, oversized wordmark, an accent tagline, and a soft white
 * divider. Solid indigo fallback on Outlook.
 */
function renderHeroHeader(safeAppName: string, safeSubtitle: string): string {
  const logo = renderLogoImg(safeAppName, 68);
  return `
          <tr>
            <td style="padding:48px 40px 44px;text-align:center;background-color:${COLOR.brandVia};background-image:${BRAND_GRADIENT};">
              <div style="margin:0 0 18px;">${logo}</div>
              <h1 style="margin:0;color:${COLOR.headerText};font-size:30px;font-weight:800;letter-spacing:-0.6px;font-family:${FONT_STACK};">${safeAppName}</h1>
              <p style="margin:10px 0 0 0;color:${COLOR.headerSubtitle};font-size:15px;font-weight:600;font-family:${FONT_STACK};">${safeSubtitle}</p>
              <div style="width:64px;height:3px;margin:22px auto 0;border-radius:3px;background-color:${COLOR.headerDivider};font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>`;
}

function renderCtaHtml(cta: { url: string; label: string }): string {
  const safeLabel = escapeHtml(cta.label);
  const safeUrl = safeHref(cta.url);
  // Solid indigo background + gradient overlay: Outlook shows the solid indigo,
  // gradient-capable clients show the brand gradient.
  return `
               <div style="text-align:center;margin:32px 0 8px;">
                 <a href="${safeUrl}" style="display:inline-block;background-color:${COLOR.brandVia};background-image:${BRAND_GRADIENT};color:${COLOR.white};text-decoration:none;padding:13px 30px;font-weight:600;font-size:15px;border-radius:10px;font-family:${FONT_STACK};box-shadow:0 6px 18px rgba(99,102,241,0.35);">${safeLabel}</a>
               </div>`;
}

function renderInfoBoxHtml(content: string): string {
  return `
              <div style="background-color:${COLOR.infoBg};border-left:4px solid ${COLOR.indigo};padding:14px 18px;margin-top:28px;border-radius:0 8px 8px 0;">
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
  const footerPoweredBy = tr
    ? tr("common.poweredBy", { appName: config.appName })
    : `Powered by ${config.appName}`;

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

  lines.push(footerPoweredBy);
  lines.push("https://github.com/slvnlrt/ouitransfer");

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
