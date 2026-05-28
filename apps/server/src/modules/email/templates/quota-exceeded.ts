// TODO: finalize when 5.2 triggers are implemented
import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface QuotaExceededData {
  usedBytes: number;
  maxBytes: number;
  gracePeriodDays?: number;
}

export function renderQuotaExceeded(data: QuotaExceededData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("quotaExceeded.subtitle"),
    body:
      data.gracePeriodDays !== undefined
        ? t("quotaExceeded.bodyGrace", {
            usedBytes: data.usedBytes.toString(),
            maxBytes: data.maxBytes.toString(),
            gracePeriodDays: data.gracePeriodDays.toString(),
          })
        : t("quotaExceeded.body", {
            usedBytes: data.usedBytes.toString(),
            maxBytes: data.maxBytes.toString(),
          }),
    infoBox: t("quotaExceeded.info"),
  };
}
