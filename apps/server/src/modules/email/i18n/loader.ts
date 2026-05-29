import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml } from "../../../utils/escape-html.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TranslationFn = (dotPath: string, params?: Record<string, string>) => string;

// ─── Module-level state ───────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(__dirname, "messages");

/** In-memory cache: locale → parsed JSON object. Populated lazily on first use. */
const cache = new Map<string, Record<string, unknown>>();

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Translate a dot-separated key for the given locale.
 * Values are interpolated **without** HTML escaping — suitable for
 * plain-text contexts (email subjects, logs, etc.).
 *
 * Fallback chain:
 *   1. Requested locale
 *   2. English ("en")
 *   3. Throw — a key missing from en.json is a developer bug
 *
 * Interpolation: replaces `{key}` placeholders with values from `params`.
 */
export function t(locale: string, dotPath: string, params?: Record<string, string>): string {
  return resolveAndInterpolate(locale, dotPath, params, false);
}

/**
 * Translate a dot-separated key for the given locale, **HTML-escaping** all
 * interpolated values. Use this for any string that will be embedded inside
 * an HTML email body.
 *
 * The HTML markup in the locale template itself (e.g. `<strong>`) is preserved;
 * only the substituted *values* are escaped.
 */
export function tHtml(locale: string, dotPath: string, params?: Record<string, string>): string {
  return resolveAndInterpolate(locale, dotPath, params, true);
}

/**
 * Returns a curried translation function bound to a specific locale.
 * **HTML-escapes** all interpolated values — designed for email body templates.
 *
 * @example
 * const tr = createTranslationFn("fr");
 * tr("common.footer", { appName: "Acme" }); // Acme is HTML-escaped
 */
export function createTranslationFn(locale: string): TranslationFn {
  return (dotPath: string, params?: Record<string, string>) => tHtml(locale, dotPath, params);
}

/**
 * Returns a curried translation function bound to a specific locale.
 * Does **not** HTML-escape values — suitable for plain-text contexts
 * (email subjects, plain-text body, etc.).
 */
export function createPlainTranslationFn(locale: string): TranslationFn {
  return (dotPath: string, params?: Record<string, string>) => t(locale, dotPath, params);
}

/**
 * Validates that all supplied keys exist in en.json.
 * Call this at startup (or in tests) to catch missing translations early.
 *
 * @throws Error listing all missing keys.
 */
export function validateI18nKeys(requiredKeys: string[]): void {
  const enMessages = loadLocale("en");
  if (enMessages === null) {
    throw new Error("[i18n] Could not load en.json for validation");
  }

  const missing = requiredKeys.filter((key) => resolvePath(enMessages, key) === undefined);

  if (missing.length > 0) {
    throw new Error(
      `[i18n] Missing translation keys in en.json: ${missing.map((k) => `"${k}"`).join(", ")}`,
    );
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Core resolve-and-interpolate implementation shared by `t()` and `tHtml()`.
 */
function resolveAndInterpolate(
  locale: string,
  dotPath: string,
  params: Record<string, string> | undefined,
  htmlEscape: boolean,
): string {
  // Try the requested locale first
  const localeMessages = loadLocale(locale);
  const localeValue = localeMessages !== null ? resolvePath(localeMessages, dotPath) : undefined;

  if (localeValue !== undefined) {
    return interpolate(localeValue, params, htmlEscape);
  }

  // Fall back to English
  const enMessages = loadLocale("en");
  if (enMessages === null) {
    throw new Error(`[i18n] Could not load en.json (messages directory not found)`);
  }

  const enValue = resolvePath(enMessages, dotPath);
  if (enValue === undefined) {
    throw new Error(
      `[i18n] Missing translation key "${dotPath}" in en.json — this is a bug, add the key`,
    );
  }

  return interpolate(enValue, params, htmlEscape);
}

/**
 * Loads and caches the JSON messages file for the given locale.
 * Returns `null` if the file does not exist (caller handles fallback).
 */
function loadLocale(locale: string): Record<string, unknown> | null {
  if (cache.has(locale)) {
    return cache.get(locale) as Record<string, unknown>;
  }

  const filePath = path.join(messagesDir, `${locale}.json`);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  cache.set(locale, parsed);
  return parsed;
}

/**
 * Traverses a nested object following a dot-separated path.
 * Returns the string value at that path, or `undefined` if not found.
 */
function resolvePath(obj: Record<string, unknown>, dotPath: string): string | undefined {
  const parts = dotPath.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in (current as object))) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (typeof current !== "string") {
    return undefined;
  }

  return current;
}

/**
 * Replaces `{key}` placeholders in a template string with values from params.
 * Unknown placeholders (no matching param key) are left as-is.
 *
 * When `escape` is true, each substituted value is HTML-escaped before
 * insertion. This protects against XSS when user-controlled data flows
 * into HTML email templates.
 */
function interpolate(
  template: string,
  params: Record<string, string> | undefined,
  htmlEscape: boolean,
): string {
  if (!params || Object.keys(params).length === 0) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    if (!(key in params)) return match;
    const value = params[key];
    return htmlEscape ? escapeHtml(value) : value;
  });
}

/**
 * Clears the in-memory locale cache.
 * Useful in tests to ensure a clean state between test runs.
 */
export function clearLocaleCache(): void {
  cache.clear();
}
