import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ReverseShareAutoDeletedData {
  reverseShareName: string;
  deletedAt: string;
}

/**
 * Sent to the reverse-share owner after an expired reverse share and its
 * uploaded files were permanently deleted by the cleanup scheduler (5.2 A3).
 * The reverse-share equivalent of `share_auto_deleted` — there is no manage
 * link because the reverse share no longer exists.
 */
export function renderReverseShareAutoDeleted(
  data: ReverseShareAutoDeletedData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("reverseShareAutoDeleted.subtitle"),
    body: t("reverseShareAutoDeleted.body", {
      reverseShareName: data.reverseShareName,
      deletedAt: data.deletedAt,
    }),
    infoBox: t("reverseShareAutoDeleted.info"),
  };
}
