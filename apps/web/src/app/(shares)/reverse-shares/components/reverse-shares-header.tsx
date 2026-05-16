import { LayoutDashboard, MonitorDown } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";

export function ReverseSharesHeader() {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row items-center gap-2">
        <MonitorDown className="text-xl" />
        <h1 className="text-2xl font-bold">{t("reverseShares.pageTitle")}</h1>
      </div>
      <Separator />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard" className="flex items-center">
                <LayoutDashboard className="size-5 me-2" />
                {t("common.dashboard")}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <span className="flex items-center gap-2">
              <MonitorDown className="size-5" /> {t("reverseShares.pageTitle")}
            </span>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
