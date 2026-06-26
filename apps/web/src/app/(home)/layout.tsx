import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { GLOBAL_NAMESPACES, HOME_NAMESPACES, routeMessages } from "@/i18n/message-keys";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();

  return {
    title: `${t("home.pageTitle")}`,
  };
}

export default async function HomeLayout({ children }: { children: React.ReactNode }) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider
      messages={routeMessages(
        messages as Record<string, unknown>,
        GLOBAL_NAMESPACES,
        HOME_NAMESPACES,
      )}
    >
      {children}
    </NextIntlClientProvider>
  );
}
