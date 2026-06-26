import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { GLOBAL_NAMESPACES, PUBLIC_SHARE_NAMESPACES, routeMessages } from "@/i18n/message-keys";
import { getAppInfo, getBaseUrl } from "@/lib/app-info";
import { logger } from "@/lib/logger";

interface LayoutProps {
  children: React.ReactNode;
  params: Promise<{ alias: string }>;
}

async function getShareMetadata(alias: string) {
  try {
    const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3333";
    const response = await fetch(`${API_BASE_URL}/shares/alias/${alias}/metadata`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (error) {
    logger.error("Error fetching share metadata:", {
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
  const metadata = await getShareMetadata(resolvedParams.alias);
  const appInfo = await getAppInfo();

  const title = metadata?.name || t("share.pageTitle");
  const description =
    metadata?.description ||
    (metadata?.totalFiles
      ? t("share.metadata.filesShared", {
          count: metadata.totalFiles + (metadata.totalFolders || 0),
        })
      : appInfo.appDescription || t("share.metadata.defaultDescription"));

  const baseUrl = await getBaseUrl();
  const shareUrl = `${baseUrl}/s/${resolvedParams.alias}`;

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

export default async function PublicShareLayout({ children }: LayoutProps) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider
      messages={routeMessages(
        messages as Record<string, unknown>,
        GLOBAL_NAMESPACES,
        PUBLIC_SHARE_NAMESPACES,
      )}
    >
      {children}
    </NextIntlClientProvider>
  );
}
