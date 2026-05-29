import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ─────────────────────────────────────────────────────────────────────
// We mock the node:fs module so tests are hermetic (no real file I/O).

vi.mock("node:fs");

// Use real escapeHtml — it's a pure function, no I/O
vi.mock("../../../utils/escape-html.js", async () => {
  return {
    escapeHtml: (str: string) =>
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;"),
  };
});

const mockedFs = vi.mocked(fs);

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const EN_MESSAGES = {
  common: {
    footer: "This email was sent by <strong>{appName}</strong>",
    footerIgnore: "If you didn't expect this email, you can safely ignore it.",
    poweredBy: "Powered by Ouitransfer",
    unsubscribe: "Unsubscribe from these notifications",
  },
  shareInvitation: {
    subject: "You have received a share from {senderName}",
  },
};

const FR_MESSAGES = {
  common: {
    footer: "Cet e-mail a été envoyé par <strong>{appName}</strong>",
    footerIgnore: "Si vous n'attendiez pas cet e-mail, vous pouvez l'ignorer en toute sécurité.",
    poweredBy: "Propulsé par Ouitransfer",
    unsubscribe: "Se désabonner de ces notifications",
  },
};

// biome-ignore lint/suspicious/noExplicitAny: needed for flexible path matching in mock
type AnyArgs = any[];

/** Sets up fs mocks so the loader can read specific locale files. */
function setupFsMocks(locales: Record<string, object>) {
  mockedFs.existsSync.mockImplementation((...args: AnyArgs) => {
    const filePath = args[0] as string;
    const locale = path.basename(filePath, ".json");
    return locale in locales;
  });

  mockedFs.readFileSync.mockImplementation((...args: AnyArgs) => {
    const filePath = args[0] as string;
    const locale = path.basename(filePath, ".json");
    if (locale in locales) {
      return JSON.stringify(locales[locale as keyof typeof locales]);
    }
    throw new Error(`ENOENT: no such file: ${filePath}`);
  });
}

// ─── Imports (after mocks) ─────────────────────────────────────────────────────
// Import after vi.mock() so the module receives the mocked fs.

