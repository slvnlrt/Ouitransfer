import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

const supportedLocales = [
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
];

const envDefault = process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || "en-US";
const DEFAULT_LOCALE = supportedLocales.includes(envDefault) ? envDefault : "en-US";

const localeBaseMap = new Map<string, string>();
for (const loc of supportedLocales) {
  const base = loc.split("-")[0].toLowerCase();
  if (!localeBaseMap.has(base)) {
    localeBaseMap.set(base, loc);
  }
}

function detectFromAcceptLanguage(header: string): string | undefined {
  const entries = header
    .split(",")
    .map((part) => {
      const [tag, qPart] = part.trim().split(";");
      const q = qPart ? Number.parseFloat(qPart.replace(/q\s*=\s*/, "")) : 1;
      return { tag: tag.trim(), q: Number.isNaN(q) ? 0 : q };
    })
    .sort((a, b) => b.q - a.q);

  for (const { tag } of entries) {
    const normalized = tag.toLowerCase();
    const exact = supportedLocales.find((l) => l.toLowerCase() === normalized);
    if (exact) return exact;
    const base = normalized.split("-")[0];
    const baseMatch = localeBaseMap.get(base);
    if (baseMatch) return baseMatch;
  }
  return undefined;
}

export default getRequestConfig(async ({ locale }) => {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE");

  let resolvedLocale = localeCookie?.value || locale;
  if (!resolvedLocale) {
    const headerStore = await headers();
    const acceptLang = headerStore.get("accept-language");
    if (acceptLang) {
      resolvedLocale = detectFromAcceptLanguage(acceptLang);
    }
  }
  resolvedLocale = resolvedLocale || DEFAULT_LOCALE;
  const finalLocale = supportedLocales.includes(resolvedLocale) ? resolvedLocale : DEFAULT_LOCALE;

  try {
    return {
      locale: finalLocale,
      messages: (await import(`../../messages/${finalLocale}.json`)).default,
    };
  } catch {
    return {
      locale: DEFAULT_LOCALE,
      messages: (await import(`../../messages/${DEFAULT_LOCALE}.json`)).default,
    };
  }
});
