import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareDownloadReminderData {
  senderName: string;
  shareName: string;
  shareLink: string;
  hasPassword: boolean;
  expiresAt?: string;
}

export function renderShareDownloadReminder(
  data: ShareDownloadReminderData,
  t: TranslationFn,
): LayoutSlots {
  return {
    subtitle: t("shareDownloadReminder.subtitle"),
    body: t("shareDownloadReminder.body", {
      senderName: data.senderName,
      shareName: data.shareName,
    }),
    cta: { url: data.shareLink, label: t("shareDownloadReminder.cta") },
    infoBox:
      data.hasPassword && data.expiresAt
        ? t("shareDownloadReminder.infoPasswordExpires", { expiresAt: data.expiresAt })
        : data.hasPassword
          ? t("shareDownloadReminder.infoPassword")
          : data.expiresAt
            ? t("shareDownloadReminder.infoExpires", { expiresAt: data.expiresAt })
            : t("shareDownloadReminder.info"),
  };
}
