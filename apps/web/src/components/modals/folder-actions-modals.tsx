import { FolderPlus, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
import { truncateFileName } from "@/utils/file-utils";

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
  onDeleteFolder: (folderId: string, folderName: string) => Promise<void>;
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

  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");

  useEffect(() => {
    if (!folderToCreate) {
      setCreateName("");
      setCreateDescription("");
    }
  }, [folderToCreate]);

  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");

  useEffect(() => {
    if (folderToEdit) {
      setEditName(folderToEdit.name);
      setEditDescription(folderToEdit.description ?? "");
    } else {
      setEditName("");
      setEditDescription("");
    }
  }, [folderToEdit]);

  return (
    <>
      <Dialog open={folderToCreate} onOpenChange={(open) => !open && onCloseCreate()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderPlus className="size-5" />
              {t("folderActions.createFolder")}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Input
              value={createName}
              placeholder={t("folderActions.folderNamePlaceholder")}
              onChange={(e) => setCreateName(e.target.value)}
              onKeyUp={(e) => {
                if (e.key === "Enter" && createName.trim()) {
                  onCreateFolder(createName.trim(), createDescription.trim() || undefined);
                }
              }}
            />
            <Textarea
              value={createDescription}
              placeholder={t("folderActions.folderDescriptionPlaceholder")}
              onChange={(e) => setCreateDescription(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseCreate}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (createName.trim()) {
                  onCreateFolder(createName.trim(), createDescription.trim() || undefined);
                }
              }}
            >
              {t("folderActions.createFolder")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!folderToEdit} onOpenChange={(open) => !open && onCloseEdit()}>
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
                value={editName}
                placeholder={t("folderActions.folderNamePlaceholder")}
                onChange={(e) => setEditName(e.target.value)}
                onKeyUp={(e) => {
                  if (e.key === "Enter" && folderToEdit && editName.trim()) {
                    onEditFolder(
                      folderToEdit.id,
                      editName.trim(),
                      editDescription.trim() || undefined,
                    );
                  }
                }}
              />
              <Textarea
                value={editDescription}
                placeholder={t("folderActions.folderDescriptionPlaceholder")}
                onChange={(e) => setEditDescription(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseEdit}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (folderToEdit && editName.trim()) {
                  onEditFolder(
                    folderToEdit.id,
                    editName.trim(),
                    editDescription.trim() || undefined,
                  );
                }
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!folderToDelete} onOpenChange={(open) => !open && onCloseDelete()}>
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
            <p>{folderToDelete?.name ? truncateFileName(folderToDelete.name, 50) : ""}</p>
            <p className="text-sm mt-2 text-amber-500">{t("folderActions.deleteWarning")}</p>
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseDelete}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                folderToDelete && onDeleteFolder(folderToDelete.id, folderToDelete.name)
              }
            >
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!folderInSharesWarning}
        onOpenChange={(open) => !open && onCloseSharesWarning()}
      >
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
