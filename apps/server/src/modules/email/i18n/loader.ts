import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { escapeHtml } from "../../../utils/escape-html.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type TranslationFn = (dotPath: string, params?: Record<string, string>) => string;

// ─── Module-level state ───────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const messagesDir = path.join(__dirname, "messages");

/** In-memory cache: locale → resolved parsed JSON object. Populated on first load. */
const cache = new Map<string, Record<string, unknown>>();

/** In-flight promise cache: locale → pending load promise. Prevents duplicate reads. */
const inFlight = new Map<string, Promise<Record<string, unknown> | null>>();

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
export async function t(
  locale: string,
  dotPath: string,
  params?: Record<string, string>,
): Promise<string> {
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
export async function tHtml(
  locale: string,
  dotPath: string,
  params?: Record<string, string>,
): Promise<string> {
  return resolveAndInterpolate(locale, dotPath, params, true);
}

/**
 * Returns a curried translation function bound to a specific locale.
 * **HTML-escapes** all interpolated values — designed for email body templates.
 * The returned function is synchronous (locale data is pre-loaded).
 *
 * @param locale - The locale code (e.g. "fr", "en")
 * @param defaultParams - Optional default params merged into every call.
 *   Call-site params take precedence over defaults.
 *
 * @example
 * const tr = await createTranslationFn("fr", { appName: "Acme" });
 * tr("common.footer"); // appName is available without passing it explicitly
 * tr("common.footer", { appName: "Override" }); // call-site wins
 */
export async function createTranslationFn(
  locale: string,
  defaultParams?: Record<string, string>,
): Promise<TranslationFn> {
  // Pre-load both the requested locale and English fallback so the returned
  // synchronous TranslationFn can always resolve values without I/O.
  await Promise.all([loadLocale(locale), loadLocale("en")]);
  return (dotPath: string, params?: Record<string, string>) => {
    const merged = defaultParams ? { ...defaultParams, ...params } : params;
    return resolveAndInterpolateSyncCached(locale, dotPath, merged, true);
  };
}

/**
 * Returns a curried translation function bound to a specific locale.
 * Does **not** HTML-escape values — suitable for plain-text contexts
 * (email subjects, plain-text body, etc.).
 * The returned function is synchronous (locale data is pre-loaded).
 *
 * @param locale - The locale code (e.g. "fr", "en")
 * @param defaultParams - Optional default params merged into every call.
 *   Call-site params take precedence over defaults.
 */
export async function createPlainTranslationFn(
  locale: string,
  defaultParams?: Record<string, string>,
): Promise<TranslationFn> {
  await Promise.all([loadLocale(locale), loadLocale("en")]);
  return (dotPath: string, params?: Record<string, string>) => {
    const merged = defaultParams ? { ...defaultParams, ...params } : params;
    return resolveAndInterpolateSyncCached(locale, dotPath, merged, false);
  };
}

/**
 * Validates that all supplied keys exist in en.json.
 * Call this at startup (or in tests) to catch missing translations early.
 *
 * @throws Error listing all missing keys.
 */
export async function validateI18nKeys(requiredKeys: string[]): Promise<void> {
  const enMessages = await loadLocale("en");
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
 * Async core resolve-and-interpolate implementation shared by `t()` and `tHtml()`.
 */
async function resolveAndInterpolate(
  locale: string,
  dotPath: string,
  params: Record<string, string> | undefined,
  htmlEscape: boolean,
): Promise<string> {
  // Try the requested locale first
  const localeMessages = await loadLocale(locale);
  const localeValue = localeMessages !== null ? resolvePath(localeMessages, dotPath) : undefined;

  if (localeValue !== undefined) {
    return interpolate(localeValue, params, htmlEscape);
  }

  // Fall back to English
  const enMessages = await loadLocale("en");
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
 * Synchronous resolve-and-interpolate using only the in-memory cache.
 * Only safe to call after the locale data has been pre-loaded via `loadLocale`.
 * Used by the synchronous `TranslationFn` returned by `createTranslationFn`.
 */
function resolveAndInterpolateSyncCached(
  locale: string,
  dotPath: string,
  params: Record<string, string> | undefined,
  htmlEscape: boolean,
): string {
  const localeMessages = cache.get(locale) ?? null;
  const localeValue = localeMessages !== null ? resolvePath(localeMessages, dotPath) : undefined;

  if (localeValue !== undefined) {
    return interpolate(localeValue, params, htmlEscape);
  }

  const enMessages = cache.get("en") ?? null;
  if (enMessages === null) {
    throw new Error(`[i18n] en.json not in cache — was createTranslationFn awaited?`);
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
 *
 * Uses an in-flight promise deduplication pattern: if a load for the same
 * locale is already in progress, the existing promise is returned instead
 * of starting a second concurrent file read.
 */
async function loadLocale(locale: string): Promise<Record<string, unknown> | null> {
  // Already in cache — return immediately
  if (cache.has(locale)) {
    return cache.get(locale) as Record<string, unknown>;
  }

  // Already loading — return the existing in-flight promise
  if (inFlight.has(locale)) {
    return inFlight.get(locale) as Promise<Record<string, unknown> | null>;
  }

  const filePath = path.join(messagesDir, `${locale}.json`);

  const promise = (async (): Promise<Record<string, unknown> | null> => {
    try {
      await fs.promises.access(filePath);
    } catch {
      // File does not exist — cache a sentinel so we don't retry every call
      inFlight.delete(locale);
      return null;
    }

    const raw = await fs.promises.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    cache.set(locale, parsed);
    inFlight.delete(locale);
    return parsed;
  })();

  inFlight.set(locale, promise);
  return promise;
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
 *
 * **Constraint**: Keys must be camelCase identifiers (`\w+` only).
 * Hyphenated keys (`{name-with-dash}`) and numeric-only keys are not
 * supported — the regex `\{(\w+)\}` will silently pass them through
 * without substitution. All translation keys in this project use camelCase.
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
 * Clears the in-memory locale cache and any in-flight load promises.
 * Useful in tests to ensure a clean state between test runs.
 */
export function clearLocaleCache(): void {
  cache.clear();
  inFlight.clear();
}
