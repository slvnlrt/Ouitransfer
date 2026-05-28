import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

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
 *
 * Fallback chain:
 *   1. Requested locale
 *   2. English ("en")
 *   3. Throw — a key missing from en.json is a developer bug
 *
 * Interpolation: replaces `{key}` placeholders with values from `params`.
 */
export function t(locale: string, dotPath: string, params?: Record<string, string>): string {
  // Try the requested locale first
  const localeMessages = loadLocale(locale);
  const localeValue = localeMessages !== null ? resolvePath(localeMessages, dotPath) : undefined;

  if (localeValue !== undefined) {
    return interpolate(localeValue, params);
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

  return interpolate(enValue, params);
}

/**
 * Returns a curried translation function bound to a specific locale.
 * Useful in template functions so they don't need to thread the locale everywhere.
 *
 * @example
 * const tr = createTranslationFn("fr");
 * tr("common.footer", { appName: "Acme" });
 */
export function createTranslationFn(locale: string): TranslationFn {
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
  // biome-ignore lint/suspicious/noExplicitAny: traversing an unknown JSON tree requires any
  let current: any = obj;

  for (const part of parts) {
    if (current === null || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }

  if (typeof current !== "string") {
    return undefined;
  }

  return current;
}

/**
 * Replaces `{key}` placeholders in a template string with values from params.
 * Unknown placeholders (no matching param key) are left as-is.
 */
function interpolate(template: string, params?: Record<string, string>): string {
  if (!params || Object.keys(params).length === 0) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    return key in params ? params[key] : match;
  });
}

/**
 * Clears the in-memory locale cache.
 * Useful in tests to ensure a clean state between test runs.
 */
export function clearLocaleCache(): void {
  cache.clear();
}
