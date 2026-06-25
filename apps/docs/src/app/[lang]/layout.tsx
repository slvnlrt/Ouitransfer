import { Banner } from "fumadocs-ui/components/banner";

import "../global.css";

import { i18nProvider } from "fumadocs-ui/i18n";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { localizedPath } from "@/app/layout.config";
import { BannerModalTrigger } from "@/components/BannerModalTrigger";
import { V1BetaModal } from "@/components/V1BetaModal";
import { LATEST_VERSION } from "@/config/constants";
import { withBasePath } from "@/lib/base-path";
import { getSiteContent } from "@/lib/content-i18n";
import { i18n, translations } from "@/lib/i18n";

const inter = Inter({
  subsets: ["latin"],
});

export function generateStaticParams() {
  return i18n.languages.map((lang) => ({ lang }));
}

export async function generateMetadata(props: { params: Promise<{ lang: string }> }) {
  const { lang } = await props.params;
  return getSiteContent(lang).metadata;
}

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;
  const content = getSiteContent(lang);

  return (
    <html lang={lang} className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Banner variant="rainbow" id="banner-v1-beta" className="!items-start pt-2">
          <BannerModalTrigger>
            OUITRANSFER {LATEST_VERSION} {content.banner.text}
          </BannerModalTrigger>
        </Banner>
        <RootProvider
          i18n={i18nProvider(translations, lang)}
          search={{ options: { api: withBasePath("/api/search") } }}
        >
          {children}
          <V1BetaModal
            content={content.modal}
            quickStartHref={localizedPath(`/docs/${LATEST_VERSION}/quick-start`, lang)}
          />
        </RootProvider>
      </body>
    </html>
  );
}
