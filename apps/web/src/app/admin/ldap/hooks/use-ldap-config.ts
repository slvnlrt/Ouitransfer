"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { listGroups } from "@/http/endpoints/groups";
import { getLdapConfig, testLdapConnection, updateLdapConfig } from "@/http/endpoints/ldap";
import type { LdapTestResult } from "@/http/endpoints/ldap/types";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";
import type { GroupMappingItem, LdapConfigFormData } from "../types";

const ldapConfigBaseSchema = z.object({
  enabled: z.boolean(),
  serverUrl: z.string().min(1, "Server URL is required"),
  bindDn: z.string().min(1, "Bind DN is required"),
  bindPassword: z.string(), // empty = keep existing password on save
  searchBase: z.string().min(1, "Search base is required"),
  syncGroupDn: z.string().min(1, "Sync group DN is required"),
  usernameAttribute: z.string().min(1, "Username attribute is required"),
  emailAttribute: z.string().min(1, "Email attribute is required"),
  displayNameAttribute: z.string().min(1, "Display name attribute is required"),
  syncIntervalMinutes: z.number().int().min(15, "Minimum 15 minutes").max(10080, "Maximum 7 days"),
  useTls: z.boolean(),
  tlsSkipVerify: z.boolean(),
  appUrl: z.string().url("Must be a valid URL").or(z.literal("")),
});

export function useLdapConfig() {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const [testResult, setTestResult] = useState<LdapTestResult | null>(null);

  const configQuery = useQuery({
    queryKey: queryKeys.ldap.config(),
    queryFn: async () => {
      const res = await getLdapConfig();
      return res.data;
    },
  });

  const groupsQuery = useQuery({
    queryKey: queryKeys.groups.list(),
    queryFn: async () => {
      const res = await listGroups();
      return res.data;
    },
  });

  const mappedGroups: GroupMappingItem[] = (groupsQuery.data ?? [])
    .filter((g) => g.ldapDn)
    .map((g) => ({ id: g.id, name: g.name, ldapDn: g.ldapDn! }));

  const isNewConfig = !configQuery.data?.configured;

  // M-3: appUrl required when enabled; M-4: bindPassword required for new config
  const ldapConfigFormSchema = useMemo(
    () =>
      ldapConfigBaseSchema.superRefine((data, ctx) => {
        // M-3: appUrl is required when LDAP is enabled (needed for welcome emails)
        if (data.enabled && !data.appUrl) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("ldap.config.appUrlRequired"),
            path: ["appUrl"],
          });
        }
        // M-4: bindPassword required when creating a new LDAP config
        if (isNewConfig && !data.bindPassword) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: t("ldap.config.bindPasswordRequired"),
            path: ["bindPassword"],
          });
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isNewConfig, t],
  );

  const formMethods = useForm<LdapConfigFormData>({
    resolver: zodResolver(ldapConfigFormSchema),
    defaultValues: {
      enabled: false,
      serverUrl: "",
      bindDn: "",
      bindPassword: "",
      searchBase: "",
      syncGroupDn: "",
      usernameAttribute: "sAMAccountName",
      emailAttribute: "mail",
      displayNameAttribute: "displayName",
      syncIntervalMinutes: 360,
      useTls: true,
      tlsSkipVerify: false,
      appUrl: "",
    },
    values: configQuery.data?.configured
      ? {
          enabled: configQuery.data.enabled ?? false,
          serverUrl: configQuery.data.serverUrl ?? "",
          bindDn: configQuery.data.bindDn ?? "",
          bindPassword: "", // C-1: never populate with masked value from server
          searchBase: configQuery.data.searchBase ?? "",
          syncGroupDn: configQuery.data.syncGroupDn ?? "",
          usernameAttribute: configQuery.data.usernameAttribute ?? "sAMAccountName",
          emailAttribute: configQuery.data.emailAttribute ?? "mail",
          displayNameAttribute: configQuery.data.displayNameAttribute ?? "displayName",
          syncIntervalMinutes: configQuery.data.syncIntervalMinutes ?? 360,
          useTls: configQuery.data.useTls ?? true,
          tlsSkipVerify: configQuery.data.tlsSkipVerify ?? false,
          appUrl: configQuery.data.appUrl ?? "",
        }
      : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: (data: LdapConfigFormData) =>
      updateLdapConfig({
        ...data,
        appUrl: data.appUrl || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.ldap.all });
      toast.success(t("ldap.config.saveSuccess"));
    },
    onError: (error: unknown) => {
      const apiError = parseApiError(error);
      toast.error(apiError.message || t("ldap.config.saveError"));
    },
  });

  const testMutation = useMutation({
    mutationFn: () => {
      const values = formMethods.getValues();
      return testLdapConnection({
        serverUrl: values.serverUrl,
        bindDn: values.bindDn,
        bindPassword: values.bindPassword,
        searchBase: values.searchBase,
        syncGroupDn: values.syncGroupDn,
        usernameAttribute: values.usernameAttribute,
        emailAttribute: values.emailAttribute,
        displayNameAttribute: values.displayNameAttribute,
        useTls: values.useTls,
        tlsSkipVerify: values.tlsSkipVerify,
      });
    },
    onSuccess: (res) => {
      setTestResult(res.data);
      if (res.data.success) {
        toast.success(t("ldap.config.testSuccess"));
      } else {
        toast.error(res.data.message);
      }
    },
    onError: (error: unknown) => {
      const apiError = parseApiError(error);
      toast.error(apiError.message || t("ldap.config.testError"));
    },
  });

  return {
    config: configQuery.data ?? null,
    isLoading: configQuery.isLoading,
    formMethods,
    isSaving: saveMutation.isPending,
    onSave: (data: LdapConfigFormData) => saveMutation.mutate(data),
    isTesting: testMutation.isPending,
    testResult,
    onTest: () => testMutation.mutate(),
    mappedGroups,
    isLoadingGroups: groupsQuery.isLoading,
  };
}
