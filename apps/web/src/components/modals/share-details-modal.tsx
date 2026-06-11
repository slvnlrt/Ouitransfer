"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader } from "@/components/ui/loader";
import { useAuth } from "@/contexts/auth-context";
import { getShare } from "@/http/endpoints";
import type { Share } from "@/http/endpoints/shares/types";
import { logger } from "@/lib/logger";
import { queryKeys } from "@/lib/query-keys";
import { GenerateShareLinkModal } from "./generate-share-link-modal";
import { QrCodeModal } from "./qr-code-modal";
import { ShareDetailsActivitySection } from "./share-details/share-details-activity-section";
import { ShareDetailsDatesSection } from "./share-details/share-details-dates-section";
import { ShareDetailsFilesList } from "./share-details/share-details-files-list";
import { ShareDetailsInfoSection } from "./share-details/share-details-info-section";
import { ShareDetailsLinksSection } from "./share-details/share-details-links-section";
import { ShareDetailsQrSection } from "./share-details/share-details-qr-section";
import { ShareDetailsRecipientsList } from "./share-details/share-details-recipients-list";
import { ShareDetailsSecuritySection } from "./share-details/share-details-security-section";
import { ShareExpirationModal } from "./share-expiration-modal";
import { ShareSecurityModal } from "./share-security-modal";

interface ShareDetailsModalProps {
  shareId: string | null;
  onClose: () => void;
  onUpdateName?: (shareId: string, newName: string) => Promise<void>;
  onUpdateDescription?: (shareId: string, newDescription: string) => Promise<void>;
  onGenerateLink?: (shareId: string, alias: string) => Promise<void>;
  onManageFiles?: (share: Share) => void;
  onManageRecipients?: (share: Share) => void;
  onUpdateSecurity?: (shareId: string) => Promise<void>;
  onUpdateExpiration?: (shareId: string) => Promise<void>;
  refreshTrigger?: number;
  onSuccess?: () => void;
}

