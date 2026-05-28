import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareMaxViewsReachedData {
  shareName: string;
  maxViews: number;
  shareManageUrl: string;
}

export function renderShareMaxViewsReached(
  data: ShareMaxViewsReachedData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("shareMaxViewsReached.subtitle"),
    body: t("shareMaxViewsReached.body", {
      shareName: data.shareName,
      maxViews: data.maxViews.toString(),
    }),
    cta: { url: data.shareManageUrl, label: t("shareMaxViewsReached.cta") },
  };
}
