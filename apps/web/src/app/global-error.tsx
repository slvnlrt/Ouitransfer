"use client";

import { useEffect, useState } from "react";

import "./globals.css";

import { reportError } from "@/lib/report-error";
import { RTL_BASE_LANGUAGES } from "@/lib/rtl-languages";

// Global error boundary — catches root layout crashes.
// Providers (theme, i18n, auth) are unavailable since root layout failed.
// Must render its own <html>/<body>.
// Uses a static inline translation map — providers are dead so useTranslations() is unavailable.
// reportError / logger are safe to import — they are dependency-free wrappers
// around console.* and won't be the cause of a root layout crash.

interface ErrorStrings {
  title: string;
  description: string;
  tryAgain: string;
  goHome: string;
}

/**
 * Static translation map for the global error boundary. Providers are unavailable,
 * so these strings are inlined to avoid depending on any runtime i18n infrastructure.
 * Only the 4 user-visible strings need translation.
 */
const translations: Record<string, ErrorStrings> = {
  en: {
    title: "Something went wrong",
    description: "An unexpected error occurred. Please try again or return to the home page.",
    tryAgain: "Try again",
    goHome: "Go to home page",
  },
  ar: {
    title: "\u062D\u062F\u062B \u062E\u0637\u0623 \u0645\u0627",
    description:
      "\u062D\u062F\u062B \u062E\u0637\u0623 \u063A\u064A\u0631 \u0645\u062A\u0648\u0642\u0639. \u064A\u0631\u062C\u0649 \u0627\u0644\u0645\u062D\u0627\u0648\u0644\u0629 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649 \u0623\u0648 \u0627\u0644\u0639\u0648\u062F\u0629 \u0625\u0644\u0649 \u0627\u0644\u0635\u0641\u062D\u0629 \u0627\u0644\u0631\u0626\u064A\u0633\u064A\u0629.",
    tryAgain: "\u062D\u0627\u0648\u0644 \u0645\u0631\u0629 \u0623\u062E\u0631\u0649",
    goHome: "\u0627\u0644\u0639\u0648\u062F\u0629 \u0644\u0644\u0631\u0626\u064A\u0633\u064A\u0629",
  },
  de: {
    title: "Etwas ist schiefgelaufen",
    description:
      "Ein unerwarteter Fehler ist aufgetreten. Bitte versuchen Sie es erneut oder kehren Sie zur Startseite zur\u00FCck.",
    tryAgain: "Erneut versuchen",
    goHome: "Zur Startseite",
  },
  el: {
    title: "\u039A\u03AC\u03C4\u03B9 \u03C0\u03AE\u03B3\u03B5 \u03C3\u03C4\u03C1\u03B1\u03B2\u03AC",
    description:
      "\u03A0\u03B1\u03C1\u03BF\u03C5\u03C3\u03B9\u03AC\u03C3\u03C4\u03B7\u03BA\u03B5 \u03B1\u03C0\u03C1\u03CC\u03C3\u03BC\u03B5\u03BD\u03BF \u03C3\u03C6\u03AC\u03BB\u03BC\u03B1. \u0394\u03BF\u03BA\u03B9\u03BC\u03AC\u03C3\u03C4\u03B5 \u03BE\u03B1\u03BD\u03AC \u03AE \u03B5\u03C0\u03B9\u03C3\u03C4\u03C1\u03AD\u03C8\u03C4\u03B5 \u03C3\u03C4\u03B7\u03BD \u03B1\u03C1\u03C7\u03B9\u03BA\u03AE \u03C3\u03B5\u03BB\u03AF\u03B4\u03B1.",
    tryAgain: "\u0394\u03BF\u03BA\u03B9\u03BC\u03AC\u03C3\u03C4\u03B5 \u03BE\u03B1\u03BD\u03AC",
    goHome: "\u0391\u03C1\u03C7\u03B9\u03BA\u03AE \u03C3\u03B5\u03BB\u03AF\u03B4\u03B1",
  },
  es: {
    title: "Algo sali\u00F3 mal",
    description:
      "Ocurri\u00F3 un error inesperado. Int\u00E9ntelo de nuevo o vuelva a la p\u00E1gina de inicio.",
    tryAgain: "Intentar de nuevo",
    goHome: "Ir al inicio",
  },
  fa: {
    title: "\u0645\u0634\u06A9\u0644\u06CC \u067E\u06CC\u0634 \u0622\u0645\u062F",
    description:
      "\u062E\u0637\u0627\u06CC \u063A\u06CC\u0631\u0645\u0646\u062A\u0638\u0631\u0647\u200C\u0627\u06CC \u0631\u062E \u062F\u0627\u062F. \u0644\u0637\u0641\u0627\u064B \u062F\u0648\u0628\u0627\u0631\u0647 \u062A\u0644\u0627\u0634 \u06A9\u0646\u06CC\u062F \u06CC\u0627 \u0628\u0647 \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC \u0628\u0631\u06AF\u0631\u062F\u06CC\u062F.",
    tryAgain: "\u062A\u0644\u0627\u0634 \u0645\u062C\u062F\u062F",
    goHome:
      "\u0631\u0641\u062A\u0646 \u0628\u0647 \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC",
  },
  fr: {
    title: "Une erreur est survenue",
    description:
      "Une erreur inattendue s\u2019est produite. Veuillez r\u00E9essayer ou retourner \u00E0 la page d\u2019accueil.",
    tryAgain: "R\u00E9essayer",
    goHome: "Page d\u2019accueil",
  },
  he: {
    title: "\u05DE\u05E9\u05D4\u05D5 \u05D4\u05E9\u05EA\u05D1\u05E9",
    description:
      "\u05D0\u05D9\u05E8\u05E2\u05D4 \u05E9\u05D2\u05D9\u05D0\u05D4 \u05D1\u05DC\u05EA\u05D9 \u05E6\u05E4\u05D5\u05D9\u05D4. \u05E0\u05E1\u05D5 \u05E9\u05D5\u05D1 \u05D0\u05D5 \u05D7\u05D6\u05E8\u05D5 \u05DC\u05D3\u05E3 \u05D4\u05D1\u05D9\u05EA.",
    tryAgain: "\u05E0\u05E1\u05D4 \u05E9\u05D5\u05D1",
    goHome: "\u05DC\u05D3\u05E3 \u05D4\u05D1\u05D9\u05EA",
  },
  hi: {
    title: "\u0915\u0941\u091B \u0917\u0932\u0924 \u0939\u094B \u0917\u092F\u093E",
    description:
      "\u090F\u0915 \u0905\u092A\u094D\u0930\u0924\u094D\u092F\u093E\u0936\u093F\u0924 \u0924\u094D\u0930\u0941\u091F\u093F \u0939\u0941\u0908\u0964 \u0915\u0943\u092A\u092F\u093E \u092A\u0941\u0928\u0903 \u092A\u094D\u0930\u092F\u093E\u0938 \u0915\u0930\u0947\u0902 \u092F\u093E \u092E\u0941\u0916\u092A\u0943\u0937\u094D\u0920 \u092A\u0930 \u0932\u094C\u091F\u0947\u0902\u0964",
    tryAgain:
      "\u092A\u0941\u0928\u0903 \u092A\u094D\u0930\u092F\u093E\u0938 \u0915\u0930\u0947\u0902",
    goHome:
      "\u092E\u0941\u0916\u092A\u0943\u0937\u094D\u0920 \u092A\u0930 \u091C\u093E\u090F\u0902",
  },
  id: {
    title: "Terjadi kesalahan",
    description:
      "Terjadi kesalahan yang tidak terduga. Silakan coba lagi atau kembali ke halaman utama.",
    tryAgain: "Coba lagi",
    goHome: "Ke halaman utama",
  },
  it: {
    title: "Qualcosa \u00E8 andato storto",
    description: "Si \u00E8 verificato un errore imprevisto. Riprova o torna alla pagina iniziale.",
    tryAgain: "Riprova",
    goHome: "Vai alla home",
  },
  ja: {
    title: "\u554F\u984C\u304C\u767A\u751F\u3057\u307E\u3057\u305F",
    description:
      "\u4E88\u671F\u3057\u306A\u3044\u30A8\u30E9\u30FC\u304C\u767A\u751F\u3057\u307E\u3057\u305F\u3002\u3082\u3046\u4E00\u5EA6\u304A\u8A66\u3057\u3044\u305F\u3060\u304F\u304B\u3001\u30DB\u30FC\u30E0\u30DA\u30FC\u30B8\u306B\u304A\u623B\u308A\u304F\u3060\u3055\u3044\u3002",
    tryAgain: "\u3082\u3046\u4E00\u5EA6\u8A66\u3059",
    goHome: "\u30DB\u30FC\u30E0\u3078",
  },
  ko: {
    title: "\uBB38\uC81C\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4",
    description:
      "\uC608\uC0C1\uCE58 \uBABB\uD55C \uC624\uB958\uAC00 \uBC1C\uC0DD\uD588\uC2B5\uB2C8\uB2E4. \uB2E4\uC2DC \uC2DC\uB3C4\uD558\uAC70\uB098 \uD648\uD398\uC774\uC9C0\uB85C \uB3CC\uC544\uAC00\uC8FC\uC138\uC694.",
    tryAgain: "\uB2E4\uC2DC \uC2DC\uB3C4",
    goHome: "\uD648\uC73C\uB85C \uC774\uB3D9",
  },
  nl: {
    title: "Er ging iets mis",
    description:
      "Er is een onverwachte fout opgetreden. Probeer het opnieuw of ga terug naar de startpagina.",
    tryAgain: "Opnieuw proberen",
    goHome: "Naar startpagina",
  },
  pl: {
    title: "Co\u015B posz\u0142o nie tak",
    description:
      "Wyst\u0105pi\u0142 nieoczekiwany b\u0142\u0105d. Spr\u00F3buj ponownie lub wr\u00F3\u0107 na stron\u0119 g\u0142\u00F3wn\u0105.",
    tryAgain: "Spr\u00F3buj ponownie",
    goHome: "Strona g\u0142\u00F3wna",
  },
  pt: {
    title: "Algo deu errado",
    description: "Ocorreu um erro inesperado. Tente novamente ou volte \u00E0 p\u00E1gina inicial.",
    tryAgain: "Tentar novamente",
    goHome: "Ir para o in\u00EDcio",
  },
  ru: {
    title:
      "\u0427\u0442\u043E-\u0442\u043E \u043F\u043E\u0448\u043B\u043E \u043D\u0435 \u0442\u0430\u043A",
    description:
      "\u041F\u0440\u043E\u0438\u0437\u043E\u0448\u043B\u0430 \u043D\u0435\u043E\u0436\u0438\u0434\u0430\u043D\u043D\u0430\u044F \u043E\u0448\u0438\u0431\u043A\u0430. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0435\u0449\u0451 \u0440\u0430\u0437 \u0438\u043B\u0438 \u0432\u0435\u0440\u043D\u0438\u0442\u0435\u0441\u044C \u043D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443.",
    tryAgain:
      "\u041F\u043E\u043F\u0440\u043E\u0431\u043E\u0432\u0430\u0442\u044C \u0441\u043D\u043E\u0432\u0430",
    goHome: "\u041D\u0430 \u0433\u043B\u0430\u0432\u043D\u0443\u044E",
  },
  sv: {
    title: "N\u00E5got gick fel",
    description:
      "Ett ov\u00E4ntat fel intr\u00E4ffade. F\u00F6rs\u00F6k igen eller g\u00E5 tillbaka till startsidan.",
    tryAgain: "F\u00F6rs\u00F6k igen",
    goHome: "Till startsidan",
  },
  th: {
    title: "\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14",
    description:
      "\u0E40\u0E01\u0E34\u0E14\u0E02\u0E49\u0E2D\u0E1C\u0E34\u0E14\u0E1E\u0E25\u0E32\u0E14\u0E17\u0E35\u0E48\u0E44\u0E21\u0E48\u0E04\u0E32\u0E14\u0E04\u0E34\u0E14 \u0E01\u0E23\u0E38\u0E13\u0E32\u0E25\u0E2D\u0E07\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07\u0E2B\u0E23\u0E37\u0E2D\u0E01\u0E25\u0E31\u0E1A\u0E44\u0E1B\u0E2B\u0E19\u0E49\u0E32\u0E2B\u0E25\u0E31\u0E01",
    tryAgain: "\u0E25\u0E2D\u0E07\u0E2D\u0E35\u0E01\u0E04\u0E23\u0E31\u0E49\u0E07",
    goHome: "\u0E01\u0E25\u0E31\u0E1A\u0E2B\u0E19\u0E49\u0E32\u0E2B\u0E25\u0E31\u0E01",
  },
  tr: {
    title: "Bir \u015Feyler ters gitti",
    description:
      "Beklenmeyen bir hata olu\u015Ftu. L\u00FCtfen tekrar deneyin veya ana sayfaya d\u00F6n\u00FCn.",
    tryAgain: "Tekrar dene",
    goHome: "Ana sayfaya git",
  },
  uk: {
    title:
      "\u0429\u043E\u0441\u044C \u043F\u0456\u0448\u043B\u043E \u043D\u0435 \u0442\u0430\u043A",
    description:
      "\u0421\u0442\u0430\u043B\u0430\u0441\u044F \u043D\u0435\u043E\u0447\u0456\u043A\u0443\u0432\u0430\u043D\u0430 \u043F\u043E\u043C\u0438\u043B\u043A\u0430. \u0421\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0449\u0435 \u0440\u0430\u0437 \u0430\u0431\u043E \u043F\u043E\u0432\u0435\u0440\u043D\u0456\u0442\u044C\u0441\u044F \u043D\u0430 \u0433\u043E\u043B\u043E\u0432\u043D\u0443 \u0441\u0442\u043E\u0440\u0456\u043D\u043A\u0443.",
    tryAgain:
      "\u0421\u043F\u0440\u043E\u0431\u0443\u0432\u0430\u0442\u0438 \u0437\u043D\u043E\u0432\u0443",
    goHome: "\u041D\u0430 \u0433\u043E\u043B\u043E\u0432\u043D\u0443",
  },
  vi: {
    title: "\u0110\u00E3 x\u1EA3y ra l\u1ED7i",
    description:
      "\u0110\u00E3 x\u1EA3y ra l\u1ED7i kh\u00F4ng mong mu\u1ED1n. Vui l\u00F2ng th\u1EED l\u1EA1i ho\u1EB7c quay v\u1EC1 trang ch\u1EE7.",
    tryAgain: "Th\u1EED l\u1EA1i",
    goHome: "V\u1EC1 trang ch\u1EE7",
  },
  zh: {
    title: "\u51FA\u4E86\u70B9\u95EE\u9898",
    description:
      "\u53D1\u751F\u4E86\u610F\u5916\u9519\u8BEF\u3002\u8BF7\u91CD\u8BD5\u6216\u8FD4\u56DE\u9996\u9875\u3002",
    tryAgain: "\u91CD\u8BD5",
    goHome: "\u8FD4\u56DE\u9996\u9875",
  },
};

