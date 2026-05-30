import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface AccountDeactivatedData {
  firstName: string;
  adminContactEmail?: string;
}

export function renderAccountDeactivated(
  data: AccountDeactivatedData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("accountDeactivated.subtitle"),
    body: t("accountDeactivated.body", { firstName: data.firstName }),
    infoBox: data.adminContactEmail?.trim()
      ? t("accountDeactivated.infoContact", { adminContactEmail: data.adminContactEmail })
      : t("accountDeactivated.info"),
  };
}
