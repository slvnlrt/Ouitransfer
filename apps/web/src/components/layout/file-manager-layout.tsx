import { LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Navbar } from "@/components/layout/navbar";
import { SystemStatusBar } from "@/components/layout/system-status-bar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { DefaultFooter } from "@/components/ui/default-footer";
import { Separator } from "@/components/ui/separator";

interface FileManagerLayoutProps {
  children: ReactNode;
  title: string;
  icon: ReactNode;
  breadcrumbLabel?: string;
  showBreadcrumb?: boolean;
}

export function FileManagerLayout({
  children,
  title,
  icon,
  breadcrumbLabel,
  showBreadcrumb = true,
}: FileManagerLayoutProps) {
  const t = useTranslations();

  return (
    <div className="w-full min-h-screen flex flex-col">
      <Navbar />
      <SystemStatusBar />
      <div className="flex-1 max-w-7xl mx-auto w-full p-6 py-8">
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-row items-center gap-2">
              {icon}
              <h1 className="text-2xl font-bold">{title}</h1>
            </div>
            <Separator />
            {showBreadcrumb && breadcrumbLabel && (
              <Breadcrumb>
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Link href="/dashboard" className="flex items-center">
                        <LayoutDashboard className="size-5 me-2" />
                        {t("navigation.dashboard")}
                      </Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <span className="flex items-center gap-2">
                      {icon} {breadcrumbLabel}
                    </span>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
            )}
          </div>

          {children}
        </div>
      </div>
      <DefaultFooter />
    </div>
  );
}
