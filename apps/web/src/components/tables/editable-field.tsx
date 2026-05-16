"use client";

import { Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EditableFieldProps {
  /** Whether this field is currently in edit mode */
  isEditing: boolean;
  /** Whether the mouse is hovering over this field (to show the edit pencil) */
  isHovering: boolean;
  /** The current display value (may include pending unsaved changes) */
  displayValue: string;
  /** The current value in the edit input */
  editValue: string;
  /** Optional placeholder for the input (e.g., "Add description...") */
  placeholder?: string;
  /** In share mode, editing is disabled */
  isShareMode: boolean;
  /** Ref to the input element for auto-focus */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** CSS class for the display span (e.g., "truncate font-medium" for names) */
  displayClassName?: string;
  /** Max width for the display span truncation */
  maxWidth?: string;
  /** Called when the user clicks the edit pencil */
  onStartEdit: () => void;
  /** Called when the user confirms the edit (check button) */
  onSaveEdit: () => void;
  /** Called when the user cancels the edit (X button) */
  onCancelEdit: () => void;
  /** Called when the input value changes */
  onEditValueChange: (value: string) => void;
  /** Keyboard handler for Enter (save) and Escape (cancel) */
  onKeyDown: (e: React.KeyboardEvent) => void;
}

export function EditableField({
  isEditing,
  isHovering,
  displayValue,
  editValue,
  placeholder,
  isShareMode,
  inputRef,
  displayClassName = "truncate font-medium",
  maxWidth = "200px",
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditValueChange,
  onKeyDown,
}: EditableFieldProps) {
  if (isEditing) {
    return (
      <div className="flex items-center gap-1 flex-1">
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => onEditValueChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="h-8 text-sm"
          onClick={(e) => e.stopPropagation()}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onSaveEdit();
          }}
        >
          <Check className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6 text-destructive hover:text-destructive flex-shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onCancelEdit();
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <span className={displayClassName} style={{ maxWidth }} title={displayValue || "-"}>
        {displayValue || "-"}
      </span>
      <div className="w-6 flex justify-center flex-shrink-0">
        {isHovering && !isShareMode && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
            onClick={(e) => {
              e.stopPropagation();
              onStartEdit();
            }}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
