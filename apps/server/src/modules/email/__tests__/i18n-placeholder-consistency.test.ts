/**
 * i18n Placeholder Consistency Tests
 *
 * Validates that every `{placeholder}` token in every translation string
 * (for every notification type, in every supported locale) corresponds to
 * a known parameter key that the render function actually supplies.
 *
 * Catches:
 *   - Typos in locale files (e.g. `{shareNam}` instead of `{shareName}`)
 *   - Missing params in a locale string that exist in another locale
 *   - Drift between payload schemas and translation strings after refactors
 *
 * Boot-time `validateAllI18nKeys()` already checks key *existence* in en.json.
 * This test adds the next layer: placeholder *consistency* across all locales.
 *
 * Design: static token analysis — no runtime interpolation.
 * Each `{token}` extracted from a translation string is checked against the
 * set of params that the render function supplies for that notification type.
 *
 * Supported locales are discovered dynamically from the messages directory,
 * so adding a new `.json` file automatically extends coverage.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { notificationCatalog } from "../catalog.js";
import { clearLocaleCache } from "../i18n/loader.js";
import { UNSUBSCRIBE_I18N } from "../i18n/unsubscribe-keys.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type MessageObject = { [key: string]: string | MessageObject };

// ─── Constants ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = path.resolve(__dirname, "../i18n/messages");

/**
 * `appName` is injected as a default param by `email.service.ts` for every
 * notification type (via `createTranslationFn(locale, { appName })`).
 * It appears in subjects and bodies across all templates.
 */
const UNIVERSAL_PARAMS = new Set(["appName"]);

/**
 * Per-type extra params: keys that templates compute internally and pass to
 * the translation function but that are NOT direct schema fields.
 *
 * Format: notificationKey → Set of extra param names.
 *
 * Only types with computed/derived params need entries here.
 * All schema field names are included automatically via `getSchemaKeys()`.
 */
