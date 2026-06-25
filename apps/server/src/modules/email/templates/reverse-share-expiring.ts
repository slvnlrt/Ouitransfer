import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ReverseShareExpiringData {
  reverseShareName: string;
  expiresAt: string;
}

export function renderReverseShareExpiring(
  data: ReverseShareExpiringData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("reverseShareExpiring.subtitle"),
    body: t("reverseShareExpiring.body", {
      reverseShareName: data.reverseShareName,
      expiresAt: data.expiresAt,
    }),
  };
}
