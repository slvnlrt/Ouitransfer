import { Check, Lock, LockOpen, Pencil, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useSecureConfigValue } from "@/hooks/use-secure-configs";
import type { Share } from "@/http/endpoints/shares/types";
import { formatDateTime } from "@/lib/format-date-time";
import { SharesTableBulkActions } from "./shares-table-bulk-actions";
import { ShareRowActions } from "./shares-table-row-actions";
import { useEditableItem } from "./use-editable-item";

export interface SharesTableProps {
  shares: Share[];
  onDelete: (share: Share) => void;
  onEdit: (share: Share) => void;
  onUpdateName: (shareId: string, newName: string) => void;
  onUpdateDescription: (shareId: string, newDescription: string) => void;
  onUpdateSecurity?: (share: Share) => void;
  onUpdateExpiration?: (share: Share) => void;
  onManageFiles: (share: Share) => void;
  onManageRecipients: (share: Share) => void;
  onViewDetails: (share: Share) => void;
  onGenerateLink: (share: Share) => void;
  onCopyLink: (share: Share) => void;
  onNotifyRecipients: (share: Share) => void;
  onViewQrCode?: (share: Share) => void;
  onDownloadShareFiles?: (share: Share) => void;
  onBulkDelete?: (shares: Share[]) => void;
  onBulkDownload?: (shares: Share[]) => void;
  setClearSelectionCallback?: (callback: () => void) => void;
}

