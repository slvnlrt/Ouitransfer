import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

interface LayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("audit");
  return {
    title: t("pageTitle"),
  };
}

export default function AuditLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
