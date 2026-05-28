import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ReverseShareExpiredData {
  reverseShareName: string;
  expiredAt: string;
}

export function renderReverseShareExpired(
  data: ReverseShareExpiredData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("reverseShareExpired.subtitle"),
    body: t("reverseShareExpired.body", {
      reverseShareName: data.reverseShareName,
      expiredAt: data.expiredAt,
    }),
  };
}
