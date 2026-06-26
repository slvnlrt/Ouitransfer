import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { GLOBAL_NAMESPACES, REVERSE_SHARE_NAMESPACES, routeMessages } from "@/i18n/message-keys";
import { getAppInfo, getBaseUrl } from "@/lib/app-info";
import { logger } from "@/lib/logger";

async function getReverseShareMetadata(alias: string) {
  try {
    const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";
    const response = await fetch(`${API_BASE_URL}/reverse-shares/alias/${alias}/metadata`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.error("Error fetching reverse share metadata:", {
      err: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ alias: string }>;
}): Promise<Metadata> {
  const t = await getTranslations();
  const resolvedParams = await params;
  const metadata = await getReverseShareMetadata(resolvedParams.alias);
  const appInfo = await getAppInfo();

  const title = metadata?.name || t("reverseShares.upload.metadata.title");
  const description =
    metadata?.description ||
    (metadata?.maxFiles
      ? t("reverseShares.upload.metadata.descriptionWithLimit", { limit: metadata.maxFiles })
      : t("reverseShares.upload.metadata.description"));

  const baseUrl = await getBaseUrl();
  const shareUrl = `${baseUrl}/r/${resolvedParams.alias}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: shareUrl,
      siteName: appInfo.appName || "OUITRANSFER",
      type: "website",
      images: appInfo.appLogo
        ? [
            {
              url: appInfo.appLogo,
              width: 1200,
              height: 630,
              alt: appInfo.appName || "OUITRANSFER",
            },
          ]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: appInfo.appLogo ? [appInfo.appLogo] : [],
    },
  };
}

export default async function ReverseShareLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider
      messages={routeMessages(
        messages as Record<string, unknown>,
        GLOBAL_NAMESPACES,
        REVERSE_SHARE_NAMESPACES,
      )}
    >
      {children}
    </NextIntlClientProvider>
  );
}
