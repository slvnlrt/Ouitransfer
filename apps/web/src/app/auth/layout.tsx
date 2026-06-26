import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import { AUTH_NAMESPACES, GLOBAL_NAMESPACES, routeMessages } from "@/i18n/message-keys";

interface LayoutProps {
  children: React.ReactNode;
}

export default async function AuthCallbackLayout({ children }: LayoutProps) {
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
