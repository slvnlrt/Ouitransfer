import { useCallback, useEffect, useRef, useState } from "react";

interface EditTarget {
  itemId: string;
  itemType: "file" | "folder";
  field: "name" | "description";
}

interface HoverTarget {
  itemId: string;
  field: "name" | "description";
}

type PendingChanges = Record<string, { name?: string; description?: string }>;

interface EditableItemCallbacks {
  /** Called when a file field is saved. Receives the final (potentially transformed) value. */
  onSaveFile?: (fileId: string, field: "name" | "description", value: string) => void;
  /** Called when a folder field is saved. Receives the final (potentially transformed) value. */
  onSaveFolder?: (folderId: string, field: "name" | "description", value: string) => void;
  /**
   * Optional transform for the value when entering edit mode.
   * Example: strip file extension from name so the user only edits the base name.
   */
  transformEditValue?: (
    itemId: string,
    itemType: "file" | "folder",
    field: "name" | "description",
    currentValue: string,
  ) => string;
  /**
   * Optional transform for the value when saving.
   * Example: re-add the file extension to the saved name.
   */
  transformSaveValue?: (
    itemId: string,
    itemType: "file" | "folder",
    field: "name" | "description",
    value: string,
  ) => string;
}

/**
 * Manages inline-edit state for file and folder items.
 * Replaces the duplicated editingField/editingFolderField/pendingChanges
 * state blocks that previously existed in the parent components.
 */
export function useEditableItem(callbacks: EditableItemCallbacks) {
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editValue, setEditValue] = useState("");
  const [hoverTarget, setHoverTarget] = useState<HoverTarget | null>(null);
  const [pendingFileChanges, setPendingFileChanges] = useState<PendingChanges>({});
  const [pendingFolderChanges, setPendingFolderChanges] = useState<PendingChanges>({});
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus and select when entering edit mode
  useEffect(() => {
    if (editTarget && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editTarget]);

  const startEdit = useCallback(
    (
      itemId: string,
      itemType: "file" | "folder",
      field: "name" | "description",
      currentValue: string,
    ) => {
      setEditTarget({ itemId, itemType, field });
      const value = callbacks.transformEditValue
        ? callbacks.transformEditValue(itemId, itemType, field, currentValue)
        : currentValue || "";
      setEditValue(value);
    },
    [callbacks],
  );

  const saveEdit = useCallback(() => {
    if (!editTarget) return;
    const { itemId, itemType, field } = editTarget;

    const finalValue = callbacks.transformSaveValue
      ? callbacks.transformSaveValue(itemId, itemType, field, editValue)
      : editValue;

    if (itemType === "file") {
      setPendingFileChanges((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], [field]: finalValue },
      }));
      callbacks.onSaveFile?.(itemId, field, finalValue);
    } else {
      setPendingFolderChanges((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], [field]: finalValue },
      }));
      callbacks.onSaveFolder?.(itemId, field, finalValue);
    }

    setEditTarget(null);
    setEditValue("");
    setHoverTarget(null);
  }, [editTarget, editValue, callbacks]);

  const cancelEdit = useCallback(() => {
    setEditTarget(null);
    setEditValue("");
    setHoverTarget(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        saveEdit();
      } else if (e.key === "Escape") {
        cancelEdit();
      }
    },
    [saveEdit, cancelEdit],
  );

  const getDisplayValue = useCallback(
    (
      itemId: string,
      itemType: "file" | "folder",
      field: "name" | "description",
      originalValue?: string,
    ) => {
      const changes = itemType === "file" ? pendingFileChanges : pendingFolderChanges;
      const pending = changes[itemId];
      if (pending?.[field] !== undefined) {
        return pending[field];
      }
      return originalValue;
    },
    [pendingFileChanges, pendingFolderChanges],
  );

  const isEditing = useCallback(
    (itemId: string, field: "name" | "description") =>
      editTarget?.itemId === itemId && editTarget?.field === field,
    [editTarget],
  );

  const isHovering = useCallback(
    (itemId: string, field: "name" | "description") =>
      hoverTarget?.itemId === itemId && hoverTarget?.field === field,
    [hoverTarget],
  );

  const resetPendingChanges = useCallback((itemType: "file" | "folder") => {
    if (itemType === "file") {
      setPendingFileChanges({});
    } else {
      setPendingFolderChanges({});
    }
  }, []);

  return {
    editValue,
    setEditValue,
    inputRef,
    editTarget,
    startEdit,
    saveEdit,
    cancelEdit,
    handleKeyDown,
    getDisplayValue,
    isEditing,
    isHovering,
    setHoverTarget,
    resetPendingChanges,
  };
}
