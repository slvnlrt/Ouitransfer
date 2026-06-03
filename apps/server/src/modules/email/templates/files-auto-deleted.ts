import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface FilesAutoDeletedData {
  fileNames: string[];
  reason: string;
}

export function renderFilesAutoDeleted(data: FilesAutoDeletedData, t: TranslationFn): LayoutSlots {
  // Account-level deletion (A7) passes no file names — the whole account's files
  // were purged — so render the account variant instead of an empty list. The
  // per-file `body` is used when explicit file names are supplied.
  const body =
    data.fileNames.length === 0
      ? t("filesAutoDeleted.bodyAccount", { reason: data.reason })
      : t("filesAutoDeleted.body", {
          fileList: data.fileNames.join(", "),
          reason: data.reason,
        });

  return {
    subtitle: t("filesAutoDeleted.subtitle"),
    body,
    infoBox: t("filesAutoDeleted.info"),
  };
}
