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

vi.mock("../../../utils/logger.js", () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

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

/** Sets up fs mocks so the loader can read specific locale files (async API). */
function setupFsMocks(locales: Record<string, object>) {
  // Mock fs.promises.access: resolves if locale exists, rejects otherwise
  mockedFs.promises = {
    ...mockedFs.promises,
    access: vi.fn().mockImplementation((...args: AnyArgs) => {
      const filePath = args[0] as string;
      const locale = path.basename(filePath, ".json");
      if (locale in locales) {
        return Promise.resolve();
      }
      return Promise.reject(new Error(`ENOENT: no such file: ${filePath}`));
    }),
    readFile: vi.fn().mockImplementation((...args: AnyArgs) => {
      const filePath = args[0] as string;
      const locale = path.basename(filePath, ".json");
      if (locale in locales) {
        return Promise.resolve(JSON.stringify(locales[locale as keyof typeof locales]));
      }
      return Promise.reject(new Error(`ENOENT: no such file: ${filePath}`));
    }),
  } as typeof fs.promises;
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

  it("t('en', 'common.footer', { appName: 'Test' }) interpolates correctly", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = await t("en", "common.footer", { appName: "Test" });

    expect(result).toBe("This email was sent by <strong>Test</strong>");
  });

  it("t('fr', 'common.footer', { appName: 'Test' }) returns French text", async () => {
    setupFsMocks({ en: EN_MESSAGES, fr: FR_MESSAGES });

    const result = await t("fr", "common.footer", { appName: "Test" });

    expect(result).toBe("Cet e-mail a été envoyé par <strong>Test</strong>");
  });

  it("t('de', ...) falls back to en when de.json lacks the key", async () => {
    // de.json does not exist in our mock
    setupFsMocks({ en: EN_MESSAGES });

    const result = await t("de", "common.footer", { appName: "Acme" });

    // Should return the English translation
    expect(result).toBe("This email was sent by <strong>Acme</strong>");
  });

  it("t('en', 'nonexistent.key') throws Error (missing in en = bug)", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    await expect(t("en", "nonexistent.key")).rejects.toThrowError(
      /Missing translation key "nonexistent.key"/,
    );
  });

  it("handles nested paths ('shareInvitation.subject')", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = await t("en", "shareInvitation.subject", { senderName: "Alice" });

    expect(result).toBe("You have received a share from Alice");
  });

  it("returns raw template when no params provided", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = await t("en", "common.footerIgnore");

    expect(result).toBe("If you didn't expect this email, you can safely ignore it.");
  });

  it("returns raw template with unresolved placeholders when params is empty", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = await t("en", "common.footer");

    // No params → placeholders remain as-is
    expect(result).toBe("This email was sent by <strong>{appName}</strong>");
  });

  // ── createTranslationFn (HTML-escaping) ─────────────────────────────────────

  it("createTranslationFn(locale) returns a curried function that HTML-escapes values", async () => {
    setupFsMocks({ en: EN_MESSAGES, fr: FR_MESSAGES });

    const tr = await createTranslationFn("fr");
    const result = tr("common.footer", { appName: "Acme" });

    expect(result).toBe("Cet e-mail a été envoyé par <strong>Acme</strong>");
  });

  it("createTranslationFn HTML-escapes user-controlled values (XSS prevention)", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    const tr = await createTranslationFn("en");
    const result = tr("shareInvitation.subject", {
      senderName: '<script>alert("xss")</script>',
    });

    expect(result).not.toContain("<script>");
    expect(result).toContain("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;");
  });

  it("createTranslationFn falls back to en for missing keys in locale", async () => {
    // FR_MESSAGES does not have shareInvitation.subject
    setupFsMocks({ en: EN_MESSAGES, fr: FR_MESSAGES });

    const tr = await createTranslationFn("fr");
    const result = tr("shareInvitation.subject", { senderName: "Bob" });

    expect(result).toBe("You have received a share from Bob");
  });

  // ── createPlainTranslationFn (no escaping) ─────────────────────────────────

  it("createPlainTranslationFn does NOT HTML-escape values", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    const tr = await createPlainTranslationFn("en");
    const result = tr("shareInvitation.subject", {
      senderName: '<script>alert("xss")</script>',
    });

    expect(result).toContain('<script>alert("xss")</script>');
  });

  // ── tHtml ──────────────────────────────────────────────────────────────────

  it("tHtml HTML-escapes interpolated values", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = await tHtml("en", "shareInvitation.subject", {
      senderName: "<b>Evil</b>",
    });

    expect(result).not.toContain("<b>Evil</b>");
    expect(result).toContain("&lt;b&gt;Evil&lt;/b&gt;");
  });

  it("tHtml preserves template HTML (e.g. <strong> tags from locale file)", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    const result = await tHtml("en", "common.footer", { appName: "Safe&Co" });

    // Template <strong> tags are preserved
    expect(result).toContain("<strong>");
    // But the interpolated value is escaped
    expect(result).toContain("Safe&amp;Co");
  });

  // ── validateI18nKeys ────────────────────────────────────────────────────────

  it("validateI18nKeys([...]) passes when all keys exist in en.json", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    await expect(
      validateI18nKeys(["common.footer", "common.footerIgnore", "common.poweredBy"]),
    ).resolves.not.toThrow();
  });

  it("validateI18nKeys([...]) throws when any key is missing", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    await expect(
      validateI18nKeys(["common.footer", "missing.key", "another.missing"]),
    ).rejects.toThrowError(
      /Missing translation keys in en.json.*"missing.key".*"another.missing"/s,
    );
  });

  // ── Path-traversal guard ─────────────────────────────────────────────────────

  it.each([
    "../../../../etc/passwd",
    "../en",
    "en/../../secret",
    "..",
    "/etc/passwd",
    "en ",
    "a".repeat(50),
  ])("rejects malformed locale %j without touching the filesystem (falls back to en)", async (loc) => {
    setupFsMocks({ en: EN_MESSAGES });

    // Falls back to en rather than attempting to read the traversal path
    const result = await t(loc, "common.footer", { appName: "Acme" });
    expect(result).toBe("This email was sent by <strong>Acme</strong>");

    // The malformed locale must never reach fs.access / fs.readFile.
    // Only en.json is ever touched.
    const accessMock = vi.mocked(mockedFs.promises.access);
    const readFileMock = vi.mocked(mockedFs.promises.readFile);
    for (const call of accessMock.mock.calls) {
      expect(path.basename(call[0] as string, ".json")).toBe("en");
    }
    for (const call of readFileMock.mock.calls) {
      expect(path.basename(call[0] as string, ".json")).toBe("en");
    }
  });

  it("accepts well-formed BCP-47 locale codes (e.g. pt-BR)", async () => {
    setupFsMocks({ en: EN_MESSAGES, "pt-BR": FR_MESSAGES });

    const result = await t("pt-BR", "common.footer", { appName: "Acme" });
    // pt-BR mock reuses FR_MESSAGES content
    expect(result).toBe("Cet e-mail a été envoyé par <strong>Acme</strong>");
  });

  // ── Caching ─────────────────────────────────────────────────────────────────

  it("caches loaded locale files (second call doesn't re-read)", async () => {
    setupFsMocks({ en: EN_MESSAGES });

    await t("en", "common.footer", { appName: "A" });
    await t("en", "common.footerIgnore");
    await t("en", "common.poweredBy");

    // fs.promises.readFile should have been called only once for en.json
    expect(mockedFs.promises.readFile).toHaveBeenCalledTimes(1);
  });

  it("caches different locales independently", async () => {
    setupFsMocks({ en: EN_MESSAGES, fr: FR_MESSAGES });

    await t("en", "common.footer", { appName: "A" });
    await t("fr", "common.footer", { appName: "B" });
    await t("en", "common.footerIgnore");
    await t("fr", "common.poweredBy");

    // One read per locale
    expect(mockedFs.promises.readFile).toHaveBeenCalledTimes(2);
  });
});
