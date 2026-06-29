import { describe, expect, it } from "vitest";

import {
  DEFAULT_UI_LOCALE,
  isSupportedUiLocale,
  resolveUiLocaleFromAcceptLanguage,
  SUPPORTED_UI_LOCALES,
} from "../locales.js";

describe("SUPPORTED_UI_LOCALES", () => {
  it("ships the expected canonical set", () => {
    expect(SUPPORTED_UI_LOCALES).toContain("en-US");
    expect(SUPPORTED_UI_LOCALES).toContain("fr-FR");
    expect(SUPPORTED_UI_LOCALES.length).toBe(23);
  });

  it("contains only well-formed language-REGION tags (region doubles as flag code)", () => {
    for (const locale of SUPPORTED_UI_LOCALES) {
      expect(locale).toMatch(/^[a-z]{2}-[A-Z]{2}$/);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(SUPPORTED_UI_LOCALES).size).toBe(SUPPORTED_UI_LOCALES.length);
  });

  it("uses a supported locale as the default", () => {
    expect(isSupportedUiLocale(DEFAULT_UI_LOCALE)).toBe(true);
  });
});

describe("isSupportedUiLocale", () => {
  it("accepts supported locales", () => {
    expect(isSupportedUiLocale("fr-FR")).toBe(true);
    expect(isSupportedUiLocale("en-US")).toBe(true);
  });

  it("rejects unsupported / malformed values", () => {
    expect(isSupportedUiLocale("fr")).toBe(false); // base language is not a UI locale
    expect(isSupportedUiLocale("xx-XX")).toBe(false);
    expect(isSupportedUiLocale("")).toBe(false);
    expect(isSupportedUiLocale(undefined)).toBe(false);
    expect(isSupportedUiLocale(42)).toBe(false);
  });
});

describe("resolveUiLocaleFromAcceptLanguage", () => {
  it("matches an exact tag (case-insensitive)", () => {
    expect(resolveUiLocaleFromAcceptLanguage("fr-FR")).toBe("fr-FR");
    expect(resolveUiLocaleFromAcceptLanguage("FR-fr")).toBe("fr-FR");
  });

  it("falls back to a base-language match for other regions", () => {
    expect(resolveUiLocaleFromAcceptLanguage("fr-CA")).toBe("fr-FR");
    expect(resolveUiLocaleFromAcceptLanguage("fr")).toBe("fr-FR");
    expect(resolveUiLocaleFromAcceptLanguage("en-GB")).toBe("en-US");
  });

  it("honours q-value ordering over list order", () => {
    expect(resolveUiLocaleFromAcceptLanguage("de;q=0.9, fr-FR;q=1.0")).toBe("fr-FR");
    expect(resolveUiLocaleFromAcceptLanguage("xx, fr;q=0.5, de;q=0.8")).toBe("de-DE");
  });

  it("ignores explicitly-rejected ranges (q=0 means not acceptable)", () => {
    expect(resolveUiLocaleFromAcceptLanguage("fr-FR;q=0")).toBeUndefined();
    // q=0 on the higher-listed range must not win; the acceptable one does.
    expect(resolveUiLocaleFromAcceptLanguage("fr-FR;q=0, de-DE;q=0.5")).toBe("de-DE");
  });

  it("returns undefined when nothing matches", () => {
    expect(resolveUiLocaleFromAcceptLanguage("xx-XX, zz")).toBeUndefined();
    expect(resolveUiLocaleFromAcceptLanguage("")).toBeUndefined();
  });
});
