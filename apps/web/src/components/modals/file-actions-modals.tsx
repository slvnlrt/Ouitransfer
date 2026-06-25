import { Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
import { truncateFileName } from "@/utils/file-utils";

interface FileActionsModalsProps {
  fileToRename: { id: string; name: string; description?: string } | null;
  fileToDelete: { id: string; name: string } | null;
  fileInSharesWarning: { id: string; name: string; shareCount: number } | null;
  onRename: (fileId: string, newName: string, description?: string) => Promise<void>;
  onDelete: (fileId: string) => Promise<void>;
  onForceDelete: (fileId: string) => Promise<void>;
  onCloseRename: () => void;
  onCloseDelete: () => void;
  onCloseSharesWarning: () => void;
}

export function FileActionsModals({
  fileToRename,
  fileToDelete,
  fileInSharesWarning,
  onRename,
  onDelete,
  onForceDelete,
  onCloseRename,
  onCloseDelete,
  onCloseSharesWarning,
}: FileActionsModalsProps) {
  const t = useTranslations();

  const splitFileName = (fullName: string) => {
    const lastDotIndex = fullName.lastIndexOf(".");

    return lastDotIndex === -1
      ? { name: fullName, extension: "" }
      : {
          name: fullName.substring(0, lastDotIndex),
          extension: fullName.substring(lastDotIndex),
        };
  };

  const [renameName, setRenameName] = useState("");
  const [renameDescription, setRenameDescription] = useState("");

  useEffect(() => {
    if (fileToRename) {
      setRenameName(splitFileName(fileToRename.name).name);
      setRenameDescription(fileToRename.description ?? "");
    } else {
      setRenameName("");
      setRenameDescription("");
    }
  }, [fileToRename]);

  return (
    <>
      <Dialog open={!!fileToRename} onOpenChange={() => onCloseRename()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="size-5" />
              {t("fileActions.editFile")}
            </DialogTitle>
          </DialogHeader>
          {fileToRename && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Input
                  value={renameName}
                  placeholder={t("fileActions.namePlaceholder")}
                  onChange={(e) => setRenameName(e.target.value)}
                  onKeyUp={(e) => {
                    if (e.key === "Enter" && fileToRename) {
                      const newName = renameName + splitFileName(fileToRename.name).extension;
                      onRename(fileToRename.id, newName, renameDescription || undefined);
                    }
                  }}
                />
                <p className="text-sm text-muted-foreground">
                  {t("fileActions.extension")}: {splitFileName(fileToRename.name).extension}
                </p>
              </div>
              <Input
                value={renameDescription}
                placeholder={t("fileActions.descriptionPlaceholder")}
                onChange={(e) => setRenameDescription(e.target.value)}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={onCloseRename}>
              {t("common.cancel")}
            </Button>
            <Button
              onClick={() => {
                if (fileToRename) {
                  const newName = renameName + splitFileName(fileToRename.name).extension;
                  onRename(fileToRename.id, newName, renameDescription || undefined);
                }
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fileToDelete} onOpenChange={() => onCloseDelete()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5" />
              {t("fileActions.deleteFile")}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            <p className="text-base font-semibold mb-2 text-foreground">
              {t("fileActions.deleteConfirmation")}
            </p>
            <p>{fileToDelete?.name ? truncateFileName(fileToDelete.name, 50) : ""}</p>
            <p className="text-sm  mt-2 text-amber-500">{t("fileActions.deleteWarning")}</p>
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseDelete}>
              {t("common.cancel")}
            </Button>
            <Button variant="destructive" onClick={() => fileToDelete && onDelete(fileToDelete.id)}>
              {t("common.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!fileInSharesWarning} onOpenChange={() => onCloseSharesWarning()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="size-5" />
              {t("fileActions.deleteFile")}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>
            <p className="text-base font-semibold mb-2 text-foreground">
              {t("fileActions.inSharesWarningTitle")}
            </p>
            <p className="font-medium text-sm text-foreground mt-1">{fileInSharesWarning?.name}</p>
            <p className="text-sm text-amber-500 mt-2">
              {t("fileActions.inSharesWarningBody", {
                count: fileInSharesWarning?.shareCount ?? 0,
              })}
            </p>
          </DialogDescription>
          <DialogFooter>
            <Button variant="outline" onClick={onCloseSharesWarning}>
              {t("common.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => fileInSharesWarning && onForceDelete(fileInSharesWarning.id)}
            >
              {t("fileActions.deleteAnyway")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
