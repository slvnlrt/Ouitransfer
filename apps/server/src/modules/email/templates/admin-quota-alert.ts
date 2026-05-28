import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface AdminQuotaAlertData {
  userName: string;
  userEmail: string;
  usedPercent: number;
  usedBytes: number;
  maxBytes: number;
}

export function renderAdminQuotaAlert(data: AdminQuotaAlertData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("adminQuotaAlert.subtitle"),
    body: t("adminQuotaAlert.body", {
      userName: data.userName,
      userEmail: data.userEmail,
      usedPercent: data.usedPercent.toString(),
      usedBytes: data.usedBytes.toString(),
      maxBytes: data.maxBytes.toString(),
    }),
    infoBox: t("adminQuotaAlert.info", { usedPercent: data.usedPercent.toString() }),
  };
}
