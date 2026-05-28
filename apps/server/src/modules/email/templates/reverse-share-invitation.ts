import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ReverseShareInvitationData {
  senderName: string;
  reverseShareName: string;
  reverseShareLink: string;
  hasPassword: boolean;
  expiresAt?: string;
}

export function renderReverseShareInvitation(
  data: ReverseShareInvitationData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("reverseShareInvitation.subtitle"),
    body: t("reverseShareInvitation.body", {
      senderName: data.senderName,
      reverseShareName: data.reverseShareName,
    }),
    cta: { url: data.reverseShareLink, label: t("reverseShareInvitation.cta") },
    infoBox: data.hasPassword
      ? t("reverseShareInvitation.infoPassword")
      : data.expiresAt
        ? t("reverseShareInvitation.infoExpires", { expiresAt: data.expiresAt })
        : t("reverseShareInvitation.info"),
  };
}
