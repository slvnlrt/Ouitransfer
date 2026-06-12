"use client";

import { useQuery } from "@tanstack/react-query";
import { Server } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getLdapStatus } from "@/http/endpoints/ldap";
import { queryKeys } from "@/lib/query-keys";
import { createGroupMetadata } from "../constants";
import type { SettingsFormProps, ValidGroup } from "../types";
import { AuthProvidersSettings } from "./auth-provider-form/auth-providers-settings";
import { BackgroundImageManager } from "./background-image-manager";
import { EmailAdminSection } from "./email-admin-section";
import { SettingsGroup } from "./settings-group";

const GROUP_ORDER: string[] = [
  "general",
  "email",
  "auth-providers",
  "security",
  "storage",
  "cleanup",
];

export function SettingsForm({ groupedConfigs, groupForms, onGroupSubmit }: SettingsFormProps) {
  const t = useTranslations();
  const GROUP_METADATA = createGroupMetadata(t);

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

  const defaultTab = sortedGroups[0]?.[0] ?? "general";

  return (
    <Tabs defaultValue={defaultTab}>
      <TabsList className="w-full justify-start overflow-x-auto">
        {sortedGroups.map(([group]) => {
          const meta = GROUP_METADATA[group as keyof typeof GROUP_METADATA];
          return (
            <TabsTrigger key={group} value={group}>
              {meta?.title ?? group}
            </TabsTrigger>
          );
        })}
      </TabsList>

      {sortedGroups.map(([group, configs]) => {
        if (group === "auth-providers") {
          return (
            <TabsContent key={group} value={group} className="mt-6">
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
            </TabsContent>
          );
        }

        const form = groupForms[group as ValidGroup];
        if (!form) return null;

        const smtpEnabled =
          group === "email" && configs.some((c) => c.key === "smtpEnabled" && c.value === "true");

        return (
          <TabsContent key={group} value={group} className="mt-6 flex flex-col gap-6">
            <SettingsGroup
              configs={configs}
              form={form}
              group={group}
              onSubmit={(data) => onGroupSubmit(group as ValidGroup, data)}
            />
            {group === "email" && smtpEnabled && <EmailAdminSection />}
            {group === "general" && <BackgroundImageManager />}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
