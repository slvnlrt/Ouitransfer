import { FolderPlus, Layers, LayoutDashboard } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { GroupsHeaderProps } from "../types";

export function GroupsHeader({ onCreateGroup }: GroupsHeaderProps) {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="text-2xl" />
          <h1 className="text-2xl font-bold">{t("groups.header.title")}</h1>
        </div>
        <div className="flex gap-2">
          <Button className="font-semibold" onClick={onCreateGroup}>
            <FolderPlus className="size-[18px]" />
            {t("groups.header.addGroup")}
          </Button>
        </div>
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
              <Layers className="size-5" /> {t("groups.header.management")}
            </span>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
