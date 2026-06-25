import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface TestEmailData {
  testMessage?: string;
}

export function renderTestEmail(data: TestEmailData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("testEmail.subtitle"),
    body: data.testMessage
      ? t("testEmail.bodyCustom", { testMessage: data.testMessage })
      : t("testEmail.body"),
    infoBox: t("testEmail.info"),
  };
}
