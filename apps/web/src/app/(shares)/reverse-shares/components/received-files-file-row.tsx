"use client";

import { Check, ClipboardCopy, Download, Eye, Pencil, Trash2, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { TableCell, TableRow } from "@/components/ui/table";
import type { ReverseShareFile } from "@/http/endpoints/reverse-shares/types";
import { formatDateTime } from "@/lib/format-date-time";
import { getFileIcon } from "@/utils/file-icons";

// --- Utility functions ---

const getFileNameWithoutExtension = (fileName: string) => {
  return fileName.replace(/\.[^/.]+$/, "");
};

const getFileExtension = (fileName: string) => {
  const match = fileName.match(/\.[^/.]+$/);
  return match ? match[0] : "";
};

const formatFileSize = (sizeString: string) => {
  const sizeInBytes = parseInt(sizeString, 10);
  if (sizeInBytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const k = 1024;
  const i = Math.floor(Math.log(sizeInBytes) / Math.log(k));
  return `${parseFloat((sizeInBytes / k ** i).toFixed(1))} ${units[i]}`;
};

type TranslateFunction = ReturnType<typeof useTranslations>;

const formatDate = (dateString: string, t: TranslateFunction, locale: string) => {
  try {
    return formatDateTime(dateString, "table", locale);
  } catch {
    return t("reverseShares.modals.receivedFiles.invalidDate");
  }
};

const getSenderDisplay = (file: ReverseShareFile, t: TranslateFunction) => {
  if (file.uploaderName && file.uploaderEmail) {
    return `${file.uploaderName} (${file.uploaderEmail})`;
  }
  if (file.uploaderName) return file.uploaderName;
  if (file.uploaderEmail) return file.uploaderEmail;
  return t("reverseShares.components.fileRow.anonymous");
};

const getSenderInitials = (file: ReverseShareFile) => {
  if (file.uploaderName) {
    return file.uploaderName
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  }
  if (file.uploaderEmail) {
    return file.uploaderEmail[0].toUpperCase();
  }
  return "?";
};

// --- Custom Hook ---

interface EditingState {
  fileId: string;
  field: string;
}

export interface HoverState {
  fileId: string;
  field: string;
}

export function useFileEdit() {
  const [editingFile, setEditingFile] = useState<EditingState | null>(null);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingFile && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingFile]);

  const startEdit = (fileId: string, field: string, currentValue: string) => {
    setEditingFile({ fileId, field });
    if (field === "name") {
      const nameWithoutExtension = getFileNameWithoutExtension(currentValue);
      setEditValue(nameWithoutExtension);
    } else {
      setEditValue(currentValue);
    }
  };

  const cancelEdit = () => {
    setEditingFile(null);
    setEditValue("");
  };

  return {
    editingFile,
    editValue,
    setEditValue,
    inputRef,
    startEdit,
    cancelEdit,
  };
}

// --- Editable Field Component ---

