import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareExpiringData {
  shareName: string;
  expiresAt: string;
  shareManageUrl: string;
}

export function renderShareExpiring(data: ShareExpiringData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("shareExpiring.subtitle"),
    body: t("shareExpiring.body", {
      shareName: data.shareName,
      expiresAt: data.expiresAt,
    }),
    cta: { url: data.shareManageUrl, label: t("shareExpiring.cta") },
  };
}