export function ShareDetailsModal({
  shareId,
  onClose,
  onUpdateName,
  onUpdateDescription,
  onGenerateLink,
  onManageFiles,
  onManageRecipients,
  onUpdateSecurity,
  onUpdateExpiration,
  refreshTrigger,
  onSuccess,
}: ShareDetailsModalProps) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [editingField, setEditingField] = useState<{ field: "name" | "description" } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [pendingChanges, setPendingChanges] = useState<{ name?: string; description?: string }>({});
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [showSecurityModal, setShowSecurityModal] = useState(false);
  const [showExpirationModal, setShowExpirationModal] = useState(false);
  const [showQrCodeModal, setShowQrCodeModal] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const shareQuery = useQuery({
    queryKey: queryKeys.shares.detail(shareId!),
    queryFn: async () => {
      const response = await getShare(shareId!);
      return response.data.share;
    },
    enabled: !!shareId,
  });

  const share = shareQuery.data ?? null;

  const invalidateShare = () => {
    // Invalidate the specific share detail and the list (e.g. name/description changes
    // should be reflected in the shares list), but avoid the overly broad .all key
    // which would also bust visit/alias/metadata caches unnecessarily.
    queryClient.invalidateQueries({ queryKey: queryKeys.shares.detail(shareId!) });
    queryClient.invalidateQueries({ queryKey: queryKeys.shares.list() });
    // Also invalidate the byAlias cache if this share has an alias, so the public
    // share page reflects changes (e.g. name, description, expiration).
    if (share?.alias?.alias) {
      queryClient.invalidateQueries({ queryKey: queryKeys.shares.byAlias(share.alias.alias) });
    }
  };

  useEffect(() => {
    if (refreshTrigger) {
      invalidateShare();
    }
    // invalidateShare is recreated each render but only reads stable refs (queryClient,
    // shareId, share.alias); re-running solely on refreshTrigger is intentional.
  }, [refreshTrigger]);

  useEffect(() => {
    if (editingField && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingField]);

  useEffect(() => {
    setPendingChanges({});
  }, [share]);

  const startEdit = (field: "name" | "description", currentValue: string) => {
    setEditingField({ field });
    setEditValue(currentValue || "");
  };

  const saveEdit = async () => {
    if (!editingField || !shareId) return;

    const { field } = editingField;

    setPendingChanges((prev) => ({
      ...prev,
      [field]: editValue,
    }));

    try {
      if (field === "name" && onUpdateName) {
        await onUpdateName(shareId, editValue);
      } else if (field === "description" && onUpdateDescription) {
        await onUpdateDescription(shareId, editValue);
      }

      invalidateShare();
      if (onSuccess) {
        onSuccess();
      }
    } catch (error) {
      logger.error("Failed to update:", {
        err: error instanceof Error ? error.message : String(error),
      });

      setPendingChanges((prev) => {
        const newState = { ...prev };
        delete newState[field];
        return newState;
      });
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

  const getDisplayValue = (field: "name" | "description") => {
    const pendingChange = pendingChanges[field];
    if (pendingChange !== undefined) {
      return pendingChange;
    }
    return field === "name" ? share?.name : share?.description;
  };

  const handleLinkGenerated = () => {
    setShowLinkModal(false);
    invalidateShare();
    if (onSuccess) {
      onSuccess();
    }
  };

  const handleSecurityUpdated = () => {
    setShowSecurityModal(false);
    invalidateShare();
    if (onSuccess) {
      onSuccess();
    }
  };

  const handleExpirationUpdated = () => {
    setShowExpirationModal(false);
    invalidateShare();
    if (onSuccess) {
      onSuccess();
    }
  };

  // Early return is after all hooks to maintain consistent hook count per React rules.
  // Query is disabled when shareId is null, so no hooks are skipped — early return is safe.
  if (!shareId) return null;

  const shareLink = share?.alias?.alias ? `${window.location.origin}/s/${share.alias.alias}` : null;
  // Defensive guard: only allow editing when the current user is the share creator.
  // The modal can still display read-only information for non-owners.
  const isOwner = !!(user && share?.creatorId && user.id === share.creatorId);
  const isEditingName = editingField?.field === "name";
  const isEditingDescription = editingField?.field === "description";
  const displayName = getDisplayValue("name");
  const displayDescription = getDisplayValue("description");
  const hasFiles = !!(share?.files && share.files.length > 0);
  const hasRecipients = !!(share?.recipients && share.recipients.length > 0);
  // Owners always get the recipients section (even when empty) so they can add the
  // first recipient; non-owners only see it when recipients already exist.
  const canManageRecipients = isOwner && !!onManageRecipients;
  const showRecipients = hasRecipients || canManageRecipients;

  return (
    <>
      <Dialog open={!!shareId} onOpenChange={() => onClose()}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              {t("shareDetails.title")}
            </DialogTitle>
            <DialogDescription>{t("shareDetails.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            {!share ? (
              <div className="flex justify-center py-8">
                <Loader size="lg" />
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center p-2 bg-muted/30 rounded-lg">
                    <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                      {share.views || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("shareDetails.views")}</p>
                  </div>
                  <div className="text-center p-2 bg-muted/30 rounded-lg">
                    <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                      {share.files?.length || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("shareDetails.files")}</p>
                  </div>
                  <div className="text-center p-2 bg-muted/30 rounded-lg">
                    <p className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">
                      {share.recipients?.length || 0}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("shareDetails.recipients")}</p>
                  </div>
                </div>

                <ShareDetailsInfoSection
                  displayName={displayName ?? ""}
                  displayDescription={displayDescription ?? ""}
                  isEditingName={isEditingName}
                  isEditingDescription={isEditingDescription}
                  editValue={editValue}
                  inputRef={inputRef}
                  onUpdateName={isOwner ? onUpdateName : undefined}
                  onUpdateDescription={isOwner ? onUpdateDescription : undefined}
                  onStartEdit={startEdit}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
                  onEditValueChange={setEditValue}
                  onKeyDown={handleKeyDown}
                />

                {/* Link + QR side by side when a link exists; the link section spans full
                    width otherwise (it then shows the "generate link" affordance). */}
                {shareLink ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <ShareDetailsLinksSection
                      shareLink={shareLink}
                      onEditLink={
                        isOwner && onGenerateLink ? () => setShowLinkModal(true) : undefined
                      }
                    />
                    <ShareDetailsQrSection
                      shareLink={shareLink}
                      shareName={share.name ?? undefined}
                      onShowQrCode={() => setShowQrCodeModal(true)}
                    />
                  </div>
                ) : (
                  <ShareDetailsLinksSection
                    shareLink={shareLink}
                    onEditLink={
                      isOwner && onGenerateLink ? () => setShowLinkModal(true) : undefined
                    }
                  />
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <ShareDetailsDatesSection
                    share={share}
                    onEditExpiration={
                      isOwner && onUpdateExpiration ? () => setShowExpirationModal(true) : undefined
                    }
                  />

                  <ShareDetailsSecuritySection
                    share={share}
                    onEditSecurity={
                      isOwner && onUpdateSecurity ? () => setShowSecurityModal(true) : undefined
                    }
                  />
                </div>

                {/* Files and recipients sit side by side when both are present (each list
                    scrolls internally so uneven lengths don't desync the columns); a single
                    present list spans full width. */}
                {(hasFiles || showRecipients) && (
                  <div
                    className={
                      hasFiles && showRecipients
                        ? "grid grid-cols-1 lg:grid-cols-2 gap-4 items-start"
                        : undefined
                    }
                  >
                    {hasFiles && (
                      <ShareDetailsFilesList
                        files={share.files}
                        onManageFiles={isOwner ? onManageFiles : undefined}
                        share={share}
                      />
                    )}

                    {showRecipients && (
                      <ShareDetailsRecipientsList
                        recipients={share.recipients ?? []}
                        onManageRecipients={canManageRecipients ? onManageRecipients : undefined}
                        share={share}
                      />
                    )}
                  </div>
                )}

                {isOwner && <ShareDetailsActivitySection shareId={share.id} />}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={onClose}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {showLinkModal && shareId && (
        <GenerateShareLinkModal
          shareId={shareId}
          share={share}
          onClose={() => setShowLinkModal(false)}
          onSuccess={handleLinkGenerated}
          onGenerate={onGenerateLink || (() => Promise.resolve())}
        />
      )}
      {showSecurityModal && shareId && onUpdateSecurity && (
        <ShareSecurityModal
          shareId={shareId}
          share={share}
          onClose={() => setShowSecurityModal(false)}
          onSuccess={handleSecurityUpdated}
        />
      )}
      {showExpirationModal && shareId && onUpdateExpiration && (
        <ShareExpirationModal
          shareId={shareId}
          share={share}
          onClose={() => setShowExpirationModal(false)}
          onSuccess={handleExpirationUpdated}
        />
      )}
      {showQrCodeModal && shareLink && (
        <QrCodeModal
          isOpen={showQrCodeModal}
          onClose={() => setShowQrCodeModal(false)}
          shareLink={shareLink}
          shareName={share?.name || t("shareDetails.untitled")}
        />
      )}
    </>
  );
}
