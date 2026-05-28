import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface WelcomeData {
  firstName: string;
  loginUrl: string;
}

export function renderWelcome(data: WelcomeData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("welcome.subtitle"),
    body: t("welcome.body", { firstName: data.firstName }),
    cta: { url: data.loginUrl, label: t("welcome.cta") },
  };
}
