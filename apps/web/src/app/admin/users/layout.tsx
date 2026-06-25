import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

interface LayoutProps {
  children: React.ReactNode;
}

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations();

  return {
    title: `${t("users.header.title")}`,
  };
}

export default function UsersManagementLayout({ children }: LayoutProps) {
  return <>{children}</>;
}
