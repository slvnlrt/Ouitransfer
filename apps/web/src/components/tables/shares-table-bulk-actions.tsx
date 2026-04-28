import { IconChevronDown, IconDownload, IconTrash } from "@tabler/icons-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface SharesTableBulkActionsProps {
  selectedCount: number;
  onBulkDelete?: () => void;
  onBulkDownload?: () => void;
  onClearSelection: () => void;
}

export function SharesTableBulkActions({
  selectedCount,
  onBulkDelete,
  onBulkDownload,
  onClearSelection,
}: SharesTableBulkActionsProps) {
  const t = useTranslations();

  return (
    <div className="flex items-center justify-between p-4 bg-muted/30 border rounded-lg">
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-foreground">
          {t("sharesTable.bulkActions.selected", { count: selectedCount })}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="default" size="sm" className="gap-2">
              {t("sharesTable.bulkActions.actions")}
              <IconChevronDown className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[200px]">
            {onBulkDownload && (
              <DropdownMenuItem className="cursor-pointer py-2" onClick={onBulkDownload}>
                <IconDownload className="h-4 w-4" />
                {t("sharesTable.bulkActions.download")}
              </DropdownMenuItem>
            )}
            {onBulkDelete && (
              <DropdownMenuItem
                onClick={onBulkDelete}
                className="cursor-pointer py-2 text-destructive focus:text-destructive"
              >
                <IconTrash className="h-4 w-4" />
                {t("sharesTable.bulkActions.delete")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <Button variant="outline" size="sm" onClick={onClearSelection}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
