import { CloudUpload, FolderOpen } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";

export function EmptyFilesState({ onUpload }: { onUpload: () => void }) {
  const t = useTranslations();

  return (
    <div className="text-center py-6 flex flex-col items-center gap-2">
      <FolderOpen className="h-10 w-10 text-muted-foreground" />
      <p className="text-muted-foreground">{t("recentFiles.noFiles")}</p>
      <Button variant="secondary" size="sm" onClick={onUpload}>
        <CloudUpload className="h-4 w-4" />
        {t("recentFiles.uploadFile")}
      </Button>
    </div>
  );
}
