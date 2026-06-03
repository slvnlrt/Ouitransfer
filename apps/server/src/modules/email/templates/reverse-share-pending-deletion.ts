import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ReverseSharePendingDeletionData {
  reverseShareName: string;
  deletionAt: string;
  reverseShareManageUrl: string;
}

/**
 * "Will be permanently deleted in N days" warning, sent before an expired
 * reverse share and its uploaded files are permanently removed by the cleanup
 * scheduler (5.2 A5). Unlike a regular share, deletion here reclaims storage.
 */
export function renderReverseSharePendingDeletion(
  data: ReverseSharePendingDeletionData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("reverseSharePendingDeletion.subtitle"),
    body: t("reverseSharePendingDeletion.body", {
      reverseShareName: data.reverseShareName,
      deletionAt: data.deletionAt,
    }),
    cta: { url: data.reverseShareManageUrl, label: t("reverseSharePendingDeletion.cta") },
    infoBox: t("reverseSharePendingDeletion.info"),
  };
}