interface EditableFieldProps {
  file: ReverseShareFile;
  field: "name" | "description";
  isEditing: boolean;
  editValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  isHovered: boolean;
  onStartEdit: (fileId: string, field: string, currentValue: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function EditableField({
  file,
  field,
  isEditing,
  editValue,
  inputRef,
  isHovered,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onKeyDown,
}: EditableFieldProps) {
  const t = useTranslations();

  if (isEditing) {
    return (
      <div className="flex items-center gap-1 flex-1">
        {field === "name" ? (
          <div className="flex items-center">
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              onKeyDown={onKeyDown}
              className="h-8 text-sm font-medium rounded-e-none border-e-0"
              onClick={(e) => e.stopPropagation()}
            />
            <div className="h-8 px-2 bg-muted border border-s-0 rounded-r text-sm font-medium flex items-center text-muted-foreground">
              {getFileExtension(file.name)}
            </div>
          </div>
        ) : (
          <Input
            ref={inputRef}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onKeyDown={onKeyDown}
            className="h-6 text-xs"
            placeholder={t("reverseShares.components.fileRow.addDescription")}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-green-600 hover:text-green-700 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onSaveEdit();
          }}
          title={t("reverseShares.components.editField.saveChanges")}
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-5 w-5 text-red-600 hover:text-red-700 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onCancelEdit();
          }}
          title={t("reverseShares.components.editField.cancelEdit")}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  const currentValue = field === "name" ? file.name : file.description;
  const displayValue = field === "name" ? getFileNameWithoutExtension(file.name) : currentValue;

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <div
        className={`${field === "name" ? "font-medium" : "text-sm text-muted-foreground"} truncate max-w-[200px]`}
        title={currentValue || ""}
      >
        {field === "name" ? (
          <>
            <span className="text-foreground">{displayValue}</span>
            <span className="text-muted-foreground">{getFileExtension(file.name)}</span>
          </>
        ) : (
          displayValue || ""
        )}
      </div>
      <div className="w-6 flex justify-center flex-shrink-0">
        <Button
          size="icon"
          variant="ghost"
          className={`h-5 w-5 text-muted-foreground hover:text-foreground hidden sm:block transition-opacity ${
            isHovered ? "opacity-100" : "opacity-0"
          }`}
          onClick={(e) => {
            e.stopPropagation();
            onStartEdit(file.id, field, currentValue || "");
          }}
          title={t("reverseShares.components.fileActions.edit")}
        >
          <Pencil className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// --- File Row Component ---

interface FileRowProps {
  file: ReverseShareFile;
  editingFile: EditingState | null;
  editValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  hoveredFile: HoverState | null;
  copyingFile: string | null;
  isSelected: boolean;
  onStartEdit: (fileId: string, field: string, currentValue: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onSetHoveredFile: (hover: HoverState | null) => void;
  onPreview: (file: ReverseShareFile) => void;
  onDownload: (file: ReverseShareFile) => void;
  onDelete: (file: ReverseShareFile) => void;
  onCopy: (file: ReverseShareFile) => void;
  onSelectFile: (fileId: string, checked: boolean) => void;
}

export function FileRow({
  file,
  editingFile,
  editValue,
  inputRef,
  hoveredFile,
  copyingFile,
  isSelected,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onKeyDown,
  onSetHoveredFile,
  onPreview,
  onDownload,
  onDelete,
  onCopy,
  onSelectFile,
}: FileRowProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { icon: FileIcon, color } = getFileIcon(file.name);

  return (
    <TableRow key={file.id}>
      <TableCell>
        <Checkbox
          checked={isSelected}
          onCheckedChange={(checked: boolean) => onSelectFile(file.id, checked)}
          aria-label={t("reverseShares.modals.receivedFiles.selectFile", { fileName: file.name })}
        />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-3">
          <FileIcon className={`h-8 w-8 ${color} flex-shrink-0`} />
          <div className="min-w-0 flex-1">
            {/* biome-ignore lint/a11y/useSemanticElements: hover-tracking wrapper for editable field, <fieldset> would add unwanted visual/layout effects */}
            <div
              role="group"
              onMouseEnter={() => onSetHoveredFile({ fileId: file.id, field: "name" })}
              onMouseLeave={() => onSetHoveredFile(null)}
            >
              <EditableField
                file={file}
                field="name"
                isEditing={editingFile?.fileId === file.id && editingFile?.field === "name"}
                editValue={editValue}
                inputRef={inputRef}
                isHovered={hoveredFile?.fileId === file.id && hoveredFile?.field === "name"}
                onStartEdit={onStartEdit}
                onSaveEdit={onSaveEdit}
                onCancelEdit={onCancelEdit}
                onEditValueChange={onEditValueChange}
                onKeyDown={onKeyDown}
              />
            </div>
            {file.description && (
              // biome-ignore lint/a11y/useSemanticElements: hover-tracking wrapper for editable field, <fieldset> would add unwanted visual/layout effects
              <div
                role="group"
                className="mt-1"
                onMouseEnter={() => onSetHoveredFile({ fileId: file.id, field: "description" })}
                onMouseLeave={() => onSetHoveredFile(null)}
              >
                <EditableField
                  file={file}
                  field="description"
                  isEditing={
                    editingFile?.fileId === file.id && editingFile?.field === "description"
                  }
                  editValue={editValue}
                  inputRef={inputRef}
                  isHovered={
                    hoveredFile?.fileId === file.id && hoveredFile?.field === "description"
                  }
                  onStartEdit={onStartEdit}
                  onSaveEdit={onSaveEdit}
                  onCancelEdit={onCancelEdit}
                  onEditValueChange={onEditValueChange}
                  onKeyDown={onKeyDown}
                />
              </div>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="font-mono text-sm">{formatFileSize(file.size)}</TableCell>
      <TableCell className="max-w-[200px]">
        <div className="flex items-center gap-2 min-w-0">
          <Avatar className="h-6 w-6 flex-shrink-0">
            <AvatarFallback className="text-xs">{getSenderInitials(file)}</AvatarFallback>
          </Avatar>
          <span className="text-sm truncate min-w-0" title={getSenderDisplay(file, t)}>
            {getSenderDisplay(file, t)}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        {formatDate(file.createdAt, t, locale)}
      </TableCell>
      <TableCell className="text-end">
        <div className="flex items-center justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onPreview(file)}
            title={t("reverseShares.components.fileActions.preview")}
          >
            <Eye className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onCopy(file)}
            disabled={copyingFile === file.id}
            title={
              copyingFile === file.id
                ? t("reverseShares.components.fileActions.copying")
                : t("reverseShares.components.fileActions.copyToMyFiles")
            }
            className="text-blue-600 hover:text-blue-700 hover:bg-blue-50 disabled:opacity-50"
          >
            {copyingFile === file.id ? (
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-600 border-t-transparent"></div>
            ) : (
              <ClipboardCopy className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDownload(file)}
            title={t("reverseShares.components.fileActions.download")}
          >
            <Download className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onDelete(file)}
            title={t("reverseShares.components.fileActions.delete")}
            className="text-red-600 hover:text-red-700 hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
