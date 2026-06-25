import { useTranslations } from "next-intl";
import { useState } from "react";

import type { ReverseShareWithAlias } from "@/http/endpoints/reverse-shares/types";

/** Keys of ReverseShareWithAlias whose values are scalar (string | number | boolean | null). */
type ScalarShareKey = {
  [K in keyof ReverseShareWithAlias]: NonNullable<ReverseShareWithAlias[K]> extends
    | string
    | number
    | boolean
    ? K
    : never;
}[keyof ReverseShareWithAlias] &
  string;

export function useReverseShareDetails() {
  const t = useTranslations();
  const [showAliasModal, setShowAliasModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const formatDate = (dateString: string | null) => {
    if (!dateString) return t("common.notAvailable");
    try {
      return new Date(dateString).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return t("common.invalidDate");
    }
  };

  const formatFileSize = (size: string | number | null) => {
    if (!size) return t("reverseShares.labels.noLimit");
    const sizeInBytes = typeof size === "string" ? parseInt(size, 10) : size;
    if (sizeInBytes === 0) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const k = 1024;
    const i = Math.floor(Math.log(sizeInBytes) / Math.log(k));
    return `${parseFloat((sizeInBytes / k ** i).toFixed(1))} ${units[i]}`;
  };

  const getDisplayValue = <K extends ScalarShareKey>(
    reverseShare: ReverseShareWithAlias | null | undefined,
    field: K,
    pendingChanges: Partial<Record<K, string | number | boolean | null>>,
  ): ReverseShareWithAlias[K] | undefined => {
    const pendingChange = pendingChanges[field];
    if (pendingChange !== undefined) {
      return pendingChange as ReverseShareWithAlias[K];
    }
    if (!reverseShare) return undefined;
    return reverseShare[field];
  };

  const generateReverseShareLink = (alias?: string) => {
    if (!alias) return null;
    return `${window.location.origin}/r/${alias}`;
  };

  return {
    showAliasModal,
    setShowAliasModal,
    showPasswordModal,
    setShowPasswordModal,
    formatDate,
    formatFileSize,
    getDisplayValue,
    generateReverseShareLink,
  };
}
