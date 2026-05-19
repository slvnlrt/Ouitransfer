"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { listGroups } from "@/http/endpoints/groups";
import { getLdapConfig, testLdapConnection, updateLdapConfig } from "@/http/endpoints/ldap";
import type { LdapTestResult } from "@/http/endpoints/ldap/types";
import { queryKeys } from "@/lib/query-keys";
import type { GroupMappingItem, LdapConfigFormData } from "../types";

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

  const formMethods = useForm<LdapConfigFormData>({
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
      appUrl: "",
    },
    values: configQuery.data?.configured
      ? {
          enabled: configQuery.data.enabled ?? false,
          serverUrl: configQuery.data.serverUrl ?? "",
          bindDn: configQuery.data.bindDn ?? "",
          bindPassword: configQuery.data.bindPassword ?? "",
          searchBase: configQuery.data.searchBase ?? "",
          syncGroupDn: configQuery.data.syncGroupDn ?? "",
          usernameAttribute: configQuery.data.usernameAttribute ?? "sAMAccountName",
          emailAttribute: configQuery.data.emailAttribute ?? "mail",
          displayNameAttribute: configQuery.data.displayNameAttribute ?? "displayName",
          syncIntervalMinutes: configQuery.data.syncIntervalMinutes ?? 360,
          useTls: configQuery.data.useTls ?? true,
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
    onError: () => {
      toast.error(t("ldap.config.saveError"));
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
    onError: () => {
      toast.error(t("ldap.config.testError"));
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
