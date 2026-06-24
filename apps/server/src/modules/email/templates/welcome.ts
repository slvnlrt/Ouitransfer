import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface WelcomeData {
  firstName: string;
  loginUrl: string;
}

export function renderWelcome(data: WelcomeData, t: TranslationFn): LayoutSlots {
  return {
    // High-impact brand hero — the welcome email is the first thing a new user sees.
    variant: "hero",
    subtitle: t("welcome.subtitle"),
    body: t("welcome.body", { firstName: data.firstName }),
    cta: { url: data.loginUrl, label: t("welcome.cta") },
  };
}
