import { EllipsisVertical, Eye, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { GroupActionsDropdownProps } from "../types";

export function GroupActionsDropdown({
  group,
  onEdit,
  onDelete,
  onViewDetails,
}: GroupActionsDropdownProps) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onClick={() => onViewDetails(group)}>
          <Eye className="h-4 w-4" />
          {t("groups.actions.viewDetails")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onEdit(group)}>
          <Pencil className="h-4 w-4" />
          {t("groups.actions.edit")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onDelete(group)} className="text-destructive">
          <Trash2 className="h-4 w-4" />
          {t("groups.actions.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
