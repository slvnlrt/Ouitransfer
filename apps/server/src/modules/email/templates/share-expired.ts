import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareExpiredData {
  shareName: string;
  expiredAt: string;
  shareManageUrl: string;
}

export function renderShareExpired(data: ShareExpiredData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("shareExpired.subtitle"),
    body: t("shareExpired.body", {
      shareName: data.shareName,
      expiredAt: data.expiredAt,
    }),
    cta: { url: data.shareManageUrl, label: t("shareExpired.cta") },
  };
}
