"use client";

import {
  Copy,
  Download,
  Info,
  Link,
  Link2Off,
  Lock,
  LockOpen,
  Pencil,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Label } from "@/components/ui/label";
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useQrDownload } from "@/hooks/use-qr-download";
import { logger } from "@/lib/logger";
import { generateQrFilename } from "@/utils/qr-download";
import { useReverseShareDetails } from "../hooks/use-reverse-share-details";
import type { ReverseShare } from "../hooks/use-reverse-shares";
import { BackgroundImagePicker } from "./background-image-picker";
import { EditPasswordModal } from "./edit-password-modal";
import { EditableField } from "./editable-field";
import { FileSizeInput } from "./file-size-input";
import { FileTypesTagsInput } from "./file-types-tags-input";
import { GenerateAliasModal } from "./generate-alias-modal";
import { ReceivedFilesSection } from "./received-files-section";
import { ReverseShareRecipientSelector } from "./reverse-share-recipient-selector";
import { ReverseShareStats } from "./reverse-share-stats";

interface ReverseShareDetailsModalProps {
  reverseShare: ReverseShare | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateReverseShare?: (id: string, data: Record<string, unknown>) => Promise<unknown>;
  onCreateAlias?: (reverseShareId: string, alias: string) => Promise<void>;
  onCopyLink?: (reverseShare: ReverseShare) => void;
  onToggleActive?: (id: string, isActive: boolean) => Promise<unknown>;
  onUpdatePassword?: (
    id: string,
    data: { hasPassword: boolean; password?: string },
  ) => Promise<unknown>;
  onViewQrCode?: (reverseShare: ReverseShare) => void;
  refreshTrigger?: number;
  onSuccess?: () => void;
}

