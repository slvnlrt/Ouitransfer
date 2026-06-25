import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ShareDownloadedData {
  shareName: string;
  fileName: string;
  visitorName?: string;
  visitorEmail?: string;
  downloadedAt: string;
  shareManageUrl?: string;
}

export function renderShareDownloaded(data: ShareDownloadedData, t: TranslationFn): LayoutSlots {
  const isIdentified = Boolean(data.visitorName ?? data.visitorEmail);

  const body = isIdentified
    ? t("shareDownloaded.bodyIdentified", {
        shareName: data.shareName,
        fileName: data.fileName,
        visitorName: data.visitorName ?? data.visitorEmail ?? "",
        downloadedAt: data.downloadedAt,
      })
    : t("shareDownloaded.bodyAnonymous", {
        shareName: data.shareName,
        fileName: data.fileName,
        downloadedAt: data.downloadedAt,
      });

  return {
    subtitle: t("shareDownloaded.subtitle"),
    body,
    ...(data.shareManageUrl
      ? { cta: { url: data.shareManageUrl, label: t("common.viewShare") } }
      : {}),
  };
}
