import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface SharePendingDeletionData {
  shareName: string;
  deletionAt: string;
  shareManageUrl: string;
}

/**
 * "Will be permanently deleted in N days" warning, sent before an expired or
 * maxViews-reached share is permanently removed by the cleanup scheduler (5.2 A5).
 */
export function renderSharePendingDeletion(
  data: SharePendingDeletionData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("sharePendingDeletion.subtitle"),
    body: t("sharePendingDeletion.body", {
      shareName: data.shareName,
      deletionAt: data.deletionAt,
    }),
    cta: { url: data.shareManageUrl, label: t("sharePendingDeletion.cta") },
    infoBox: t("sharePendingDeletion.info"),
  };
}
