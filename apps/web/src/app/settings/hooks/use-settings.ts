"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { useAppInfo } from "@/contexts/app-info-context";
import { useAdminConfigs } from "@/hooks/use-secure-configs";
import { bulkUpdateConfigs } from "@/http/endpoints";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";
import type { Config, ConfigType, GroupFormData } from "../types";

type TranslateFn = ReturnType<typeof useTranslations>;

/**
 * Validates the audit retention value, mirroring the server-side rule in
 * config-validation.ts: an integer that is either 0 (keep forever) or >= 7 days.
 */
function isValidAuditRetention(raw: string): boolean {
  const value = raw.trim();
  if (value === "") return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && (parsed === 0 || parsed >= 7);
}

/**
 * Returns true when `raw` is a whole number `>= min`, mirroring the server-side
 * `intMin` validator in config-validation.ts (rejects empty/whitespace and
 * non-integer input). Used for the 5.2 cleanup numeric config keys.
 */
export function isValidIntMin(raw: string, min: number): boolean {
  const value = raw.trim();
  if (value === "") return false;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min;
}

/**
 * Minimum bound for each integer cleanup config key, mirroring the server-side
 * bounds in `modules/config/config-validation.ts`. Boolean toggles are not
 * listed (the Switch widget can only emit "true"/"false").
 */
export const CLEANUP_INT_BOUNDS: Record<string, number> = {
  autoCleanupIntervalHours: 1,
  autoCleanupGracePeriodDays: 0,
  autoCleanupNotifyDaysBefore: 0,
  maxViewsCleanupDays: 1,
  accountDeactivationCleanupDays: 1,
  autoCleanupOrphanMinAgeHours: 1,
};

/**
 * Builds the settings form schema. Exported so component/unit tests can exercise
 * the exact validation the page uses (audit retention + the 5.2 cleanup bounds).
 */
export const createSettingsSchema = (t: TranslateFn) =>
  z
    .object({
      configs: z.record(z.string()),
    })
    .superRefine((data, ctx) => {
      const auditRetention = data.configs.auditRetentionDays;
      if (auditRetention !== undefined && !isValidAuditRetention(auditRetention)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["configs", "auditRetentionDays"],
          message: t("settings.errors.auditRetentionInvalid"),
        });
      }

      for (const [key, min] of Object.entries(CLEANUP_INT_BOUNDS)) {
        const value = data.configs[key];
        if (value !== undefined && !isValidIntMin(value, min)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["configs", key],
            message: t("settings.errors.cleanupValueInvalid", { min }),
          });
        }
      }
    });

const createSchemas = (t: TranslateFn) => ({
  settingsSchema: createSettingsSchema(t),
});

