import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

interface LayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("notificationPreferences");

  return {
    title: t("pageTitle"),
  };
}

export default function NotificationsLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
