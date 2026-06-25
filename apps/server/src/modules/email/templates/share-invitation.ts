import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareInvitationData {
  senderName: string;
  shareName: string;
  shareLink: string;
  hasPassword: boolean;
  expiresAt?: string;
}

export function renderShareInvitation(data: ShareInvitationData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("shareInvitation.subtitle"),
    body: t("shareInvitation.body", {
      senderName: data.senderName,
      shareName: data.shareName,
    }),
    cta: { url: data.shareLink, label: t("shareInvitation.cta") },
    infoBox:
      data.hasPassword && data.expiresAt
        ? t("shareInvitation.infoPasswordExpires", { expiresAt: data.expiresAt })
        : data.hasPassword
          ? t("shareInvitation.infoPassword")
          : data.expiresAt
            ? t("shareInvitation.infoExpires", { expiresAt: data.expiresAt })
            : t("shareInvitation.info"),
  };
}