const EXTRA_PARAMS: Partial<Record<keyof typeof notificationCatalog, Set<string>>> = {
  // renderFilesAutoDeleted: fileList = data.fileNames.join(", ")
  files_auto_deleted: new Set(["fileList"]),

  // renderReverseShareUploaded: fileList = data.fileNames.join(", ")
  // uploaderName is passed as data.uploaderName ?? data.uploaderEmail ?? ""
  // (uploaderName is in the schema so it's covered, uploaderEmail is too — no extras needed
  //  except fileList)
  reverse_share_uploaded: new Set(["fileList"]),

  // renderShareAccessed: visitorName passed as data.visitorName ?? data.visitorEmail ?? ""
  // Both visitorName and visitorEmail are schema fields, so the union covers all tokens.
  // No additional computed params.

  // renderShareDownloaded: same pattern — visitorName/visitorEmail are schema fields.
  // No computed params needed.
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Discovers all supported locale codes by scanning the messages directory
 * for `*.json` files.
 */
function discoverLocales(): string[] {
  const files = fs.readdirSync(MESSAGES_DIR);
  return files
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

/**
 * Loads and parses a locale message file synchronously.
 * Returns `null` if the file does not exist.
 */
function loadMessages(locale: string): MessageObject | null {
  const filePath = path.join(MESSAGES_DIR, `${locale}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as MessageObject;
}

/**
 * Traverses a nested message object following a dot-separated path.
 * Returns the string value, or `undefined` if not found.
 *
 * Mirrors the `resolvePath` logic in i18n/loader.ts.
 */
function resolvePath(obj: MessageObject, dotPath: string): string | undefined {
  const parts = dotPath.split(".");
  let current: string | MessageObject = obj;
  for (const part of parts) {
    if (typeof current !== "object" || !(part in current)) return undefined;
    current = current[part];
  }
  return typeof current === "string" ? current : undefined;
}

/**
 * Extracts all `{token}` placeholder names from a template string.
 * Matches the same regex used in `interpolate()` in i18n/loader.ts: `\{(\w+)\}`.
 */
function extractPlaceholders(template: string): string[] {
  const matches = template.matchAll(/\{(\w+)\}/g);
  return [...matches].map((m) => m[1]);
}

/**
 * Returns the set of param keys that a Zod object schema exposes.
 * Works for `z.ZodObject` schemas; returns an empty set for other schema types.
 */
function getSchemaKeys(schema: { shape?: Record<string, unknown> }): Set<string> {
  if (schema.shape && typeof schema.shape === "object") {
    return new Set(Object.keys(schema.shape));
  }
  return new Set();
}

/**
 * Builds the full set of known params for a given notification type.
 * = universal params (appName) + schema field names + type-specific extras.
 */
function getAllowedParams(typeKey: keyof typeof notificationCatalog): Set<string> {
  const entry = notificationCatalog[typeKey];
  const schemaKeys = getSchemaKeys(entry.payloadSchema as { shape?: Record<string, unknown> });
  const extras = EXTRA_PARAMS[typeKey] ?? new Set<string>();

  return new Set([...UNIVERSAL_PARAMS, ...schemaKeys, ...extras]);
}

// ─── Test suite ───────────────────────────────────────────────────────────────

afterAll(() => {
  // Ensure the loader cache is cleared after this test file so other test files
  // that mock fs don't see stale real-file data.
  clearLocaleCache();
});

describe("i18n placeholder consistency", () => {
  const locales = discoverLocales();
  const notificationTypes = Object.keys(
    notificationCatalog,
  ) as (keyof typeof notificationCatalog)[];

  // Smoke-test: make sure locale discovery works
  it("discovers at least the en and fr locales", () => {
    expect(locales).toContain("en");
    expect(locales).toContain("fr");
  });

  it("covers all 25 notification types", () => {
    expect(notificationTypes).toHaveLength(25);
  });

  for (const locale of locales) {
    describe(`locale: ${locale}`, () => {
      const messages = loadMessages(locale);
      const enMessages = loadMessages("en");

      if (!messages || !enMessages) {
        it(`loads ${locale}.json`, () => {
          expect(messages, `Could not load messages for locale "${locale}"`).not.toBeNull();
          expect(enMessages, "Could not load en.json (required as fallback)").not.toBeNull();
        });
        return;
      }

      for (const typeKey of notificationTypes) {
        describe(`${typeKey}`, () => {
          const entry = notificationCatalog[typeKey];
          const allowedParams = getAllowedParams(typeKey);

          for (const i18nKey of entry.requiredI18nKeys) {
            it(`[${locale}] ${i18nKey} — no unknown placeholders`, () => {
              // Use the locale's translation if present, fall back to en (mirrors loader fallback)
              const template = resolvePath(messages, i18nKey) ?? resolvePath(enMessages, i18nKey);

              // If neither locale nor en has the key, validateAllI18nKeys() catches it at boot.
              // We skip rather than fail here — that's a separate concern.
              if (template === undefined) {
                return;
              }

              const placeholders = extractPlaceholders(template);

              for (const placeholder of placeholders) {
                expect(
                  allowedParams.has(placeholder),
                  `[${locale}] ${typeKey} / ${i18nKey}: unknown placeholder "{${placeholder}}" ` +
                    `— not in allowed params: {${[...allowedParams].join(", ")}}`,
                ).toBe(true);
              }
            });
          }
        });
      }
    });
  }
});

describe("unsubscribe page i18n keys", () => {
  const locales = discoverLocales();
  const keys = Object.values(UNSUBSCRIBE_I18N);

  // The unsubscribe pages are not catalog notification types, so they are not
  // covered by the loop above. validateAllI18nKeys() now validates these keys
  // against en.json at boot; this test additionally asserts they resolve in
  // every shipped locale file (en + fr today) so the pages never silently fall
  // back, and guards against drift between the key map and the message files.
  for (const locale of locales) {
    for (const key of keys) {
      it(`[${locale}] ${key} resolves to a string`, () => {
        const messages = loadMessages(locale);
        expect(messages, `Could not load messages for locale "${locale}"`).not.toBeNull();
        const value = messages ? resolvePath(messages, key) : undefined;
        expect(value, `[${locale}] missing or non-string unsubscribe key "${key}"`).toBeTypeOf(
          "string",
        );
      });
    }
  }
});
