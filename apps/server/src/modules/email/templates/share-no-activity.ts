import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareNoActivityData {
  shareName: string;
  inactivityDays: number;
  shareManageUrl: string;
}

export function renderShareNoActivity(data: ShareNoActivityData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("shareNoActivity.subtitle"),
    body: t("shareNoActivity.body", {
      shareName: data.shareName,
      inactivityDays: data.inactivityDays.toString(),
    }),
    cta: { url: data.shareManageUrl, label: t("shareNoActivity.cta") },
  };
}