export function SharesTable({
  shares,
  onDelete,
  onEdit,
  onUpdateName,
  onUpdateDescription,
  onUpdateSecurity,
  onUpdateExpiration,
  onManageFiles,
  onManageRecipients,
  onViewDetails,
  onGenerateLink,
  onCopyLink,
  onNotifyRecipients,
  onViewQrCode,
  onDownloadShareFiles,
  onBulkDelete,
  onBulkDownload,
  setClearSelectionCallback,
}: SharesTableProps) {
  const t = useTranslations();
  const locale = useLocale();
  const { value: smtpEnabled } = useSecureConfigValue("smtpEnabled");

  // Inline editing via shared hook (same pattern as FilesTable)
  const editing = useEditableItem({
    onSaveFile: async (shareId, field, value) => {
      if (field === "name") onUpdateName(shareId, value);
      else onUpdateDescription(shareId, value);
    },
  });

  // Additional hover state for non-editable fields (security, expiration, files, recipients)
  const [hoveredAction, setHoveredAction] = useState<{
    shareId: string;
    field: "security" | "expiration" | "files" | "recipients";
  } | null>(null);

  const [selectedShares, setSelectedShares] = useState<Set<string>>(new Set());

  useEffect(() => {
    editing.resetPendingChanges("file");
  }, [shares]);

  useEffect(() => {
    setSelectedShares(new Set());
  }, [shares]);

  useEffect(() => {
    const clearSelection = () => setSelectedShares(new Set());
    setClearSelectionCallback?.(clearSelection);
  }, [setClearSelectionCallback]);

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedShares(new Set(shares.map((share) => share.id)));
    } else {
      setSelectedShares(new Set());
    }
  };

  const handleSelectShare = (shareId: string, checked: boolean) => {
    const newSelected = new Set(selectedShares);
    if (checked) {
      newSelected.add(shareId);
    } else {
      newSelected.delete(shareId);
    }
    setSelectedShares(newSelected);
  };

  const getSelectedShares = () => shares.filter((share) => selectedShares.has(share.id));

  const isAllSelected = shares.length > 0 && selectedShares.size === shares.length;

  const handleBulkDelete = () => {
    const selectedShareObjects = getSelectedShares();
    if (selectedShareObjects.length === 0) return;
    onBulkDelete?.(selectedShareObjects);
  };

  const handleBulkDownload = () => {
    const selectedShareObjects = getSelectedShares();
    if (selectedShareObjects.length === 0) return;
    onBulkDownload?.(selectedShareObjects);
  };

  const showBulkActions = selectedShares.size > 0 && (onBulkDelete || onBulkDownload);

  return (
    <div className="space-y-4">
      {showBulkActions && (
        <SharesTableBulkActions
          selectedCount={selectedShares.size}
          onBulkDelete={onBulkDelete ? handleBulkDelete : undefined}
          onBulkDownload={onBulkDownload ? handleBulkDownload : undefined}
          onClearSelection={() => setSelectedShares(new Set())}
        />
      )}

      <div className="rounded-lg shadow-sm overflow-hidden border">
        <Table>
          <TableHeader>
            <TableRow className="border-b-0">
              <TableHead className="h-10 w-[50px] text-xs font-bold text-muted-foreground bg-muted/50 px-4 rounded-tl-lg">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label={t("sharesTable.selectAll")}
                />
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.name")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.description")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.createdAt")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.expiresAt")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.status")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.security")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.files")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.recipients")}
              </TableHead>
              <TableHead className="h-10 w-[70px] text-xs font-bold text-muted-foreground bg-muted/50 px-4 rounded-tr-lg">
                {t("sharesTable.columns.actions")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shares.map((share) => {
              const isEditingName = editing.isEditing(share.id, "name");
              const isEditingDescription = editing.isEditing(share.id, "description");
              const isHoveringName = editing.isHovering(share.id, "name");
              const isHoveringDescription = editing.isHovering(share.id, "description");
              const isHoveringSecurity =
                hoveredAction?.shareId === share.id && hoveredAction?.field === "security";
              const isHoveringExpiration =
                hoveredAction?.shareId === share.id && hoveredAction?.field === "expiration";
              const isHoveringFiles =
                hoveredAction?.shareId === share.id && hoveredAction?.field === "files";
              const isHoveringRecipients =
                hoveredAction?.shareId === share.id && hoveredAction?.field === "recipients";
              const isSelected = selectedShares.has(share.id);
              const displayName = editing.getDisplayValue(
                share.id,
                "file",
                "name",
                share.name ?? undefined,
              );
              const displayDescription = editing.getDisplayValue(
                share.id,
                "file",
                "description",
                share.description ?? undefined,
              );

              return (
                <TableRow key={share.id} className="hover:bg-muted/50 transition-colors border-0">
                  <TableCell className="h-12 px-4 border-0">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked: boolean) => handleSelectShare(share.id, checked)}
                      aria-label={t("sharesTable.selectShare", { shareName: share.name ?? "" })}
                    />
                  </TableCell>
                  <TableCell
                    className="h-12 px-4 border-0"
                    onMouseEnter={() => editing.setHoverTarget({ itemId: share.id, field: "name" })}
                    onMouseLeave={() => editing.setHoverTarget(null)}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      {isEditingName ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            ref={editing.inputRef}
                            value={editing.editValue}
                            onChange={(e) => editing.setEditValue(e.target.value)}
                            onKeyDown={editing.handleKeyDown}
                            className="h-8 text-sm font-medium min-w-[200px]"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              void editing.saveEdit();
                            }}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              editing.cancelEdit();
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span
                            className="truncate max-w-[120px] font-medium"
                            title={displayName ?? undefined}
                          >
                            {displayName}
                          </span>
                          <div className="w-6 flex justify-center flex-shrink-0">
                            {isHoveringName && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  editing.startEdit(share.id, "file", "name", displayName ?? "");
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className="h-12 px-4"
                    onMouseEnter={() =>
                      editing.setHoverTarget({ itemId: share.id, field: "description" })
                    }
                    onMouseLeave={() => editing.setHoverTarget(null)}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      {isEditingDescription ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            ref={editing.inputRef}
                            value={editing.editValue}
                            onChange={(e) => editing.setEditValue(e.target.value)}
                            onKeyDown={editing.handleKeyDown}
                            className="h-8 text-sm min-w-[250px]"
                            placeholder={t("shareActions.addDescriptionPlaceholder")}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 dark:hover:text-emerald-300 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              void editing.saveEdit();
                            }}
                          >
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              editing.cancelEdit();
                            }}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                          <span
                            className="text-muted-foreground truncate max-w-[100px]"
                            title={displayDescription || "-"}
                          >
                            {displayDescription || "-"}
                          </span>
                          <div className="w-6 flex justify-center flex-shrink-0">
                            {isHoveringDescription && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  editing.startEdit(
                                    share.id,
                                    "file",
                                    "description",
                                    displayDescription || "",
                                  );
                                }}
                              >
                                <Pencil className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4">
                    {formatDateTime(share.createdAt, "table", locale)}
                  </TableCell>
                  <TableCell
                    className="h-12 px-4"
                    onMouseEnter={() =>
                      setHoveredAction({ shareId: share.id, field: "expiration" })
                    }
                    onMouseLeave={() => setHoveredAction(null)}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-sm">
                        {share.expiration
                          ? formatDateTime(share.expiration, "table", locale)
                          : t("sharesTable.never")}
                      </span>
                      <div className="w-6 flex justify-center flex-shrink-0">
                        {isHoveringExpiration && onUpdateExpiration && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateExpiration(share);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4">
                    <Badge
                      variant="secondary"
                      className={
                        !share.expiration || new Date(share.expiration) > new Date()
                          ? "bg-green-500/20 hover:bg-green-500/30 text-green-600 dark:text-green-400"
                          : "bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-400"
                      }
                    >
                      {!share.expiration
                        ? t("sharesTable.status.neverExpires")
                        : new Date(share.expiration) > new Date()
                          ? t("sharesTable.status.active")
                          : t("sharesTable.status.expired")}
                    </Badge>
                  </TableCell>
                  <TableCell
                    className="h-12 px-4"
                    onMouseEnter={() => setHoveredAction({ shareId: share.id, field: "security" })}
                    onMouseLeave={() => setHoveredAction(null)}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <Badge
                        variant="secondary"
                        className={`flex items-center gap-1 ${
                          share.security.hasPassword
                            ? "bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-600 dark:text-yellow-400"
                            : "bg-green-500/20 hover:bg-green-500/30 text-green-600 dark:text-green-400"
                        }`}
                      >
                        {share.security.hasPassword ? (
                          <Lock className="h-4 w-4" />
                        ) : (
                          <LockOpen className="h-4 w-4" />
                        )}
                        {share.security.hasPassword
                          ? t("sharesTable.security.protected")
                          : t("sharesTable.security.public")}
                      </Badge>
                      <div className="w-6 flex justify-center flex-shrink-0">
                        {isHoveringSecurity && onUpdateSecurity && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
                            onClick={(e) => {
                              e.stopPropagation();
                              onUpdateSecurity(share);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell
                    className="h-12 px-4"
                    onMouseEnter={() => setHoveredAction({ shareId: share.id, field: "files" })}
                    onMouseLeave={() => setHoveredAction(null)}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-sm">
                        {share.files?.length || 0} {t("sharesTable.filesCount")} •{" "}
                        {share.folders?.length || 0} {t("sharesTable.folderCount")}
                      </span>
                      <div className="w-6 flex justify-center flex-shrink-0">
                        {isHoveringFiles && onManageFiles && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
                            onClick={(e) => {
                              e.stopPropagation();
                              onManageFiles(share);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell
                    className="h-12 px-4"
                    onMouseEnter={() =>
                      setHoveredAction({ shareId: share.id, field: "recipients" })
                    }
                    onMouseLeave={() => setHoveredAction(null)}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="text-sm">
                        {share.recipients?.length || 0} {t("sharesTable.recipientsCount")}
                      </span>
                      <div className="w-6 flex justify-center flex-shrink-0">
                        {isHoveringRecipients && onManageRecipients && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-muted-foreground hover:text-foreground hidden sm:block"
                            onClick={(e) => {
                              e.stopPropagation();
                              onManageRecipients(share);
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4 text-end">
                    <ShareRowActions
                      share={share}
                      smtpEnabled={smtpEnabled}
                      onDelete={onDelete}
                      onEdit={onEdit}
                      onManageFiles={onManageFiles}
                      onManageRecipients={onManageRecipients}
                      onViewDetails={onViewDetails}
                      onGenerateLink={onGenerateLink}
                      onCopyLink={onCopyLink}
                      onNotifyRecipients={onNotifyRecipients}
                      onViewQrCode={onViewQrCode}
                      onDownloadShareFiles={onDownloadShareFiles}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
