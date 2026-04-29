import {
  IconArrowsMove,
  IconDownload,
  IconEdit,
  IconEye,
  IconShare,
  IconTrash,
} from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Checkbox } from "@/components/ui/checkbox";
import { TableCell, TableRow } from "@/components/ui/table";
import { getFileIcon } from "@/utils/file-icons";
import { formatFileSize } from "@/utils/format-file-size";
import { EditableField } from "./editable-field";
import type { FileItem } from "./files-table-types";
import type { ActionItem } from "./item-actions";
import { ItemDropdownMenu } from "./item-actions";

interface FileRowProps {
  file: FileItem;
  isSelected: boolean;
  isEditingName: boolean;
  isEditingDescription: boolean;
  isHoveringName: boolean;
  isHoveringDescription: boolean;
  displayName: string;
  displayDescription?: string;
  editValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  showBulkActions: boolean;
  isShareMode: boolean;
  onSelectFile: (fileId: string, checked: boolean) => void;
  onPreview?: (file: FileItem) => void;
  onSetHoveredField: (value: { fileId: string; field: "name" | "description" } | null) => void;
  onStartEdit: (fileId: string, field: "name" | "description", currentValue: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onDownload: (objectName: string, fileName: string) => void;
  onRename?: (file: FileItem) => void;
  onShare?: (file: FileItem) => void;
  onDelete?: (file: FileItem) => void;
  onMoveFile?: (file: FileItem) => void;
  formatDateTime: (dateString: string) => string;
}

export function FileRow({
  file,
  isSelected,
  isEditingName,
  isEditingDescription,
  isHoveringName,
  isHoveringDescription,
  displayName,
  displayDescription,
  editValue,
  inputRef,
  showBulkActions,
  isShareMode,
  onSelectFile,
  onPreview,
  onSetHoveredField,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onKeyDown,
  onDownload,
  onRename,
  onShare,
  onDelete,
  onMoveFile,
  formatDateTime,
}: FileRowProps) {
  const t = useTranslations();
  const { icon: FileIcon, color } = getFileIcon(file.name);

  const actions: ActionItem[] = [
    ...(onPreview
      ? [
          {
            key: "preview",
            icon: IconEye,
            label: t("filesTable.actions.preview"),
            onClick: () => onPreview(file),
          },
        ]
      : []),
    ...(onRename
      ? [
          {
            key: "edit",
            icon: IconEdit,
            label: t("filesTable.actions.edit"),
            onClick: () => onRename(file),
          },
        ]
      : []),
    ...(onMoveFile
      ? [
          {
            key: "move",
            icon: IconArrowsMove,
            label: t("common.move"),
            onClick: () => onMoveFile(file),
          },
        ]
      : []),
    {
      key: "download",
      icon: IconDownload,
      label: t("filesTable.actions.download"),
      onClick: () => onDownload(file.objectName, file.name),
    },
    ...(onShare
      ? [
          {
            key: "share",
            icon: IconShare,
            label: t("filesTable.actions.share"),
            onClick: () => onShare(file),
          },
        ]
      : []),
    ...(onDelete
      ? [
          {
            key: "delete",
            icon: IconTrash,
            label: t("filesTable.actions.delete"),
            onClick: () => onDelete(file),
            variant: "destructive" as const,
          },
        ]
      : []),
  ];

  return (
    <TableRow
      className="group hover:bg-muted/50 transition-colors border-0 cursor-pointer"
      onClick={(e) => {
        if (
          (e.target as HTMLElement).closest(".checkbox-wrapper") ||
          (e.target as HTMLElement).closest("button") ||
          (e.target as HTMLElement).closest('[role="menuitem"]')
        ) {
          return;
        }
        if (onPreview) {
          onPreview(file);
        }
      }}
    >
      {showBulkActions && (
        <TableCell className="h-12 px-4 border-0">
          <div className="checkbox-wrapper">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked: boolean) => onSelectFile(file.id, checked)}
              aria-label={t("filesTable.selectFile", { fileName: file.name })}
            />
          </div>
        </TableCell>
      )}
      <TableCell className="h-12 px-4 border-0">
        <div className="flex items-center gap-2">
          {/* biome-ignore lint/a11y/useSemanticElements: contains nested interactive EditableField (Input + Buttons); HTML forbids nested buttons */}
          <div
            role="button"
            tabIndex={0}
            className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onPreview?.(file);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onPreview?.(file);
              }
            }}
            onMouseEnter={() => onSetHoveredField({ fileId: file.id, field: "name" })}
            onMouseLeave={() => onSetHoveredField(null)}
          >
            <FileIcon className={`h-5.5 w-5.5 ${color}`} />
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <EditableField
                isEditing={isEditingName}
                isHovering={isHoveringName}
                displayValue={displayName}
                editValue={editValue}
                isShareMode={isShareMode}
                inputRef={inputRef}
                displayClassName="truncate font-medium"
                maxWidth="200px"
                onStartEdit={() => onStartEdit(file.id, "name", displayName)}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
                onEditValueChange={onEditValueChange}
                onKeyDown={onKeyDown}
              />
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell
        className="h-12 px-4"
        onMouseEnter={() => onSetHoveredField({ fileId: file.id, field: "description" })}
        onMouseLeave={() => onSetHoveredField(null)}
      >
        <div className="flex items-center gap-1">
          <EditableField
            isEditing={isEditingDescription}
            isHovering={isHoveringDescription}
            displayValue={displayDescription || ""}
            editValue={editValue}
            placeholder={t("fileActions.addDescriptionPlaceholder")}
            isShareMode={isShareMode}
            inputRef={inputRef}
            displayClassName="text-muted-foreground truncate"
            maxWidth="150px"
            onStartEdit={() => onStartEdit(file.id, "description", displayDescription || "")}
            onSaveEdit={onSaveEdit}
            onCancelEdit={onCancelEdit}
            onEditValueChange={onEditValueChange}
            onKeyDown={onKeyDown}
          />
        </div>
      </TableCell>
      <TableCell className="h-12 px-4">{formatFileSize(file.size)}</TableCell>
      <TableCell className="h-12 px-4">{formatDateTime(file.createdAt)}</TableCell>
      <TableCell className="h-12 px-4">
        {formatDateTime(file.updatedAt || file.createdAt)}
      </TableCell>
      <TableCell className="h-12 px-4 text-end">
        <ItemDropdownMenu
          actions={actions}
          isShareMode={isShareMode}
          onShareModeDownload={() => onDownload(file.objectName, file.name)}
        />
      </TableCell>
    </TableRow>
  );
}