import {
  clearLocaleCache,
  createPlainTranslationFn,
  createTranslationFn,
  t,
  tHtml,
  validateI18nKeys,
} from "../i18n/loader.js";

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("i18n loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearLocaleCache();
  });

  afterEach(() => {
    clearLocaleCache();
  });

  // ── Basic translation ───────────────────────────────────────────────────────

  it("t('en', 'common.footer', { appName: 'Test' }) interpolates correctly", () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = t("en", "common.footer", { appName: "Test" });

    expect(result).toBe("This email was sent by <strong>Test</strong>");
  });

  it("t('fr', 'common.footer', { appName: 'Test' }) returns French text", () => {
    setupFsMocks({ en: EN_MESSAGES, fr: FR_MESSAGES });

    const result = t("fr", "common.footer", { appName: "Test" });

    expect(result).toBe("Cet e-mail a été envoyé par <strong>Test</strong>");
  });

  it("t('de', ...) falls back to en when de.json lacks the key", () => {
    // de.json does not exist in our mock
    setupFsMocks({ en: EN_MESSAGES });

    const result = t("de", "common.footer", { appName: "Acme" });

    // Should return the English translation
    expect(result).toBe("This email was sent by <strong>Acme</strong>");
  });

  it("t('en', 'nonexistent.key') throws Error (missing in en = bug)", () => {
    setupFsMocks({ en: EN_MESSAGES });

    expect(() => t("en", "nonexistent.key")).toThrowError(
      /Missing translation key "nonexistent.key"/,
    );
  });

  it("handles nested paths ('shareInvitation.subject')", () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = t("en", "shareInvitation.subject", { senderName: "Alice" });

    expect(result).toBe("You have received a share from Alice");
  });

  it("returns raw template when no params provided", () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = t("en", "common.footerIgnore");

    expect(result).toBe("If you didn't expect this email, you can safely ignore it.");
  });

  it("returns raw template with unresolved placeholders when params is empty", () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = t("en", "common.footer");

    // No params → placeholders remain as-is
    expect(result).toBe("This email was sent by <strong>{appName}</strong>");
  });

  // ── createTranslationFn (HTML-escaping) ─────────────────────────────────────

  it("createTranslationFn(locale) returns a curried function that HTML-escapes values", () => {
    setupFsMocks({ en: EN_MESSAGES, fr: FR_MESSAGES });

    const tr = createTranslationFn("fr");
    const result = tr("common.footer", { appName: "Acme" });

    expect(result).toBe("Cet e-mail a été envoyé par <strong>Acme</strong>");
  });

  it("createTranslationFn HTML-escapes user-controlled values (XSS prevention)", () => {
    setupFsMocks({ en: EN_MESSAGES });

    const tr = createTranslationFn("en");
    const result = tr("shareInvitation.subject", {
      senderName: '<script>alert("xss")</script>',
    });

    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("createTranslationFn falls back to en for missing keys in locale", () => {
    // FR_MESSAGES does not have shareInvitation.subject
    setupFsMocks({ en: EN_MESSAGES, fr: FR_MESSAGES });

    const tr = createTranslationFn("fr");
    const result = tr("shareInvitation.subject", { senderName: "Bob" });

    expect(result).toBe("You have received a share from Bob");
  });

  // ── createPlainTranslationFn (no escaping) ─────────────────────────────────

  it("createPlainTranslationFn does NOT HTML-escape values", () => {
    setupFsMocks({ en: EN_MESSAGES });

    const tr = createPlainTranslationFn("en");
    const result = tr("shareInvitation.subject", {
      senderName: '<script>alert("xss")</script>',
    });

    expect(result).toContain('<script>alert("xss")</script>');
  });

  // ── tHtml ──────────────────────────────────────────────────────────────────

  it("tHtml HTML-escapes interpolated values", () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = tHtml("en", "shareInvitation.subject", {
      senderName: "<b>Evil</b>",
    });

    expect(result).not.toContain("<b>Evil</b>");
    expect(result).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  });

  it("tHtml preserves template HTML (e.g. <strong> tags from locale file)", () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = tHtml("en", "common.footer", { appName: "Safe&Co" });

    // Template <strong> tags are preserved
    expect(result).toContain("<strong>");
    // But the interpolated value is escaped
    expect(result).toContain("Safe&amp;Co");
  });

  // ── validateI18nKeys ────────────────────────────────────────────────────────

  it("validateI18nKeys([...]) passes when all keys exist in en.json", () => {
    setupFsMocks({ en: EN_MESSAGES });

    expect(() =>
      validateI18nKeys(["common.footer", "common.footerIgnore", "common.poweredBy"]),
    ).not.toThrow();
  });

  it("validateI18nKeys([...]) throws when any key is missing", () => {
    setupFsMocks({ en: EN_MESSAGES });

    expect(() =>
      validateI18nKeys(["common.footer", "missing.key", "another.missing"]),
    ).toThrowError(/Missing translation keys in en.json.*"missing.key".*"another.missing"/s);
  });

  // ── Caching ─────────────────────────────────────────────────────────────────

  it("caches loaded locale files (second call doesn't re-read)", () => {
    setupFsMocks({ en: EN_MESSAGES });

    t("en", "common.footer", { appName: "A" });
    t("en", "common.footerIgnore");
    t("en", "common.poweredBy");

    // fs.readFileSync should have been called only once for en.json
    expect(mockedFs.readFileSync).toHaveBeenCalledTimes(1);
  });

  it("caches different locales independently", () => {
    setupFsMocks({ en: EN_MESSAGES, fr: FR_MESSAGES });

    t("en", "common.footer", { appName: "A" });
    t("fr", "common.footer", { appName: "B" });
    t("en", "common.footerIgnore");
    t("fr", "common.poweredBy");

    // One read per locale
    expect(mockedFs.readFileSync).toHaveBeenCalledTimes(2);
  });
});