export function useSettings() {
  const t = useTranslations();
  const { settingsSchema } = createSchemas(t);
  const [isLoading, setIsLoading] = useState(true);
  const [configs, setConfigs] = useState<Record<string, string>>({});
  const [groupedConfigs, setGroupedConfigs] = useState<Record<string, Config[]>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    general: true,
    email: true,
    security: true,
    storage: true,
    cleanup: true,
  });
  const { refreshAppInfo } = useAppInfo();
  const queryClient = useQueryClient();

  const {
    configs: adminConfigsList,
    isLoading: configsLoading,
    error: configsError,
    isUnauthorized,
    reload: reloadConfigs,
  } = useAdminConfigs();

  const generalForm = useForm<GroupFormData>({ resolver: zodResolver(settingsSchema) });
  const emailForm = useForm<GroupFormData>({ resolver: zodResolver(settingsSchema) });
  const securityForm = useForm<GroupFormData>({ resolver: zodResolver(settingsSchema) });
  const storageForm = useForm<GroupFormData>({ resolver: zodResolver(settingsSchema) });
  const cleanupForm = useForm<GroupFormData>({ resolver: zodResolver(settingsSchema) });

  const groupForms = useMemo(
    () => ({
      general: generalForm,
      email: emailForm,
      security: securityForm,
      storage: storageForm,
      cleanup: cleanupForm,
    }),
    [generalForm, emailForm, securityForm, storageForm, cleanupForm],
  );

  type ValidGroup = keyof typeof groupForms;

  useEffect(() => {
    if (!configsLoading && adminConfigsList.length > 0) {
      const configsData = adminConfigsList.reduce((acc: Record<string, string>, config) => {
        acc[config.key] = config.value;
        return acc;
      }, {});

      const grouped = adminConfigsList.reduce((acc: Record<string, Config[]>, config) => {
        const group = config.group || "general";

        if (!acc[group]) acc[group] = [];

        acc[group].push({
          ...config,
          type: (config.type as ConfigType) || "text",
        });

        acc[group].sort((a, b) => {
          if (group === "general") {
            if (a.key === "appLogo") return -1;
            if (b.key === "appLogo") return 1;
          }

          if (group === "email") {
            const smtpOrder = [
              "smtpEnabled",
              "smtpHost",
              "smtpPort",
              "smtpSecure",
              "smtpNoAuth",
              "smtpUser",
              "smtpPass",
              "smtpFromName",
              "smtpFromEmail",
            ];

            const aIndex = smtpOrder.indexOf(a.key);
            const bIndex = smtpOrder.indexOf(b.key);

            if (aIndex !== -1 && bIndex !== -1) {
              return aIndex - bIndex;
            }
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
          }

          if (group === "auth-providers") {
            if (a.key === "authProvidersEnabled") return -1;
            if (b.key === "authProvidersEnabled") return 1;
          }

          if (group === "cleanup") {
            // Logical order: master toggle → its thresholds → account-cleanup
            // toggle + delay → orphan toggle + min-age.
            const cleanupOrder = [
              "autoCleanupEnabled",
              "autoCleanupIntervalHours",
              "autoCleanupGracePeriodDays",
              "autoCleanupNotifyDaysBefore",
              "maxViewsCleanupDays",
              "accountDeactivationCleanupEnabled",
              "accountDeactivationCleanupDays",
              "autoCleanupOrphansEnabled",
              "autoCleanupOrphanMinAgeHours",
            ];

            const aIndex = cleanupOrder.indexOf(a.key);
            const bIndex = cleanupOrder.indexOf(b.key);

            if (aIndex !== -1 && bIndex !== -1) {
              return aIndex - bIndex;
            }
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
          }

          return a.key.localeCompare(b.key);
        });

        return acc;
      }, {});

      setConfigs(configsData);
      setGroupedConfigs(grouped);

      Object.entries(grouped).forEach(([groupName, groupConfigs]) => {
        if (groupName === "auth-providers") {
          return;
        }

        if (
          groupName === "general" ||
          groupName === "email" ||
          groupName === "security" ||
          groupName === "storage" ||
          groupName === "cleanup"
        ) {
          const group = groupName as ValidGroup;
          const groupConfigData = groupConfigs.reduce(
            (acc, config) => {
              acc[config.key] = configsData[config.key];
              return acc;
            },
            {} as Record<string, string>,
          );

          groupForms[group].reset({ configs: groupConfigData });
        }
      });

      setIsLoading(false);
    }
  }, [configsLoading, adminConfigsList, groupForms]);

  const onGroupSubmit = async (group: ValidGroup, data: GroupFormData) => {
    try {
      const groupConfigKeys = groupedConfigs[group].map((config) => config.key);
      const configsToUpdate = Object.entries(data.configs)
        .filter(([key, newValue]) => {
          const currentValue = configs[key];

          return groupConfigKeys.includes(key) && String(newValue) !== currentValue;
        })
        .map(([key, value]) => ({
          key,
          value: String(value),
        }));

      if (configsToUpdate.length === 0) {
        toast.info(t("settings.messages.noChanges"));

        return;
      }

      await bulkUpdateConfigs(configsToUpdate);
      toast.success(
        t("settings.messages.updateSuccess", { group: t(`settings.groups.${group}.title`) }),
      );

      await reloadConfigs();

      if (group === "email") {
        await queryClient.invalidateQueries({ queryKey: queryKeys.config.all });
      }

      await refreshAppInfo();
    } catch (error: unknown) {
      const apiError = parseApiError(error);
      if (apiError.isNetworkError) {
        toast.error(t("errors.networkError"));
      } else if (
        apiError.code === ErrorCodes.VALIDATION_ERROR &&
        apiError.details?.key === "auditRetentionDays"
      ) {
        toast.error(t("settings.errors.auditRetentionInvalid"));
      } else if (
        apiError.code === ErrorCodes.VALIDATION_ERROR &&
        typeof apiError.details?.key === "string" &&
        apiError.details.key in CLEANUP_INT_BOUNDS
      ) {
        toast.error(
          t("settings.errors.cleanupValueInvalid", {
            min: CLEANUP_INT_BOUNDS[apiError.details.key as string],
          }),
        );
      } else if (
        apiError.code === ErrorCodes.VALIDATION_ERROR &&
        (apiError.message.includes("password authentication") ||
          apiError.message.includes("authentication provider"))
      ) {
        toast.error(t("settings.errors.passwordAuthRequiresProvider"));
      } else {
        toast.error(t("settings.errors.updateFailed"));
      }
    }
  };

  const toggleCollapse = (group: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [group]: !prev[group],
    }));
  };

  return {
    isLoading,
    groupedConfigs,
    collapsedGroups,
    groupForms,
    toggleCollapse,
    onGroupSubmit,
    error: configsError,
    isUnauthorized,
  };
}
