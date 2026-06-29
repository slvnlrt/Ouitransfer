/**
 * Canonical list of UI locales (BCP-47 tags) the application ships translations
 * for. This is the SINGLE SOURCE OF TRUTH shared between:
 *   - the web app (next-intl request config + language switcher), and
 *   - the server (validating `user.locale` writes, initialising it at
 *     registration from the request's `Accept-Language`).
 *
 * The region subtag (after the dash) doubles as the ISO-3166 country code used
 * to resolve flag SVGs in the language switcher, so every entry MUST be a full
 * `language-REGION` tag.
 *
 * Email templates are translated only for a subset of these locales (see the
 * server's `EMAIL_LOCALES`); the email i18n loader maps a full UI locale down to
 * its base language (`fr-FR` → `fr`) and ultimately falls back to English, so it
 * is always safe to store a full UI locale here even when no matching email
 * translation exists yet.
 */
export const SUPPORTED_UI_LOCALES = [
  "en-US",
  "pt-BR",
  "fr-FR",
  "es-ES",
  "de-DE",
  "it-IT",
  "nl-NL",
  "pl-PL",
  "tr-TR",
  "ru-RU",
  "hi-IN",
  "ar-SA",
  "zh-CN",
  "ja-JP",
  "ko-KR",
  "th-TH",
  "vi-VN",
  "uk-UA",
  "fa-IR",
  "sv-SE",
  "id-ID",
  "el-GR",
  "he-IL",
] as const;

export type SupportedUiLocale = (typeof SUPPORTED_UI_LOCALES)[number];

/** The locale used when no preference, cookie, or header match is available. */
export const DEFAULT_UI_LOCALE: SupportedUiLocale = "en-US";

/** Narrowing type guard: is `value` one of the supported UI locales? */
export function isSupportedUiLocale(value: unknown): value is SupportedUiLocale {
  return typeof value === "string" && (SUPPORTED_UI_LOCALES as readonly string[]).includes(value);
}

/**
 * Maps a base language (the part before the first `-`) to the first supported
 * UI locale that uses it. Lets `en-GB` resolve to `en-US`, `pt-PT` to `pt-BR`,
 * etc. Built once at module load.
 */
const baseLanguageToLocale = new Map<string, SupportedUiLocale>();
for (const locale of SUPPORTED_UI_LOCALES) {
  const base = locale.split("-")[0].toLowerCase();
  if (!baseLanguageToLocale.has(base)) {
    baseLanguageToLocale.set(base, locale);
  }
}

/**
 * Parses an HTTP `Accept-Language` header and returns the best-matching
 * supported UI locale, or `undefined` if none match.
 *
 * Matching is q-value ordered, then by:
 *   1. exact tag match (case-insensitive), e.g. `fr-FR` → `fr-FR`
 *   2. base-language match, e.g. `fr-CA` / `fr` → `fr-FR`
 */
export function resolveUiLocaleFromAcceptLanguage(header: string): SupportedUiLocale | undefined {
  const entries = header
    .split(",")
    .map((part) => {
      const [tag, qPart] = part.trim().split(";");
      const q = qPart ? Number.parseFloat(qPart.replace(/q\s*=\s*/, "")) : 1;
      return { tag: tag.trim(), q: Number.isNaN(q) ? 0 : q };
    })
    .filter((entry) => entry.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const normalized = tag.toLowerCase();
    const exact = SUPPORTED_UI_LOCALES.find((l) => l.toLowerCase() === normalized);
    if (exact) return exact;
    const base = normalized.split("-")[0];
    const baseMatch = baseLanguageToLocale.get(base);
    if (baseMatch) return baseMatch;
  }
  return undefined;
}
