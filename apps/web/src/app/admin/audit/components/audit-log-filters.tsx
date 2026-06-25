"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AuditLogsParams } from "@/http/endpoints/audit/types";

import { ACTION_CATEGORIES, TARGET_TYPES } from "../types";

interface AuditLogFiltersProps {
  params: AuditLogsParams;
  onFilterChange: (filters: Partial<AuditLogsParams>) => void;
  onClear: () => void;
}

const UNSET = "__all__";

export function AuditLogFilters({ params, onFilterChange, onClear }: AuditLogFiltersProps) {
  const t = useTranslations("audit");

  const hasActiveFilters =
    params.action || params.targetType || params.dateFrom || params.dateTo || params.search;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {/* Action filter */}
        <Select
          value={params.action ?? UNSET}
          onValueChange={(value) => onFilterChange({ action: value === UNSET ? undefined : value })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("filters.action")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>{t("filters.action")}</SelectItem>
            {Object.entries(ACTION_CATEGORIES).map(([category, actions]) => (
              <SelectGroup key={category}>
                <SelectLabel>{t(`actionCategories.${category}` as never)}</SelectLabel>
                {actions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {t(`actions.${action}` as never)}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>

        {/* Target type filter */}
        <Select
          value={params.targetType ?? UNSET}
          onValueChange={(value) =>
            onFilterChange({
              targetType: value === UNSET ? undefined : value,
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("filters.targetType")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>{t("filters.targetType")}</SelectItem>
            {TARGET_TYPES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`targetTypes.${type}` as never)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date from */}
        <div className="flex flex-col gap-1">
          <Input
            type="date"
            placeholder={t("filters.dateFrom")}
            value={params.dateFrom ?? ""}
            onChange={(e) =>
              onFilterChange({
                dateFrom: e.target.value || undefined,
              })
            }
            aria-label={t("filters.dateFrom")}
          />
        </div>

        {/* Date to */}
        <div className="flex flex-col gap-1">
          <Input
            type="date"
            placeholder={t("filters.dateTo")}
            value={params.dateTo ?? ""}
            onChange={(e) =>
              onFilterChange({
                dateTo: e.target.value || undefined,
              })
            }
            aria-label={t("filters.dateTo")}
          />
        </div>
      </div>

      <div className="flex gap-4">
        {/* Search input */}
        <Input
          type="text"
          placeholder={t("filters.searchPlaceholder")}
          value={params.search ?? ""}
          onChange={(e) => onFilterChange({ search: e.target.value || undefined })}
          className="flex-1"
          aria-label={t("filters.search")}
        />

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button variant="outline" onClick={onClear}>
            <X className="h-4 w-4" />
            {t("filters.clearAll")}
          </Button>
        )}
      </div>
    </div>
  );
}
