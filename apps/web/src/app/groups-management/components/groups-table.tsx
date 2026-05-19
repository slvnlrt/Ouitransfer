import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GroupsTableProps } from "../types";
import { GroupActionsDropdown } from "./group-actions-dropdown";

function formatBytes(bytes: string): string {
  const n = Number(bytes);
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

export function GroupsTable({ groups, onEdit, onDelete, onViewDetails }: GroupsTableProps) {
  const t = useTranslations();

  function renderQuota(value: string | null): string {
    if (value === null) return t("groups.table.inherited");
    if (value === "0") return t("groups.table.unlimited");
    return formatBytes(value);
  }

  if (groups.length === 0) {
    return (
      <div className="rounded-lg shadow-sm overflow-hidden border p-8 text-center text-muted-foreground">
        {t("groups.table.empty")}
      </div>
    );
  }

  return (
    <div className="rounded-lg shadow-sm overflow-hidden border">
      <Table>
        <TableHeader>
          <TableRow className="border-b-0">
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("groups.table.name")}
            </TableHead>
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("groups.table.description")}
            </TableHead>
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("groups.table.members")}
            </TableHead>
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("groups.table.maxFileSize")}
            </TableHead>
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("groups.table.maxStorage")}
            </TableHead>
            <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("groups.table.storageUsed")}
            </TableHead>
            <TableHead className="h-10 w-[70px] text-xs font-bold text-muted-foreground bg-muted/50 px-4">
              {t("groups.table.actions")}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((group) => (
            <TableRow key={group.id} className="hover:bg-muted/50 transition-colors border-0">
              <TableCell className="h-12 px-4 font-medium">{group.name}</TableCell>
              <TableCell className="h-12 px-4 text-muted-foreground">
                {group.description ? truncate(group.description, 50) : "—"}
              </TableCell>
              <TableCell className="h-12 px-4">
                <Badge variant="secondary">{group.memberCount}</Badge>
              </TableCell>
              <TableCell className="h-12 px-4">{renderQuota(group.maxFileSizeOverride)}</TableCell>
              <TableCell className="h-12 px-4">
                {renderQuota(group.maxTotalStorageOverride)}
              </TableCell>
              <TableCell className="h-12 px-4">{formatBytes(group.storageUsed)}</TableCell>
              <TableCell className="h-12 px-4">
                <GroupActionsDropdown
                  group={group}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onViewDetails={onViewDetails}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
