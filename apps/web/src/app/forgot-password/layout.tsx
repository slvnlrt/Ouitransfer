import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { AUTH_NAMESPACES, GLOBAL_NAMESPACES, routeMessages } from "@/i18n/message-keys";

interface LayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();

  return {
    title: `${t("forgotPassword.pageTitle")}`,
  };
}

export default async function ForgotPasswordLayout({ children }: LayoutProps) {
  const messages = await getMessages();

  return (
    <NextIntlClientProvider
      messages={routeMessages(
        messages as Record<string, unknown>,
        GLOBAL_NAMESPACES,
        AUTH_NAMESPACES,
      )}
    >
      {children}
    </NextIntlClientProvider>
  );
}
