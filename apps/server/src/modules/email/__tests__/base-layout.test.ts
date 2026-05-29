import { describe, expect, it } from "vitest";
import type { TranslationFn } from "../i18n/loader.js";
import { renderLayout } from "../templates/base-layout.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Mock translation function that returns the same strings as the fallback English */
const mockTr: TranslationFn = (path, params) => {
  const strings: Record<string, string> = {
    "common.footer": "Sent by <strong>{appName}</strong>",
    "common.footerIgnore": "If you didn't expect this, ignore it.",
    "common.poweredBy": "Powered by Ouitransfer",
    "common.unsubscribe": "Unsubscribe from these notifications",
  };
  let result = strings[path] ?? `[${path}]`;
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      result = result.replace(`{${key}}`, value);
    }
  }
  return result;
};

const DEFAULT_CONFIG = { appName: "Ouitransfer" };

const DEFAULT_SLOTS = {
  subtitle: "Shared Files",
  body: "<p>Hello, someone shared files with you.</p>",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("renderLayout", () => {
  // ── HTML structure ──────────────────────────────────────────────────────────

  it("renders HTML with indigo header containing appName and subtitle", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    // Header should have the indigo background colour
    expect(html).toContain("background-color:#6366f1");
    // App name and subtitle should appear in the header area
    expect(html).toContain("Ouitransfer");
    expect(html).toContain("Shared Files");
  });

  it("renders body content in the HTML body section", () => {
    const { html } = renderLayout(
      { ...DEFAULT_SLOTS, body: "<p>Custom body content here.</p>" },
      DEFAULT_CONFIG,
    );

    expect(html).toContain("Custom body content here.");
  });

  it("renders CTA button when cta slot is provided", () => {
    const { html } = renderLayout(
      {
        ...DEFAULT_SLOTS,
        cta: { url: "https://example.com/download", label: "Download Files" },
      },
      DEFAULT_CONFIG,
    );

    expect(html).toContain("Download Files");
    expect(html).toContain("https://example.com/download");
    // CTA link should be styled as a button (inline-block)
    expect(html).toContain("display:inline-block");
  });

  it("omits CTA button when cta slot is not provided", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    // No href with example.com (no CTA added)
    expect(html).not.toContain("display:inline-block");
  });

  it("renders info box when infoBox slot is provided", () => {
    const { html } = renderLayout(
      {
        ...DEFAULT_SLOTS,
        infoBox: "This share may have an expiration date.",
      },
      DEFAULT_CONFIG,
    );

    expect(html).toContain("This share may have an expiration date.");
    // Info box has left indigo border
    expect(html).toContain("border-left:4px solid #6366f1");
  });

  it("omits info box when infoBox slot is not provided", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    expect(html).not.toContain("border-left:4px solid #6366f1");
  });

  it("renders unsubscribe link in footer when unsubscribeUrl is provided", () => {
    const { html } = renderLayout(
      {
        ...DEFAULT_SLOTS,
        unsubscribeUrl: "https://example.com/unsubscribe?token=abc",
      },
      DEFAULT_CONFIG,
    );

    expect(html).toContain("https://example.com/unsubscribe?token=abc");
    expect(html).toContain("Unsubscribe from these notifications");
  });

  it("omits unsubscribe link when unsubscribeUrl is absent", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    expect(html).not.toContain("Unsubscribe from these notifications");
  });

  // ── Inline styles (Outlook safety) ─────────────────────────────────────────

  it("uses inline styles for Outlook compatibility (no style blocks)", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    expect(html).not.toContain("<style");
    expect(html).not.toContain("</style>");
  });

  it("max-width is 600px for responsive email", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    expect(html).toContain("max-width:600px");
  });

  // ── Plain text ─────────────────────────────────────────────────────────────

  it("generates plain text version with no HTML tags", () => {
    const { text } = renderLayout(
      { ...DEFAULT_SLOTS, body: "<p><strong>Hello</strong> world.</p>" },
      DEFAULT_CONFIG,
    );

    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).toContain("Hello");
    expect(text).toContain("world.");
  });

  it("plain text includes CTA as 'Label: URL' format", () => {
    const { text } = renderLayout(
      {
        ...DEFAULT_SLOTS,
        cta: { url: "https://example.com/action", label: "Click Here" },
      },
      DEFAULT_CONFIG,
    );

    expect(text).toContain("Click Here: https://example.com/action");
  });

  it("plain text strips HTML formatting from body", () => {
    const { text } = renderLayout(
      {
        ...DEFAULT_SLOTS,
        body: "<p>Hello <strong>World</strong>. <em>Welcome!</em></p>",
      },
      DEFAULT_CONFIG,
    );

    expect(text).toContain("Hello World. Welcome!");
    expect(text).not.toContain("<strong>");
    expect(text).not.toContain("<em>");
  });

  it("plain text includes appName in header", () => {
    const { text } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    // First line should be the app name
    const firstLine = text.split("\n")[0];
    expect(firstLine).toBe("Ouitransfer");
  });

  it("plain text includes subtitle after appName", () => {
    const { text } = renderLayout({ ...DEFAULT_SLOTS, subtitle: "Password Reset" }, DEFAULT_CONFIG);

    expect(text).toContain("Password Reset");
  });

  it("plain text includes unsubscribe URL when provided", () => {
    const { text } = renderLayout(
      {
        ...DEFAULT_SLOTS,
        unsubscribeUrl: "https://example.com/unsub",
      },
      DEFAULT_CONFIG,
    );

    expect(text).toContain("Unsubscribe: https://example.com/unsub");
  });

  it("plain text omits unsubscribe line when unsubscribeUrl is absent", () => {
    const { text } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    expect(text).not.toContain("Unsubscribe:");
  });

  // ── HTML lang attribute ─────────────────────────────────────────────────────

  it("uses locale for html lang attribute when provided", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, { ...DEFAULT_CONFIG, locale: "fr" });

    expect(html).toContain('<html lang="fr">');
    expect(html).not.toContain('<html lang="en">');
  });

  it("defaults html lang to 'en' when locale is not provided", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    expect(html).toContain('<html lang="en">');
  });

  // ── Footer i18n ───────────────────────────────────────────────────────────

  it("uses translation function for footer strings when provided", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG, mockTr);

    expect(html).toContain("Sent by <strong>Ouitransfer</strong>");
    expect(html).toContain("If you didn't expect this, ignore it.");
    expect(html).toContain("Powered by Ouitransfer");
  });

  it("uses hardcoded English footer strings when no translation function provided", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG);

    expect(html).toContain("This email was sent by <strong>Ouitransfer</strong>");
    expect(html).toContain("If you didn't expect this email, you can safely ignore it.");
  });

  it("uses translation function for plain text footer", () => {
    const { text } = renderLayout(DEFAULT_SLOTS, DEFAULT_CONFIG, mockTr);

    expect(text).toContain("Sent by Ouitransfer");
    expect(text).toContain("If you didn't expect this, ignore it.");
    expect(text).toContain("Powered by Ouitransfer");
  });

  it("uses translated unsubscribe label in HTML footer", () => {
    const frTr: TranslationFn = (path) => {
      const strings: Record<string, string> = {
        "common.footer": "E-mail de <strong>Ouitransfer</strong>",
        "common.footerIgnore": "Ignorer si inattendu.",
        "common.poweredBy": "Propulsé par Ouitransfer",
        "common.unsubscribe": "Se désabonner",
      };
      return strings[path] ?? `[${path}]`;
    };

    const { html } = renderLayout(
      { ...DEFAULT_SLOTS, unsubscribeUrl: "https://example.com/unsub" },
      DEFAULT_CONFIG,
      frTr,
    );

    expect(html).toContain("Se désabonner");
  });

  // ── XSS safety ─────────────────────────────────────────────────────────────

  it("escapes appName in HTML to prevent XSS", () => {
    const { html } = renderLayout(DEFAULT_SLOTS, { appName: '<script>alert("xss")</script>' });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes subtitle in HTML to prevent XSS", () => {
    const { html } = renderLayout(
      { ...DEFAULT_SLOTS, subtitle: '<img src=x onerror="alert(1)">' },
      DEFAULT_CONFIG,
    );

    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
