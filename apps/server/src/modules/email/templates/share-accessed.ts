import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareAccessedData {
  shareName: string;
  visitorName?: string;
  visitorEmail?: string;
  accessedAt: string;
}

export function renderShareAccessed(data: ShareAccessedData, t: TranslationFn): LayoutSlots {
  const isIdentified = Boolean(data.visitorName ?? data.visitorEmail);

  const body = isIdentified
    ? t("shareAccessed.bodyIdentified", {
        shareName: data.shareName,
        visitorName: data.visitorName ?? data.visitorEmail ?? "",
        accessedAt: data.accessedAt,
      })
    : t("shareAccessed.bodyAnonymous", {
        shareName: data.shareName,
        accessedAt: data.accessedAt,
      });

  return {
    subtitle: t("shareAccessed.subtitle"),
    body,
  };
}
