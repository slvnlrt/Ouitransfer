import type { TranslationFn } from "../i18n/loader.js";
import type { LayoutSlots } from "./base-layout.js";

export interface ReverseShareUploadedData {
  reverseShareName: string;
  fileCount: number;
  fileNames: string[];
  uploaderName?: string;
  uploaderEmail?: string;
}

export function renderReverseShareUploaded(
  data: ReverseShareUploadedData,
  t: TranslationFn,
): LayoutSlots {
  const isIdentified = Boolean(data.uploaderName ?? data.uploaderEmail);
  const fileList = data.fileNames.join(", ");

  const body = isIdentified
    ? t("reverseShareUploaded.bodyIdentified", {
        reverseShareName: data.reverseShareName,
        fileCount: data.fileCount.toString(),
        fileList,
        uploaderName: data.uploaderName ?? data.uploaderEmail ?? "",
      })
    : t("reverseShareUploaded.bodyAnonymous", {
        reverseShareName: data.reverseShareName,
        fileCount: data.fileCount.toString(),
        fileList,
      });

  return {
    subtitle: t("reverseShareUploaded.subtitle"),
    body,
  };
}
