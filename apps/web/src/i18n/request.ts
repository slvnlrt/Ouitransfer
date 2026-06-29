import {
  DEFAULT_UI_LOCALE,
  isSupportedUiLocale,
  resolveUiLocaleFromAcceptLanguage,
} from "@ouitransfer/shared/locales";
import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

const envDefault = process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || DEFAULT_UI_LOCALE;
const DEFAULT_LOCALE = isSupportedUiLocale(envDefault) ? envDefault : DEFAULT_UI_LOCALE;

export default getRequestConfig(async ({ locale }) => {
  const cookieStore = await cookies();
  const localeCookie = cookieStore.get("NEXT_LOCALE");

  let resolvedLocale = localeCookie?.value || locale;
  if (!resolvedLocale) {
    const headerStore = await headers();
    const acceptLang = headerStore.get("accept-language");
    if (acceptLang) {
      resolvedLocale = resolveUiLocaleFromAcceptLanguage(acceptLang);
    }
  }
  const finalLocale = isSupportedUiLocale(resolvedLocale) ? resolvedLocale : DEFAULT_LOCALE;

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
