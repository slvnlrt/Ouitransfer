"use client";

import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { getLdapStatus } from "@/http/endpoints/ldap";
import { queryKeys } from "@/lib/query-keys";
import type { SettingsFormProps, ValidGroup } from "../types";
import { AuthProvidersSettings } from "./auth-provider-form/auth-providers-settings";
import { BackgroundImageManager } from "./background-image-manager";
import { EmailAdminSection } from "./email-admin-section";
import { SettingsGroup } from "./settings-group";

const GROUP_ORDER: string[] = ["general", "email", "auth-providers", "security", "storage"];

export function SettingsForm({
  groupedConfigs,
  collapsedGroups,
  groupForms,
  onGroupSubmit,
  onToggleCollapse,
}: SettingsFormProps) {
  const t = useTranslations();

  const hasAuthProviders = Object.keys(groupedConfigs).includes("auth-providers");

  const ldapStatusQuery = useQuery({
    queryKey: queryKeys.ldap.status(),
    queryFn: async () => {
      const res = await getLdapStatus();
      return res.data;
    },
    enabled: hasAuthProviders,
  });
  const ldapStatus = ldapStatusQuery.data;

  const sortedGroups = Object.entries(groupedConfigs).sort(([a], [b]) => {
    const indexA = GROUP_ORDER.indexOf(a);
    const indexB = GROUP_ORDER.indexOf(b);

    if (indexA === -1) return 1;
    if (indexB === -1) return -1;

    return indexA - indexB;
  });

  return (
    <div className="flex flex-col gap-6">
      {sortedGroups.map(([group, configs]) => {
        if (group === "auth-providers") {
          return (
            <div key={group}>
              {ldapStatus?.configured && (
                <div className="mb-4 flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">
                    {ldapStatus.enabled ? t("ldap.banner.active") : t("ldap.banner.disabled")}
                  </span>
                  <Link
                    href="/admin/ldap"
                    className="ml-auto text-sm text-primary underline-offset-4 hover:underline"
                  >
                    {t("ldap.banner.configure")}
                  </Link>
                </div>
              )}
              <AuthProvidersSettings />
            </div>
          );
        }

        const form = groupForms[group as ValidGroup];
        if (!form) {
          return null;
        }

        const isEmailGroup = group === "email";
        const smtpEnabled = isEmailGroup
          ? configs.some((c) => c.key === "smtpEnabled" && c.value === "true")
          : false;

        return (
          <div key={group}>
            <SettingsGroup
              configs={configs}
              form={form}
              group={group}
              isCollapsed={collapsedGroups[group]}
              onSubmit={(data) => onGroupSubmit(group as ValidGroup, data)}
              onToggleCollapse={() => onToggleCollapse(group as ValidGroup)}
            />
            {isEmailGroup && smtpEnabled && !collapsedGroups[group] && <EmailAdminSection />}
          </div>
        );
      })}
      <BackgroundImageManager />
    </div>
  );
}
