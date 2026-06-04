import { Folder } from "lucide-react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import { getFileIcon } from "@/utils/file-icons";
import { formatFileSize } from "@/utils/format-file-size";
import {
  buildFileActions,
  buildFolderActions,
  type FileActionHandlers,
  type FolderActionHandlers,
} from "./files-table-actions";
import type { FileItem, FolderItem } from "./files-table-types";
import { ItemDropdownMenu } from "./item-actions";

/**
 * Mobile-only meta grid: a label + value pair. The desktop table shows these as
 * columns; on narrow viewports they stack inside the card.
 */
function MetaItem({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div className={`flex flex-col gap-0.5 min-w-0 ${full ? "col-span-2" : ""}`}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate" title={value}>
        {value}
      </dd>
    </div>
  );
}

interface FileCardProps extends FileActionHandlers {
  file: FileItem;
  isSelected: boolean;
  showBulkActions: boolean;
  isShareMode: boolean;
  onSelectFile: (fileId: string, checked: boolean) => void;
  formatDateTime: (dateString: string) => string;
}

export function FileCard({
  file,
  isSelected,
  showBulkActions,
  isShareMode,
  onSelectFile,
  formatDateTime,
  ...handlers
}: FileCardProps) {
  const t = useTranslations();
  const { icon: FileIcon, color } = getFileIcon(file.name);
  const actions = buildFileActions(file, handlers, t);

  return (
    <div className="rounded-lg border shadow-sm bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          {showBulkActions && (
            <div className="checkbox-wrapper mt-0.5 shrink-0">
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked: boolean) => onSelectFile(file.id, checked)}
                aria-label={t("filesTable.selectFile", { fileName: file.name })}
              />
            </div>
          )}
          <div className="flex items-start gap-2 min-w-0">
            <FileIcon className={`h-5 w-5 shrink-0 ${color}`} />
            <div className="min-w-0">
              <p className="font-medium truncate" title={file.name}>
                {file.name}
              </p>
              {file.description && (
                <p className="text-sm text-muted-foreground truncate" title={file.description}>
                  {file.description}
                </p>
              )}
            </div>
          </div>
        </div>
        <ItemDropdownMenu
          actions={actions}
          isShareMode={isShareMode}
          onShareModeDownload={() => handlers.onDownload(file.objectName, file.name)}
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <MetaItem label={t("filesTable.columns.size")} value={formatFileSize(file.size)} />
        <MetaItem
          label={t("filesTable.columns.createdAt")}
          value={formatDateTime(file.createdAt)}
        />
        <MetaItem
          label={t("filesTable.columns.updatedAt")}
          value={formatDateTime(file.updatedAt || file.createdAt)}
          full
        />
      </dl>
    </div>
  );
}

interface FolderCardProps extends FolderActionHandlers {
  folder: FolderItem;
  isSelected: boolean;
  showBulkActions: boolean;
  isShareMode: boolean;
  onSelectFolder: (folderId: string, checked: boolean) => void;
  onNavigateToFolder?: (folderId: string) => void;
  formatDateTime: (dateString: string) => string;
}

export function FolderCard({
  folder,
  isSelected,
  showBulkActions,
  isShareMode,
  onSelectFolder,
  onNavigateToFolder,
  formatDateTime,
  ...handlers
}: FolderCardProps) {
  const t = useTranslations();
  const actions = buildFolderActions(folder, handlers, t);

  return (
    <div className="rounded-lg border shadow-sm bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          {showBulkActions && (
            <div className="mt-0.5 shrink-0">
              <Checkbox
                checked={isSelected}
                onCheckedChange={(checked: boolean) => onSelectFolder(folder.id, checked)}
                aria-label={`Select folder ${folder.name}`}
              />
            </div>
          )}
          <button
            type="button"
            className="flex items-start gap-2 min-w-0 text-start hover:opacity-80 transition-opacity"
            onClick={() => onNavigateToFolder?.(folder.id)}
          >
            <Folder className="h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="font-medium text-sm text-foreground/90 truncate" title={folder.name}>
                {folder.name}
              </p>
              {folder.description && (
                <p className="text-sm text-muted-foreground truncate" title={folder.description}>
                  {folder.description}
                </p>
              )}
            </div>
          </button>
        </div>
        <ItemDropdownMenu
          actions={actions}
          isShareMode={isShareMode}
          onShareModeDownload={
            handlers.onDownloadFolder
              ? () => handlers.onDownloadFolder?.(folder.id, folder.name)
              : undefined
          }
          menuSrLabel="Folder actions menu"
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        <MetaItem
          label={t("filesTable.columns.size")}
          value={folder.totalSize ? formatFileSize(Number(folder.totalSize)) : "—"}
        />
        <MetaItem
          label={t("filesTable.columns.createdAt")}
          value={formatDateTime(folder.createdAt)}
        />
        <MetaItem
          label={t("filesTable.columns.updatedAt")}
          value={formatDateTime(folder.updatedAt)}
          full
        />
      </dl>
    </div>
  );
}
