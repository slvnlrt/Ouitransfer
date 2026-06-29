import {
  isSupportedUiLocale,
  resolveUiLocaleFromAcceptLanguage,
  type SupportedUiLocale,
} from "@ouitransfer/shared/locales";
import type { FastifyRequest } from "fastify";

/** Cookie the web app writes when the user picks a language (see LanguageSwitcher). */
const LOCALE_COOKIE = "NEXT_LOCALE";

/**
 * Best-effort resolution of the UI locale a request was made under. Used to seed
 * a new user's email-language preference at registration so they don't receive
 * English mail merely because they never opened the language switcher.
 *
 * Preference order:
 *   1. the explicit `NEXT_LOCALE` cookie (the switcher's persisted choice), and
 *   2. the `Accept-Language` header (browser preference).
 *
 * Returns `undefined` when neither yields a supported locale, letting the caller
 * fall back to the column default.
 */
export function getRequestUiLocale(request: FastifyRequest): SupportedUiLocale | undefined {
  const cookies = request.cookies as Record<string, string | undefined> | undefined;
  const rawCookie = cookies?.[LOCALE_COOKIE];
  if (rawCookie) {
    let decoded = rawCookie;
    try {
      decoded = decodeURIComponent(rawCookie);
    } catch {
      // Malformed percent-encoding — fall through with the raw value.
    }
    if (isSupportedUiLocale(decoded)) {
      return decoded;
    }
  }

  const acceptLanguage = request.headers["accept-language"];
  if (typeof acceptLanguage === "string" && acceptLanguage.length > 0) {
    return resolveUiLocaleFromAcceptLanguage(acceptLanguage);
  }

  return undefined;
}
