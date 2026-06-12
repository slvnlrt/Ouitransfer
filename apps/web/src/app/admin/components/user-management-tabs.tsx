"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

/**
 * Sub-navigation for the user-management area (Users / Groups / LDAP).
 *
 * Rendered as a semantic `<nav>` of links rather than a Radix Tabs widget: the
 * panels live on separate routes, so a real tablist (which injects
 * `aria-controls` pointing at in-page panels that don't exist here) would leave
 * dangling ARIA references. A nav with `aria-current="page"` is the correct
 * accessible primitive for route-based navigation.
 */
export function UserManagementTabs() {
  const pathname = usePathname();
  const t = useTranslations();

  const tabs = [
    { href: "/admin/users", label: t("admin.tabs.users") },
    { href: "/admin/groups", label: t("admin.tabs.groups") },
    { href: "/admin/ldap", label: t("admin.tabs.ldap") },
  ];

  // Slash-boundary match so a future sibling route (e.g. /admin/users-export)
  // never falsely highlights the Users tab.
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label={t("admin.tabs.label")}
      className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground"
    >
      {tabs.map(({ href, label }) => {
        const active = isActive(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              active ? "bg-background text-foreground shadow-sm" : "hover:bg-background/50",
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
