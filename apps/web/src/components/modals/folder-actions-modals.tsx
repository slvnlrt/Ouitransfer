import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import type { FolderItem } from "@/components/tables/files-table-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type FolderToEdit = Pick<FolderItem, "id" | "name" | "description">;
type FolderToDelete = Pick<FolderItem, "id" | "name">;

interface FolderActionsModalsProps {
  folderToCreate: boolean;
  onCreateFolder: (name: string, description?: string) => Promise<void>;
  onCloseCreate: () => void;

  folderToEdit: FolderToEdit | null;
  onEditFolder: (folderId: string, newName: string, description?: string) => Promise<void>;
  onCloseEdit: () => void;

  folderToDelete: FolderToDelete | null;
  onDeleteFolder: (folderId: string) => Promise<void>;
  onCloseDelete: () => void;

  folderInSharesWarning: { id: string; name: string; shareCount: number } | null;
  onForceDeleteFolder: (folderId: string) => Promise<void>;
  onCloseSharesWarning: () => void;
}

export function FolderActionsModals({
  folderToCreate,
  onCreateFolder,
  onCloseCreate,
  folderToEdit,
  onEditFolder,
  onCloseEdit,
  folderToDelete,
  onDeleteFolder,
  onCloseDelete,
  folderInSharesWarning,
  onForceDeleteFolder,
  onCloseSharesWarning,
}: FolderActionsModalsProps) {
  const t = useTranslations();

  return (
    <>
      <Dialog open={folderToCreate} onOpenChange={() => onCloseCreate()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="size-5" />
              {t("folderActions.createFolder")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Input
              placeholder={t("folderActions.folderNamePlaceholder")}
              onKeyUp={(e) => {
                if (e.key === "Enter") {
                  const nameInput = e.currentTarget;
                  const descInput = document.querySelector(
                    `textarea[placeholder="${t("folderActions.folderDescriptionPlaceholder")}"]`,
                  ) as HTMLTextAreaElement;

                  if (nameInput.value.trim()) {
                    onCreateFolder(nameInput.value.trim(), descInput?.value.trim() || undefined);
                  }
                }
              }}
            />
            <Textarea placeholder={t("folderActions.folderDescriptionPlaceholder")} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseCreate}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const nameInput = document.querySelector(
                  `input[placeholder="${t("folderActions.folderNamePlaceholder")}"]`,
                ) as HTMLInputElement;
                const descInput = document.querySelector(
                  `textarea[placeholder="${t("folderActions.folderDescriptionPlaceholder")}"]`,
                ) as HTMLTextAreaElement;

                if (nameInput?.value.trim()) {
                  onCreateFolder(nameInput.value.trim(), descInput?.value.trim() || undefined);
                }
              }}
            >
              {t("folderActions.createFolder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!folderToEdit} onOpenChange={() => onCloseEdit()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-5" />
              {t("folderActions.editFolder")}
            </DialogTitle>
          </DialogHeader>
          {folderToEdit && (
            <div className="flex flex-col gap-4">
              <Input
                defaultValue={folderToEdit.name}
                placeholder={t("folderActions.folderNamePlaceholder")}
                onKeyUp={(e) => {
                  if (e.key === "Enter" && folderToEdit) {
                    const nameInput = e.currentTarget;
                    const descInput = document.querySelector(
                      `textarea[placeholder="${t("folderActions.folderDescriptionPlaceholder")}"]`,
                    ) as HTMLTextAreaElement;

                    if (nameInput.value.trim()) {
                      onEditFolder(
                        folderToEdit.id,
                        nameInput.value.trim(),
                        descInput?.value.trim() || undefined,
                      );
                    }
                  }
                }}
              />
              <Textarea
                defaultValue={folderToEdit.description || ""}
                placeholder={t("folderActions.folderDescriptionPlaceholder")}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseEdit}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                const nameInput = document.querySelector(
                  `input[placeholder="${t("folderActions.folderNamePlaceholder")}"]`,
                ) as HTMLInputElement;
                const descInput = document.querySelector(
                  `textarea[placeholder="${t("folderActions.folderDescriptionPlaceholder")}"]`,
                ) as HTMLTextAreaElement;

                if (folderToEdit && nameInput?.value.trim()) {
                  onEditFolder(
                    folderToEdit.id,
                    nameInput.value.trim(),
                    descInput?.value.trim() || undefined,
                  );
                }
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!folderToDelete} onOpenChange={() => onCloseDelete()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5" />
              {t("folderActions.deleteFolder")}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            <p className="text-base font-semibold mb-2 text-foreground">
              {t("folderActions.deleteConfirmation")}
            </p>
            <p>
              {(folderToDelete?.name &&
                (folderToDelete.name.length > 50
                  ? `${folderToDelete.name.substring(0, 50)}...`
                  : folderToDelete.name)) ||
                ""}
            </p>
            <p className="text-sm mt-2 text-amber-500">{t("folderActions.deleteWarning")}</p>
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseDelete}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => folderToDelete && onDeleteFolder(folderToDelete.id)}
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!folderInSharesWarning} onOpenChange={() => onCloseSharesWarning()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5" />
              {t("folderActions.deleteFolder")}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            <p className="text-base font-semibold mb-2 text-foreground">
              {t("folderActions.inSharesWarningTitle")}
            </p>
            <p className="font-medium text-sm text-foreground mt-1">
              {folderInSharesWarning?.name}
            </p>
            <p className="text-sm text-amber-500 mt-2">
              {t("folderActions.inSharesWarningBody", {
                count: folderInSharesWarning?.shareCount ?? 0,
              })}
            </p>
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseSharesWarning}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => folderInSharesWarning && onForceDeleteFolder(folderInSharesWarning.id)}
            >
              {t("folderActions.deleteAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
