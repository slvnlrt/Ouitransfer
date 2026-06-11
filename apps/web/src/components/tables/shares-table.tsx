import { Check, Pencil, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState } from "react";

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
import { getShareLifecycleState } from "@/lib/share-lifecycle";
import { ShareNoLinkBadge, ShareSecurityBadge, ShareStatusBadge } from "./shares-table-badges";
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
  onPauseShare?: (share: Share) => void;
  onResumeShare?: (share: Share) => void;
  onRenewShare?: (share: Share) => void;
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
  onPauseShare,
  onResumeShare,
  onRenewShare,
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

  // Additional hover state for non-editable fields (security, expiration, and the
  // merged files/recipients cell)
  const [hoveredAction, setHoveredAction] = useState<{
    shareId: string;
    field: "security" | "expiration" | "files";
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

      {/* Desktop / tablet: full table */}
      <div className="hidden md:block rounded-lg shadow-sm overflow-hidden border">
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
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4 whitespace-normal leading-tight">
                {t("sharesTable.columns.createdAt")} / {t("sharesTable.columns.expiresAt")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.status")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4">
                {t("sharesTable.columns.security")}
              </TableHead>
              <TableHead className="h-10 text-xs font-bold text-muted-foreground bg-muted/50 px-4 whitespace-normal leading-tight">
                {t("sharesTable.columns.files")} / {t("sharesTable.columns.recipients")}
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
              // Files and recipients share one merged cell; hovering anywhere in it
              // reveals both edit affordances.
              const isHoveringFilesCell =
                hoveredAction?.shareId === share.id && hoveredAction?.field === "files";
              const isSelected = selectedShares.has(share.id);
              const lifecycle = getShareLifecycleState(share);
              const isDeactivated = lifecycle.kind === "deactivated";
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
                <TableRow
                  key={share.id}
                  className={`hover:bg-muted/50 transition-colors border-0 ${
                    isDeactivated ? "bg-muted/30" : ""
                  }`}
                  data-deactivated={isDeactivated || undefined}
                >
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
                            className="truncate max-w-[140px] lg:max-w-[220px] xl:max-w-[300px] font-medium"
                            title={displayName ?? undefined}
                          >
                            {displayName}
                          </span>
                          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
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
                            className="text-muted-foreground truncate max-w-[120px] lg:max-w-[200px] xl:max-w-[260px]"
                            title={displayDescription || "-"}
                          >
                            {displayDescription || "-"}
                          </span>
                          <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
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
                  <TableCell
                    className="h-12 px-4"
                    onMouseEnter={() =>
                      setHoveredAction({ shareId: share.id, field: "expiration" })
                    }
                    onMouseLeave={() => setHoveredAction(null)}
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span
                        className="text-sm truncate"
                        title={formatDateTime(share.createdAt, "table", locale)}
                      >
                        {formatDateTime(share.createdAt, "table", locale)}
                      </span>
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs text-muted-foreground truncate">
                          {share.expiration
                            ? formatDateTime(share.expiration, "table", locale)
                            : t("sharesTable.never")}
                        </span>
                        <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
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
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4">
                    <div className="flex flex-wrap items-center gap-1">
                      <ShareStatusBadge share={share} lifecycle={lifecycle} />
                      <ShareNoLinkBadge share={share} />
                    </div>
                  </TableCell>
                  <TableCell
                    className="h-12 px-4"
                    onMouseEnter={() => setHoveredAction({ shareId: share.id, field: "security" })}
                    onMouseLeave={() => setHoveredAction(null)}
                  >
                    <div className="flex items-center gap-1 min-w-0">
                      <ShareSecurityBadge share={share} />
                      <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
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
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-sm truncate">
                          {share.files?.length || 0} {t("sharesTable.filesCount")} •{" "}
                          {share.folders?.length || 0} {t("sharesTable.folderCount")}
                        </span>
                        <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                          {isHoveringFilesCell && onManageFiles && (
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
                      <div className="flex items-center gap-1 min-w-0">
                        <span className="text-xs text-muted-foreground truncate">
                          {share.recipients?.length || 0} {t("sharesTable.recipientsCount")}
                        </span>
                        <div className="w-6 h-6 flex items-center justify-center flex-shrink-0">
                          {isHoveringFilesCell && onManageRecipients && (
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
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4 text-end">
                    <ShareRowActions
                      share={share}
                      lifecycle={lifecycle}
                      smtpEnabled={smtpEnabled}
                      onDelete={onDelete}
                      onEdit={onEdit}
                      onPauseShare={onPauseShare}
                      onResumeShare={onResumeShare}
                      onRenewShare={onRenewShare}
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

      {/* Mobile: stacked cards (the table never fits on a narrow viewport) */}
      <div className="md:hidden space-y-3">
        {shares.map((share) => {
          const lifecycle = getShareLifecycleState(share);
          const isDeactivated = lifecycle.kind === "deactivated";
          const isSelected = selectedShares.has(share.id);

          return (
            <div
              key={share.id}
              className={`rounded-lg border shadow-sm p-4 flex flex-col gap-3 ${
                isDeactivated ? "bg-muted/30" : "bg-card"
              }`}
              data-deactivated={isDeactivated || undefined}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-3 min-w-0">
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked: boolean) => handleSelectShare(share.id, checked)}
                    aria-label={t("sharesTable.selectShare", { shareName: share.name ?? "" })}
                    className="mt-1 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="font-medium truncate" title={share.name ?? undefined}>
                      {share.name || "-"}
                    </p>
                    {share.description && (
                      <p
                        className="text-sm text-muted-foreground truncate"
                        title={share.description}
                      >
                        {share.description}
                      </p>
                    )}
                  </div>
                </div>
                <ShareRowActions
                  share={share}
                  lifecycle={lifecycle}
                  smtpEnabled={smtpEnabled}
                  onDelete={onDelete}
                  onEdit={onEdit}
                  onPauseShare={onPauseShare}
                  onResumeShare={onResumeShare}
                  onRenewShare={onRenewShare}
                  onManageFiles={onManageFiles}
                  onManageRecipients={onManageRecipients}
                  onViewDetails={onViewDetails}
                  onGenerateLink={onGenerateLink}
                  onCopyLink={onCopyLink}
                  onNotifyRecipients={onNotifyRecipients}
                  onViewQrCode={onViewQrCode}
                  onDownloadShareFiles={onDownloadShareFiles}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <ShareStatusBadge share={share} lifecycle={lifecycle} />
                <ShareNoLinkBadge share={share} />
                <ShareSecurityBadge share={share} />
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div className="flex flex-col gap-0.5 min-w-0">
                  <dt className="text-muted-foreground">{t("sharesTable.columns.createdAt")}</dt>
                  <dd className="truncate">{formatDateTime(share.createdAt, "table", locale)}</dd>
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <dt className="text-muted-foreground">{t("sharesTable.columns.expiresAt")}</dt>
                  <dd className="truncate">
                    {share.expiration
                      ? formatDateTime(share.expiration, "table", locale)
                      : t("sharesTable.never")}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <dt className="text-muted-foreground">{t("sharesTable.columns.files")}</dt>
                  <dd className="truncate">
                    {share.files?.length || 0} {t("sharesTable.filesCount")} •{" "}
                    {share.folders?.length || 0} {t("sharesTable.folderCount")}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <dt className="text-muted-foreground">{t("sharesTable.columns.recipients")}</dt>
                  <dd className="truncate">
                    {share.recipients?.length || 0} {t("sharesTable.recipientsCount")}
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>
    </div>
  );
}
