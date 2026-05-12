import { LayoutDashboard, Link as LinkIcon, UserPlus, Users } from "lucide-react";
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
import type { UsersHeaderProps } from "../types";

export function UsersHeader({ onCreateUser, onGenerateInvite }: UsersHeaderProps) {
  const t = useTranslations();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="text-2xl" />
          <h1 className="text-2xl font-bold">{t("users.header.title")}</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="font-semibold" onClick={onGenerateInvite}>
            <LinkIcon size={18} />
            {t("users.invite.button")}
          </Button>
          <Button className="font-semibold" onClick={onCreateUser}>
            <UserPlus size={18} />
            {t("users.header.addUser")}
          </Button>
        </div>
      </div>
      <Separator />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/dashboard" className="flex items-center">
                <LayoutDashboard size={20} className="me-2" />
                {t("common.dashboard")}
              </Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <span className="flex items-center gap-2">
              <Users size={20} /> {t("users.header.management")}
            </span>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
}
