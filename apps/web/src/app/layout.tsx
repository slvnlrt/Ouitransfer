import {
  Inter,
  Lato,
  Montserrat,
  Nunito,
  Open_Sans,
  Outfit,
  Poppins,
  Raleway,
  Roboto,
  Source_Sans_3,
  Work_Sans,
} from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";

import "./globals.css";

import { SkipToContent } from "@/components/a11y/skip-to-content";
import { RedirectHandler } from "@/components/auth/redirect-handler";
import { Favicon } from "@/components/layout/favicon";
import { DynamicToaster } from "@/components/ui/dynamic-toaster";
import { AuthProvider } from "@/contexts/auth-context";
import { RTL_LANGUAGES } from "@/lib/rtl-languages";
import { QueryProvider } from "../providers/query-provider";
import { ThemeColorProvider } from "../providers/theme-color-provider";
import { ThemeProvider } from "../providers/theme-provider";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  preload: false,
});

const roboto = Roboto({
  subsets: ["latin"],
  variable: "--font-roboto",
  weight: ["100", "300", "400", "500", "700", "900"],
  display: "swap",
  preload: false,
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-open-sans",
  display: "swap",
  preload: false,
});

const poppins = Poppins({
  subsets: ["latin"],
  variable: "--font-poppins",
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  display: "swap",
  preload: false,
});

const nunito = Nunito({
  subsets: ["latin"],
  variable: "--font-nunito",
  display: "swap",
  preload: false,
});

const lato = Lato({
  subsets: ["latin"],
  variable: "--font-lato",
  weight: ["100", "300", "400", "700", "900"],
  display: "swap",
  preload: false,
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
  preload: false,
});

const sourceSans = Source_Sans_3({
  subsets: ["latin"],
  variable: "--font-source-sans",
  display: "swap",
  preload: false,
});

const raleway = Raleway({
  subsets: ["latin"],
  variable: "--font-raleway",
  display: "swap",
  preload: false,
});

const workSans = Work_Sans({
  subsets: ["latin"],
  variable: "--font-work-sans",
  display: "swap",
  preload: false,
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const isRTL = RTL_LANGUAGES.includes(locale as (typeof RTL_LANGUAGES)[number]);

  return (
    <html lang={locale} dir={isRTL ? "rtl" : "ltr"} suppressHydrationWarning>
      <head />
      <body
        className={`${outfit.variable} ${inter.variable} ${roboto.variable} ${openSans.variable} ${poppins.variable} ${nunito.variable} ${lato.variable} ${montserrat.variable} ${sourceSans.variable} ${raleway.variable} ${workSans.variable} font-sans antialiased`}
      >
        <NextIntlClientProvider>
          <QueryProvider>
            {/* SkipToContent needs NextIntlClientProvider (useTranslations).
                Favicon needs QueryProvider (useAppInfo → useQueryClient).
                Both must be inside their respective providers. React 19
                automatically hoists <link> elements to <head>. */}
            <SkipToContent />
            <Favicon />
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
            >
              <ThemeColorProvider>
                <AuthProvider>
                  <RedirectHandler>
                    <main id="main-content" tabIndex={-1} className="outline-none">
                      {children}
                    </main>
                  </RedirectHandler>
                </AuthProvider>
                <DynamicToaster />
              </ThemeColorProvider>
            </ThemeProvider>
          </QueryProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
