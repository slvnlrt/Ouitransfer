import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface PasswordResetData {
  resetUrl: string;
  expiresInMinutes: number;
}

export function renderPasswordReset(data: PasswordResetData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("passwordReset.subtitle"),
    body: t("passwordReset.body", { expiresInMinutes: data.expiresInMinutes.toString() }),
    cta: { url: data.resetUrl, label: t("passwordReset.cta") },
    infoBox: t("passwordReset.info"),
  };
}
