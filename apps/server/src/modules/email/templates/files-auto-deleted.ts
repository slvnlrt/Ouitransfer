// TODO: finalize when 5.2 triggers are implemented
import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface FilesAutoDeletedData {
  fileNames: string[];
  reason: string;
}

export function renderFilesAutoDeleted(data: FilesAutoDeletedData, t: TranslationFn): LayoutSlots {
  const fileList = data.fileNames.join(", ");

  return {
    subtitle: t("filesAutoDeleted.subtitle"),
    body: t("filesAutoDeleted.body", {
      fileList,
      reason: data.reason,
    }),
    infoBox: t("filesAutoDeleted.info"),
  };
}