/** Base-code of the configured default locale, or "en" if not set. */
const defaultLang = (process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE ?? "en-US")
  .split("-")[0]
  .toLowerCase();

/** Detect the user's locale from the NEXT_LOCALE cookie or navigator.language. */
function detectLocale(): string {
  try {
    // Try NEXT_LOCALE cookie first (set by the app's locale selection)
    const match = document.cookie.match(/(?:^|;\s*)NEXT_LOCALE=([^;]+)/);
    if (match?.[1]) {
      return decodeURIComponent(match[1]).split("-")[0].toLowerCase();
    }
    // Fall back to browser language
    return navigator.language.split("-")[0].toLowerCase();
  } catch {
    return defaultLang;
  }
}

function getStrings(lang: string): ErrorStrings {
  return translations[lang] ?? translations[defaultLang] ?? translations.en;
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error, { source: "global-error" });
  }, [error]);

  const [lang, setLang] = useState(defaultLang);
  useEffect(() => {
    setLang(detectLocale());
  }, []);
  const t = getStrings(lang);
  const dir = RTL_BASE_LANGUAGES.includes(lang) ? "rtl" : "ltr";

  return (
    <html lang={lang} dir={dir}>
      <body className="bg-background text-foreground font-sans antialiased">
        <div className="flex items-center justify-center min-h-screen px-6">
          <div className="flex flex-col items-center text-center gap-6 max-w-md">
            <div className="flex items-center justify-center h-16 w-16 rounded-full bg-destructive/10">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-destructive"
                role="img"
                aria-label="Error"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>
            <div className="flex flex-col gap-2">
              <h1 className="text-2xl font-semibold">{t.title}</h1>
              <p className="text-muted-foreground text-sm">{t.description}</p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-xs hover:bg-primary/90 transition-colors"
              >
                {t.tryAgain}
              </button>
              {/* Raw <a> tag — next/link is unavailable when root layout has crashed */}
              <a
                href="/"
                className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium shadow-xs hover:bg-accent hover:text-accent-foreground transition-colors"
              >
                {t.goHome}
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
