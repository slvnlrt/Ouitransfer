import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GroupDeleteModalProps } from "../types";

export function GroupDeleteModal({ isOpen, onClose, group, onConfirm }: GroupDeleteModalProps) {
  const t = useTranslations();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="flex flex-col gap-1">
          <DialogTitle className="flex items-center gap-2 font-semibold">
            <Trash2 className="size-6 me-1" />
            {t("groups.delete.title")}
          </DialogTitle>
        </DialogHeader>
        <div className="py-4">
          {group && (
            <p className="text-muted-foreground">
              {group.memberCount > 0
                ? t("groups.delete.confirmationWithMembers", {
                    name: group.name,
                    count: group.memberCount,
                  })
                : t("groups.delete.confirmation", { name: group.name })}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            {t("groups.delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
