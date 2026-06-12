import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface UserInvitationData {
  inviterName: string;
  inviteLink: string;
  expiresInMinutes: number;
}

export function renderUserInvitation(data: UserInvitationData, t: TranslationFn): LayoutSlots {
  return {
    subtitle: t("userInvitation.subtitle"),
    body: t("userInvitation.body", { inviterName: data.inviterName }),
    cta: { url: data.inviteLink, label: t("userInvitation.cta") },
    infoBox: t("userInvitation.info", { expiresInMinutes: data.expiresInMinutes.toString() }),
  };
}
