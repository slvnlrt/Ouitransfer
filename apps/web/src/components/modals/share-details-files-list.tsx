"use client";

import { IconEdit } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { Share, ShareFile } from "@/http/endpoints/shares/types";
import { getFileIcon } from "@/utils/file-icons";

interface ShareDetailsFilesListProps {
  files: ShareFile[];
  onManageFiles?: (share: Share) => void;
  share: Share;
}

export function ShareDetailsFilesList({ files, onManageFiles, share }: ShareDetailsFilesListProps) {
  const t = useTranslations();

  if (!files || files.length === 0) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <h3 className="text-base font-medium text-foreground">{t("shareDetails.files")}</h3>
        {onManageFiles && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={() => onManageFiles(share)}
            title={t("sharesTable.actions.manageFiles")}
          >
            <IconEdit className="h-3 w-3" />
          </Button>
        )}
      </div>
      <div className="border rounded-lg bg-muted/10 p-2">
        <div className="grid gap-1 max-h-32 overflow-y-auto">
          {files.map((file: ShareFile) => {
            const { icon: FileIcon, color } = getFileIcon(file.name);
            return (
              <div
                key={file.id}
                className="flex items-center gap-2 p-2 bg-background rounded border me-2"
              >
                <FileIcon className={`h-3.5 w-3.5 ${color} flex-shrink-0`} />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate max-w-[280px]" title={file.name}>
                    {file.name}
                  </div>
                  {file.description && (
                    <div
                      className="text-xs text-muted-foreground truncate max-w-[280px]"
                      title={file.description}
                    >
                      {file.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