export function ReverseShareDetailsModal({
  reverseShare,
  isOpen,
  onClose,
  onUpdateReverseShare,
  onCreateAlias,
  onCopyLink,
  onToggleActive,
  onUpdatePassword,
  onViewQrCode,
  onSuccess,
}: ReverseShareDetailsModalProps) {
  const t = useTranslations();
  const notifyUploadSwitchId = useId();
  const bypassCooldownSwitchId = useId();
  const qrContainerRef = useRef<HTMLButtonElement>(null);
  const { isDownloading, downloadQr } = useQrDownload();
  const [pendingChanges, setPendingChanges] = useState<
    Record<string, string | number | boolean | null | undefined>
  >({});

  const {
    showAliasModal,
    setShowAliasModal,
    showPasswordModal,
    setShowPasswordModal,
    formatDate,
    formatFileSize,
    getDisplayValue,
    generateReverseShareLink,
  } = useReverseShareDetails();

  useEffect(() => {
    setPendingChanges({});
  }, [
    reverseShare?.id,
    reverseShare?.hasPassword,
    reverseShare?.isActive,
    reverseShare?.alias?.alias,
  ]);

  const handleUpdateFields = async (
    changes: Record<string, string | number | boolean | null | undefined>,
  ) => {
    if (!reverseShare || !onUpdateReverseShare) return;

    setPendingChanges((prev) => ({ ...prev, ...changes }));

    try {
      await onUpdateReverseShare(reverseShare.id, changes);
      onSuccess?.();
    } catch (error) {
      logger.error("Failed to update:", {
        err: error instanceof Error ? error.message : String(error),
      });
      setPendingChanges((prev) => {
        const newState = { ...prev };
        for (const field of Object.keys(changes)) {
          delete newState[field];
        }
        return newState;
      });
    }
  };

  const handleUpdateField = (field: string, value: string | number | boolean | null) =>
    handleUpdateFields({ [field]: value });

  const handleCopyLink = () => {
    if (reverseShare && onCopyLink) {
      onCopyLink(reverseShare);
    }
  };

  const handleOpenLink = () => {
    if (reverseShare?.alias?.alias) {
      const link = generateReverseShareLink(reverseShare.alias.alias);
      if (link) window.open(link, "_blank");
    }
  };

  const handleToggleActive = async () => {
    if (reverseShare && onToggleActive) {
      await onToggleActive(reverseShare.id, !reverseShare.isActive);
      onSuccess?.();
    }
  };

  const handleModalSuccess = () => {
    setShowAliasModal(false);
    setShowPasswordModal(false);
    onSuccess?.();
  };

  if (!reverseShare) return null;

  const reverseShareLink = generateReverseShareLink(reverseShare?.alias?.alias);

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Info className="h-5 w-5" />
              {t("reverseShares.modals.details.title")}
            </DialogTitle>
            <DialogDescription>{t("reverseShares.modals.details.description")}</DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-6">
            {/* Statistics */}
            <ReverseShareStats
              filesCount={reverseShare.files?.length || 0}
              maxFiles={reverseShare.maxFiles}
              isActive={reverseShare.isActive}
            />

            <div className="grid grid-cols-2 gap-4">
              {/* Basic Information */}
              <div className="space-y-3">
                <h3 className="text-base font-medium text-foreground border-b pb-2">
                  {t("reverseShares.modals.details.basicInfo")}
                </h3>

                <EditableField
                  label={t("reverseShares.form.name.label")}
                  value={getDisplayValue(reverseShare, "name", pendingChanges)}
                  onSave={(value) => handleUpdateField("name", value)}
                  placeholder={t("reverseShares.card.untitled")}
                  disabled={!onUpdateReverseShare}
                />

                <EditableField
                  label={t("reverseShares.labels.description")}
                  value={getDisplayValue(reverseShare, "description", pendingChanges)}
                  onSave={(value) => handleUpdateField("description", value)}
                  placeholder={t("reverseShares.card.noDescription")}
                  disabled={!onUpdateReverseShare}
                />

                <EditableField
                  label={t("reverseShares.labels.pageLayout")}
                  value={getDisplayValue(reverseShare, "pageLayout", pendingChanges)}
                  onSave={(value) => handleUpdateField("pageLayout", value)}
                  type="select"
                  options={[
                    { value: "DEFAULT", label: t("reverseShares.labels.layoutOptions.default") },
                    {
                      value: "WETRANSFER",
                      label: t("reverseShares.labels.layoutOptions.wetransfer"),
                    },
                  ]}
                  disabled={!onUpdateReverseShare}
                  renderValue={(value) => (
                    <Badge
                      variant="secondary"
                      className="bg-purple-500/20 text-purple-700 border-purple-200"
                    >
                      {value === "WETRANSFER"
                        ? t("reverseShares.labels.layoutOptions.wetransfer")
                        : t("reverseShares.labels.layoutOptions.default")}
                    </Badge>
                  )}
                />

                {getDisplayValue(reverseShare, "pageLayout", pendingChanges) === "WETRANSFER" && (
                  <div className="space-y-2">
                    <BackgroundImagePicker
                      value={getDisplayValue(reverseShare, "backgroundImageId", pendingChanges)}
                      onChange={(id) => handleUpdateField("backgroundImageId", id)}
                    />
                  </div>
                )}
              </div>

              {/* QR Code */}
              {reverseShareLink && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 border-b pb-2">
                    <button
                      type="button"
                      className="text-base font-medium text-foreground cursor-pointer bg-transparent border-0 p-0"
                      onClick={() => onViewQrCode?.(reverseShare)}
                    >
                      {t("qrCodeModal.title")}
                    </button>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-5 w-5 text-muted-foreground hover:text-foreground"
                          onClick={() =>
                            downloadQr(
                              qrContainerRef.current,
                              generateQrFilename(reverseShare?.name, "reverse-share"),
                            )
                          }
                          disabled={isDownloading}
                        >
                          <Download className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("qrCodeModal.download")}</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="flex flex-col items-start justify-start">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          ref={qrContainerRef}
                          type="button"
                          className="p-2 bg-card rounded-lg cursor-pointer hover:opacity-80 transition-opacity duration-300 border-0"
                          onClick={() => onViewQrCode?.(reverseShare)}
                        >
                          <LazyQRCode
                            value={reverseShareLink}
                            size={100}
                            level="H"
                            fgColor="#000000"
                            bgColor="#FFFFFF"
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t("reverseShares.actions.viewQrCode")}</TooltipContent>
                    </Tooltip>
                  </div>
                </div>
              )}
            </div>

            {/* Share Link */}
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-b pb-2">
                <h3 className="text-base font-medium text-foreground">
                  {t("reverseShares.modals.details.linkSection")}
                </h3>
                {onCreateAlias && reverseShareLink && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-5 w-5 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowAliasModal(true)}
                      >
                        <Pencil className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("reverseShares.modals.details.editAlias")}</TooltipContent>
                  </Tooltip>
                )}
              </div>

              {reverseShareLink ? (
                <div className="flex gap-2">
                  <Input
                    value={reverseShareLink}
                    readOnly
                    className="flex-1 bg-muted/30 text-sm h-8"
                  />
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleCopyLink}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("reverseShares.modals.details.copyLink")}</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        onClick={handleOpenLink}
                      >
                        <Link className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("reverseShares.modals.details.openLink")}</TooltipContent>
                  </Tooltip>
                </div>
              ) : onCreateAlias ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      asChild
                      variant="outline"
                      className="flex items-center gap-1 border-dashed text-muted-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground"
                    >
                      <button
                        type="button"
                        aria-label={t("reverseShares.modals.details.createAlias")}
                        onClick={() => setShowAliasModal(true)}
                      >
                        <Link2Off className="h-3 w-3" />
                        {t("reverseShares.labels.noLinkCreated")}
                      </button>
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{t("reverseShares.modals.details.createAlias")}</TooltipContent>
                </Tooltip>
              ) : (
                <div className="flex items-center justify-between p-2 bg-muted/20 rounded-lg">
                  <p className="text-sm text-muted-foreground">
                    {t("reverseShares.labels.noLinkCreated")}
                  </p>
                </div>
              )}
            </div>

            {/* Settings and Limits */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-3">
                <h3 className="text-base font-medium text-foreground border-b pb-2">
                  {t("reverseShares.labels.limits")}
                </h3>

                <EditableField
                  label={t("reverseShares.labels.maxFiles")}
                  value={getDisplayValue(reverseShare, "maxFiles", pendingChanges)}
                  onSave={(value) => handleUpdateField("maxFiles", value)}
                  type="number"
                  disabled={!onUpdateReverseShare}
                  checkboxLabel={t("reverseShares.labels.noFilesLimit")}
                  checkboxCondition={(value) => !value || value === 0}
                  onCheckboxChange={(checked, setValue) => {
                    if (checked) setValue("0");
                  }}
                  renderValue={(value) => value || t("reverseShares.labels.noLimit")}
                />

                <EditableField
                  label={t("reverseShares.labels.maxFileSize")}
                  value={getDisplayValue(reverseShare, "maxFileSize", pendingChanges)}
                  onSave={(value) => handleUpdateField("maxFileSize", value)}
                  disabled={!onUpdateReverseShare}
                  checkboxLabel={t("reverseShares.labels.noSizeLimit")}
                  checkboxCondition={(value) => !value || value === 0}
                  onCheckboxChange={(checked, setValue) => {
                    if (checked) setValue("0");
                  }}
                  renderValue={(value) => formatFileSize(value ?? null)}
                  customEditor={(props) => <FileSizeInput {...props} />}
                />

                <EditableField
                  label={t("reverseShares.labels.allowedTypes")}
                  value={getDisplayValue(reverseShare, "allowedFileTypes", pendingChanges)}
                  onSave={(value) => handleUpdateField("allowedFileTypes", value)}
                  disabled={!onUpdateReverseShare}
                  checkboxLabel={t("reverseShares.labels.allFileTypes")}
                  checkboxCondition={(value) =>
                    !value || (typeof value === "string" && value.trim() === "")
                  }
                  onCheckboxChange={(checked, setValue) => {
                    if (checked) setValue("");
                  }}
                  renderValue={(value) => value || t("reverseShares.modals.details.allTypes")}
                  customEditor={(props) => (
                    <FileTypesTagsInput
                      value={props.value ? props.value.split(",").filter(Boolean) : []}
                      onChange={(tags) => props.onChange(tags.join(","))}
                      placeholder="jpg png pdf docx"
                      className="h-7 text-sm"
                    />
                  )}
                />
              </div>

              <div className="space-y-3">
                <h3 className="text-base font-medium text-foreground border-b pb-2">
                  {t("reverseShares.modals.details.securityAndStatus")}
                </h3>

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {t("reverseShares.modals.details.protection")}
                  </div>
                  <div className="mt-1">
                    {(() => {
                      const isProtected = reverseShare.hasPassword;
                      const cls = isProtected
                        ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 border-yellow-200 dark:border-yellow-800"
                        : "bg-green-500/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800";
                      const icon = isProtected ? (
                        <Lock className="h-3 w-3 me-1" />
                      ) : (
                        <LockOpen className="h-3 w-3 me-1" />
                      );
                      const label = isProtected
                        ? t("reverseShares.modals.details.protectedByPassword")
                        : t("reverseShares.modals.details.publicAccess");

                      if (!onUpdatePassword) {
                        return (
                          <Badge variant="secondary" className={cls}>
                            {icon}
                            {label}
                          </Badge>
                        );
                      }

                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              asChild
                              variant="secondary"
                              className={`${cls} hover:brightness-95 dark:hover:brightness-110 cursor-pointer`}
                            >
                              <button
                                type="button"
                                aria-label={`${label}: ${t("reverseShares.modals.details.editPassword")}`}
                                onClick={() => setShowPasswordModal(true)}
                              >
                                {icon}
                                {label}
                              </button>
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {t("reverseShares.modals.details.editPassword")}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("reverseShares.modals.details.status")}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {(() => {
                      const isActive = reverseShare.isActive;
                      const cls = isActive
                        ? "bg-green-500/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                        : "bg-red-500/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800";
                      const icon = isActive ? (
                        <ToggleRight className="h-3 w-3 me-1" />
                      ) : (
                        <ToggleLeft className="h-3 w-3 me-1" />
                      );
                      const label = isActive
                        ? t("reverseShares.status.active")
                        : t("reverseShares.status.inactive");
                      const actionLabel = isActive
                        ? t("reverseShares.modals.details.deactivate")
                        : t("reverseShares.modals.details.activate");

                      if (!onToggleActive) {
                        return (
                          <Badge variant="secondary" className={cls}>
                            {icon}
                            {label}
                          </Badge>
                        );
                      }

                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge
                              asChild
                              variant="secondary"
                              className={`${cls} hover:brightness-95 dark:hover:brightness-110 cursor-pointer`}
                            >
                              <button
                                type="button"
                                aria-label={`${label}: ${actionLabel}`}
                                onClick={handleToggleActive}
                              >
                                {icon}
                                {label}
                              </button>
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>{actionLabel}</TooltipContent>
                        </Tooltip>
                      );
                    })()}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={
                        pendingChanges.notifyOnUpload !== undefined
                          ? (pendingChanges.notifyOnUpload as boolean)
                          : reverseShare.notifyOnUpload
                      }
                      onCheckedChange={(checked) =>
                        // Turning notifications off also clears the cooldown bypass.
                        handleUpdateFields(
                          checked
                            ? { notifyOnUpload: true }
                            : { notifyOnUpload: false, bypassUploadCooldown: false },
                        )
                      }
                      disabled={!onUpdateReverseShare}
                      id={notifyUploadSwitchId}
                    />
                    <Label htmlFor={notifyUploadSwitchId}>
                      {t("reverseShares.form.notifyOnUpload")}
                    </Label>
                  </div>
                  <p className="text-xs text-muted-foreground ps-9">
                    {t("reverseShares.form.notifyOnUploadHelp")}
                  </p>
                  {(pendingChanges.notifyOnUpload !== undefined
                    ? (pendingChanges.notifyOnUpload as boolean)
                    : reverseShare.notifyOnUpload) && (
                    <div className="space-y-1 ps-9 pt-2">
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={
                            pendingChanges.bypassUploadCooldown !== undefined
                              ? (pendingChanges.bypassUploadCooldown as boolean)
                              : reverseShare.bypassUploadCooldown
                          }
                          onCheckedChange={(checked) =>
                            handleUpdateField("bypassUploadCooldown", checked)
                          }
                          disabled={!onUpdateReverseShare}
                          id={bypassCooldownSwitchId}
                        />
                        <Label htmlFor={bypassCooldownSwitchId}>
                          {t("reverseShares.form.bypassUploadCooldown")}
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground ps-9">
                        {t("reverseShares.form.bypassUploadCooldownHelp")}
                      </p>
                    </div>
                  )}
                </div>

                <EditableField
                  label={t("reverseShares.modals.details.expiration")}
                  value={getDisplayValue(reverseShare, "expiration", pendingChanges)}
                  onSave={(value) => handleUpdateField("expiration", value)}
                  type="datetime-local"
                  disabled={!onUpdateReverseShare}
                  renderValue={(value) =>
                    value
                      ? formatDate(typeof value === "string" ? value : String(value))
                      : t("shareDetails.never")
                  }
                />
              </div>
            </div>

            {/* Field Requirements */}
            <div className="space-y-3">
              <h3 className="text-base font-medium text-foreground border-b pb-2">
                {t("reverseShares.form.fieldRequirements.title")}
              </h3>
              <div className="grid grid-cols-2 gap-4">
                <EditableField
                  label={t("reverseShares.form.nameFieldRequired.label")}
                  value={getDisplayValue(reverseShare, "nameFieldRequired", pendingChanges)}
                  onSave={(value) => handleUpdateField("nameFieldRequired", value)}
                  type="select"
                  options={[
                    { value: "HIDDEN", label: t("reverseShares.labels.fieldOptions.hidden") },
                    { value: "OPTIONAL", label: t("reverseShares.labels.fieldOptions.optional") },
                    { value: "REQUIRED", label: t("reverseShares.labels.fieldOptions.required") },
                  ]}
                  disabled={!onUpdateReverseShare}
                  renderValue={(value) => {
                    if (value === "REQUIRED")
                      return t("reverseShares.labels.fieldOptions.required");
                    if (value === "HIDDEN") return t("reverseShares.labels.fieldOptions.hidden");
                    return t("reverseShares.labels.fieldOptions.optional");
                  }}
                />
                <EditableField
                  label={t("reverseShares.form.emailFieldRequired.label")}
                  value={getDisplayValue(reverseShare, "emailFieldRequired", pendingChanges)}
                  onSave={(value) => handleUpdateField("emailFieldRequired", value)}
                  type="select"
                  options={[
                    { value: "HIDDEN", label: t("reverseShares.labels.fieldOptions.hidden") },
                    { value: "OPTIONAL", label: t("reverseShares.labels.fieldOptions.optional") },
                    { value: "REQUIRED", label: t("reverseShares.labels.fieldOptions.required") },
                  ]}
                  disabled={!onUpdateReverseShare}
                  renderValue={(value) => {
                    if (value === "REQUIRED")
                      return t("reverseShares.labels.fieldOptions.required");
                    if (value === "HIDDEN") return t("reverseShares.labels.fieldOptions.hidden");
                    return t("reverseShares.labels.fieldOptions.optional");
                  }}
                />
              </div>
            </div>

            {/* Recipients */}
            <ReverseShareRecipientSelector
              reverseShareId={reverseShare.id}
              selectedRecipients={reverseShare.recipients ?? []}
              reverseShareAlias={reverseShare.alias?.alias}
              emailFieldRequired={reverseShare.emailFieldRequired}
              onSuccess={() => onSuccess?.()}
            />

            {/* Datas */}
            <div className="space-y-3">
              <h3 className="text-base font-medium text-foreground border-b pb-2">
                {t("reverseShares.modals.details.dates")}
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("reverseShares.modals.details.createdAt")}
                  </div>
                  <div>{formatDate(reverseShare.createdAt)}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("reverseShares.modals.details.updatedAt")}
                  </div>
                  <div>{formatDate(reverseShare.updatedAt)}</div>
                </div>
              </div>
            </div>

            {/* Received Files */}
            <ReceivedFilesSection files={reverseShare.files || []} onFileDeleted={onSuccess} />
          </div>

          <DialogFooter>
            <Button onClick={onClose}>{t("common.close")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {showAliasModal && onCreateAlias && (
        <GenerateAliasModal
          reverseShare={reverseShare}
          isOpen={showAliasModal}
          onClose={() => setShowAliasModal(false)}
          onCreateAlias={onCreateAlias}
          onCopyLink={onCopyLink || (() => {})}
        />
      )}

      {showPasswordModal && onUpdatePassword && (
        <EditPasswordModal
          reverseShare={reverseShare}
          isOpen={showPasswordModal}
          onClose={() => setShowPasswordModal(false)}
          onUpdatePassword={async (
            id: string,
            data: { hasPassword: boolean; password?: string },
          ) => {
            await onUpdatePassword(id, data);
            handleModalSuccess();
          }}
        />
      )}
    </>
  );
}
