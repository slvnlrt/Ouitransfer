// TODO: finalize when 5.2 triggers are implemented
import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface QuotaWarningData {
  usedPercent: number;
  usedBytes: number;
  maxBytes: number;
}

export function renderQuotaWarning(data: QuotaWarningData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("quotaWarning.subtitle"),
    body: t("quotaWarning.body", {
      usedPercent: data.usedPercent.toString(),
      usedBytes: data.usedBytes.toString(),
      maxBytes: data.maxBytes.toString(),
    }),
    infoBox: t("quotaWarning.info", { usedPercent: data.usedPercent.toString() }),
  };
}
