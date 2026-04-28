import { useEffect, useRef, useState } from "react";
import { IconCheck, IconEdit, IconLock, IconLockOpen, IconX } from "@tabler/icons-react";
import { format } from "date-fns";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Share } from "@/http/endpoints/shares/types";
import { useShareContext } from "../../contexts/share-context";
import { SharesTableBulkActions } from "./shares-table-bulk-actions";
import { ShareRowActions } from "./shares-table-row-actions";

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
  const { smtpEnabled } = useShareContext();
  const [editingField, setEditingField] = useState<{ shareId: string; field: "name" | "description" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [hoveredField, setHoveredField] = useState<{
    shareId: string;
    field: "name" | "description" | "security" | "expiration" | "files" | "recipients";
  } | null>(null);
  const [pendingChanges, setPendingChanges] = useState<{ [shareId: string]: { name?: string; description?: string } }>(
    {}
  );
  const [selectedShares, setSelectedShares] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingField]);

  useEffect(() => {
    setPendingChanges({});
  }, [shares]);

  useEffect(() => {
    setSelectedShares(new Set());
  }, [shares]);

  useEffect(() => {
    const clearSelection = () => setSelectedShares(new Set());
    setClearSelectionCallback?.(clearSelection);
  }, [setClearSelectionCallback]);

  const startEdit = (shareId: string, field: "name" | "description", currentValue: string) => {
    setEditingField({ shareId, field });
    setEditValue(currentValue || "");
  };

  const saveEdit = () => {
    if (!editingField) return;

    const { shareId, field } = editingField;

    setPendingChanges((prev) => ({
      ...prev,
      [shareId]: { ...prev[shareId], [field]: editValue },
    }));

    if (field === "name") {
      onUpdateName(shareId, editValue);
    } else {
      onUpdateDescription(shareId, editValue);
    }

    setEditingField(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingField(null);
    setEditValue("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      saveEdit();
    } else if (e.key === "Escape") {
      cancelEdit();
    }
  };

  const getDisplayValue = (share: Share, field: "name" | "description"): string | null | undefined => {
    const pendingChange = pendingChanges[share.id];
    if (pendingChange && pendingChange[field] !== undefined) {
      return pendingChange[field];
    }
    return field === "name" ? share.name : share.description;
  };

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
              const isEditingName = editingField?.shareId === share.id && editingField?.field === "name";
              const isEditingDescription = editingField?.shareId === share.id && editingField?.field === "description";
              const isHoveringName = hoveredField?.shareId === share.id && hoveredField?.field === "name";
              const isHoveringDescription = hoveredField?.shareId === share.id && hoveredField?.field === "description";
              const isHoveringSecurity = hoveredField?.shareId === share.id && hoveredField?.field === "security";
              const isHoveringExpiration = hoveredField?.shareId === share.id && hoveredField?.field === "expiration";
              const isHoveringFiles = hoveredField?.shareId === share.id && hoveredField?.field === "files";
              const isHoveringRecipients = hoveredField?.shareId === share.id && hoveredField?.field === "recipients";
              const isSelected = selectedShares.has(share.id);
              const displayName = getDisplayValue(share, "name");
              const displayDescription = getDisplayValue(share, "description");

              return (
                <TableRow key={share.id} className="hover:bg-muted/50 transition-colors border-0">
                  <TableCell className="h-12 px-4 border-0">
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={(checked: boolean) => handleSelectShare(share.id, checked)}
                      aria-label={t("sharesTable.selectShare", { shareName: share.name ?? "" })}
                    />
                  </TableCell>
                  <TableCell className="h-12 px-4 border-0">
                    <div
                      className="flex items-center gap-1 min-w-0"
                      onMouseEnter={() => setHoveredField({ shareId: share.id, field: "name" })}
                      onMouseLeave={() => setHoveredField(null)}
                    >
                      {isEditingName ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="h-8 text-sm font-medium min-w-[200px]"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-green-600 hover:text-green-700 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveEdit();
                            }}
                          >
                            <IconCheck className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-red-600 hover:text-red-700 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEdit();
                            }}
                          >
                            <IconX className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 flex-1 min-w-0">
                           <span className="truncate max-w-[120px] font-medium" title={displayName ?? undefined}>
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
                                   startEdit(share.id, "name", displayName ?? "");
                                 }}
                              >
                                <IconEdit className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4">
                    <div
                      className="flex items-center gap-1 min-w-0"
                      onMouseEnter={() => setHoveredField({ shareId: share.id, field: "description" })}
                      onMouseLeave={() => setHoveredField(null)}
                    >
                      {isEditingDescription ? (
                        <div className="flex items-center gap-1 flex-1">
                          <Input
                            ref={inputRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={handleKeyDown}
                            className="h-8 text-sm min-w-[250px]"
                            placeholder={t("shareActions.addDescriptionPlaceholder")}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-green-600 hover:text-green-700 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              saveEdit();
                            }}
                          >
                            <IconCheck className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-red-600 hover:text-red-700 flex-shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              cancelEdit();
                            }}
                          >
                            <IconX className="h-4 w-4" />
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
                                  startEdit(share.id, "description", displayDescription || "");
                                }}
                              >
                                <IconEdit className="h-3 w-3" />
                              </Button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4">{format(new Date(share.createdAt), "MM/dd/yyyy HH:mm")}</TableCell>
                  <TableCell className="h-12 px-4">
                    <div
                      className="flex items-center gap-1 min-w-0"
                      onMouseEnter={() => setHoveredField({ shareId: share.id, field: "expiration" })}
                      onMouseLeave={() => setHoveredField(null)}
                    >
                      <span className="text-sm">
                        {share.expiration
                          ? format(new Date(share.expiration), "MM/dd/yyyy HH:mm")
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
                            <IconEdit className="h-3 w-3" />
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
                          ? "bg-green-500/20 hover:bg-green-500/30 text-green-500"
                          : "bg-red-500/20 hover:bg-red-500/30 text-red-500"
                      }
                    >
                      {!share.expiration
                        ? t("sharesTable.status.neverExpires")
                        : new Date(share.expiration) > new Date()
                          ? t("sharesTable.status.active")
                          : t("sharesTable.status.expired")}
                    </Badge>
                  </TableCell>
                  <TableCell className="h-12 px-4">
                    <div
                      className="flex items-center gap-1 min-w-0"
                      onMouseEnter={() => setHoveredField({ shareId: share.id, field: "security" })}
                      onMouseLeave={() => setHoveredField(null)}
                    >
                      <Badge
                        variant="secondary"
                        className={`flex items-center gap-1 ${
                          share.security.hasPassword
                            ? "bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-500"
                            : "bg-green-500/20 hover:bg-green-500/30 text-green-500"
                        }`}
                      >
                        {share.security.hasPassword ? (
                          <IconLock className="h-4 w-4" />
                        ) : (
                          <IconLockOpen className="h-4 w-4" />
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
                            <IconEdit className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4">
                    <div
                      className="flex items-center gap-1 min-w-0"
                      onMouseEnter={() => setHoveredField({ shareId: share.id, field: "files" })}
                      onMouseLeave={() => setHoveredField(null)}
                    >
                      <span className="text-sm">
                        {share.files?.length || 0} {t("sharesTable.filesCount")} • {share.folders?.length || 0}{" "}
                        {t("sharesTable.folderCount")}
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
                            <IconEdit className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4">
                    <div
                      className="flex items-center gap-1 min-w-0"
                      onMouseEnter={() => setHoveredField({ shareId: share.id, field: "recipients" })}
                      onMouseLeave={() => setHoveredField(null)}
                    >
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
                            <IconEdit className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="h-12 px-4 text-right">
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
