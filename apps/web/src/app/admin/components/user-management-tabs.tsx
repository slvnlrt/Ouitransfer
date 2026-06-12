"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function UserManagementTabs() {
  const pathname = usePathname();
  const t = useTranslations();

  const tabs = [
    { href: "/admin/users", label: t("admin.tabs.users") },
    { href: "/admin/groups", label: t("admin.tabs.groups") },
    { href: "/admin/ldap", label: t("admin.tabs.ldap") },
  ];

  const activeTab = tabs.find((tab) => pathname.startsWith(tab.href))?.href ?? "/admin/users";

  return (
    <Tabs value={activeTab}>
      <TabsList>
        {tabs.map(({ href, label }) => (
          <TabsTrigger key={href} value={href} asChild>
            <Link href={href}>{label}</Link>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
