import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareAutoDeletedData {
  shareName: string;
  reason: string;
}

export function renderShareAutoDeleted(data: ShareAutoDeletedData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("shareAutoDeleted.subtitle"),
    body: t("shareAutoDeleted.body", {
      shareName: data.shareName,
      reason: data.reason,
    }),
    infoBox: t("shareAutoDeleted.info"),
  };
}
