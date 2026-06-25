import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface AccountReactivatedData {
  firstName: string;
  loginUrl: string;
}

export function renderAccountReactivated(
  data: AccountReactivatedData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("accountReactivated.subtitle"),
    body: t("accountReactivated.body", { firstName: data.firstName }),
    cta: { url: data.loginUrl, label: t("accountReactivated.cta") },
  };
}
