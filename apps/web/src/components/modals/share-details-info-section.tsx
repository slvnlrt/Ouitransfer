"use client";

import { IconCheck, IconEdit, IconX } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface ShareDetailsInfoSectionProps {
  displayName: string;
  displayDescription: string;
  isEditingName: boolean;
  isEditingDescription: boolean;
  editValue: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onUpdateName?: (shareId: string, newName: string) => Promise<void>;
  onUpdateDescription?: (shareId: string, newDescription: string) => Promise<void>;
  onStartEdit: (field: "name" | "description", currentValue: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditValueChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function ShareDetailsInfoSection({
  displayName,
  displayDescription,
  isEditingName,
  isEditingDescription,
  editValue,
  inputRef,
  onUpdateName,
  onUpdateDescription,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onKeyDown,
}: ShareDetailsInfoSectionProps) {
  const t = useTranslations();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <h3 className="text-base font-medium text-foreground">{t("shareDetails.basicInfo")}</h3>
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="text-sm font-medium text-muted-foreground">{t("shareDetails.name")}</label>
          {onUpdateName && !isEditingName && (
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
              onClick={() => onStartEdit("name", displayName || "")}
            >
              <IconEdit className="h-3 w-3" />
            </Button>
          )}
        </div>
        {isEditingName ? (
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              onKeyDown={onKeyDown}
              className="h-8 flex-1 text-sm"
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-green-600 hover:text-green-700"
              onClick={onSaveEdit}
            >
              <IconCheck className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-red-600 hover:text-red-700"
              onClick={onCancelEdit}
            >
              <IconX className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <span className="text-sm font-medium block">{displayName || t("shareDetails.untitled")}</span>
        )}
      </div>

      <div>
        <div className="flex items-center gap-2 mb-1">
          <label className="text-sm font-medium text-muted-foreground">
            {t("shareDetails.description")}
          </label>
          {onUpdateDescription && !isEditingDescription && (
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 text-muted-foreground hover:text-foreground"
              onClick={() => onStartEdit("description", displayDescription || "")}
            >
              <IconEdit className="h-3 w-3" />
            </Button>
          )}
        </div>
        {isEditingDescription ? (
          <div className="flex items-center gap-2">
            <Input
              ref={inputRef}
              value={editValue}
              onChange={(e) => onEditValueChange(e.target.value)}
              onKeyDown={onKeyDown}
              className="h-8 flex-1 text-sm"
              placeholder={t("shareDetails.noDescription")}
              onClick={(e) => e.stopPropagation()}
            />
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-green-600 hover:text-green-700"
              onClick={onSaveEdit}
            >
              <IconCheck className="h-3 w-3" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-6 w-6 text-red-600 hover:text-red-700"
              onClick={onCancelEdit}
            >
              <IconX className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <span className="text-sm block">{displayDescription || t("shareDetails.noDescription")}</span>
        )}
      </div>
    </div>
  );
}
