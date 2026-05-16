import { useTranslations } from "next-intl";

import { Spinner } from "@/components/ui/spinner";
import { getFileIcon } from "@/utils/file-icons";

interface DefaultPreviewProps {
  fileName: string;
  isLoading?: boolean;
  message?: string;
}

export function DefaultPreview({ fileName, isLoading, message }: DefaultPreviewProps) {
  const t = useTranslations();
  const { icon: FileIcon, color } = getFileIcon(fileName);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-4">
        <Spinner size="lg" />
        <p className="text-muted-foreground">{t("filePreview.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-96 gap-4">
      <FileIcon className={`h-12 w-12 ${color}`} />
      <p className="text-muted-foreground">{message || t("filePreview.notAvailable")}</p>
      <p className="text-sm text-muted-foreground">{t("filePreview.downloadToView")}</p>
    </div>
  );
}
