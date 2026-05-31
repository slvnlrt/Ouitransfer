"use client";

import {
  Copy,
  Download,
  Link,
  Lock,
  LockOpen,
  Pencil,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
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
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { Switch } from "@/components/ui/switch";
import { logger } from "@/lib/logger";
import { useReverseShareDetails } from "../hooks/use-reverse-share-details";
import type { ReverseShare } from "../hooks/use-reverse-shares";
import { BackgroundImagePicker } from "./background-image-picker";
import { EditPasswordModal } from "./edit-password-modal";
import { EditableField } from "./editable-field";
import { FileSizeInput } from "./file-size-input";
import { FileTypesTagsInput } from "./file-types-tags-input";
import { GenerateAliasModal } from "./generate-alias-modal";
import { ReceivedFilesSection } from "./received-files-section";
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
  const [pendingChanges, setPendingChanges] = useState<
    Record<string, string | number | boolean | null | undefined>
  >({});
  const [isDownloading, setIsDownloading] = useState(false);

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

  const handleUpdateField = async (field: string, value: string | number | boolean | null) => {
    if (!reverseShare || !onUpdateReverseShare) return;

    setPendingChanges((prev) => ({ ...prev, [field]: value }));

    try {
      await onUpdateReverseShare(reverseShare.id, { [field]: value });
      onSuccess?.();
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
  };

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
        <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("reverseShares.modals.details.title")}</DialogTitle>
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
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-5 w-5 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        const svg = document.getElementById("reverse-share-details-qr-code");
                        if (!svg) return;

                        setIsDownloading(true);
                        const canvas = document.createElement("canvas");
                        const ctx = canvas.getContext("2d");
                        const padding = 20;
                        canvas.width = 200 + padding * 2;
                        canvas.height = 200 + padding * 2;

                        if (ctx) {
                          ctx.fillStyle = "#FFFFFF";
                          ctx.fillRect(0, 0, canvas.width, canvas.height);

                          const svgData = new XMLSerializer().serializeToString(svg);
                          const img = new Image();

                          img.onload = () => {
                            ctx.drawImage(img, padding, padding, 200, 200);
                            const link = document.createElement("a");
                            link.download = `${reverseShare?.name?.replace(/[^a-z0-9]/gi, "-").toLowerCase() || "reverse-share"}-qr-code.png`;
                            link.href = canvas.toDataURL("image/png");
                            link.click();
                            setIsDownloading(false);
                          };

                          img.src = `data:image/svg+xml;base64,${btoa(svgData)}`;
                        } else {
                          setIsDownloading(false);
                        }
                      }}
                      disabled={isDownloading}
                      title={t("qrCodeModal.download")}
                    >
                      <Download className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex flex-col items-start justify-start">
                    <button
                      type="button"
                      className="p-2 bg-card rounded-lg cursor-pointer hover:opacity-80 transition-opacity duration-300 border-0"
                      onClick={() => onViewQrCode?.(reverseShare)}
                      title={t("reverseShares.actions.viewQrCode")}
                    >
                      <LazyQRCode
                        id="reverse-share-details-qr-code"
                        value={reverseShareLink}
                        size={100}
                        level="H"
                        fgColor="#000000"
                        bgColor="#FFFFFF"
                      />
                    </button>
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
                {onCreateAlias && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-5 w-5 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowAliasModal(true)}
                    title={
                      reverseShareLink
                        ? t("reverseShares.modals.details.editAlias")
                        : t("reverseShares.modals.details.createAlias")
                    }
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </div>

              {reverseShareLink ? (
                <div className="flex gap-2">
                  <Input
                    value={reverseShareLink}
                    readOnly
                    className="flex-1 bg-muted/30 text-sm h-8"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleCopyLink}
                    title={t("reverseShares.modals.details.copyLink")}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8"
                    onClick={handleOpenLink}
                    title={t("reverseShares.modals.details.openLink")}
                  >
                    <Link className="h-3.5 w-3.5" />
                  </Button>
                </div>
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
                  <div className="flex items-center gap-2 mb-1">
                    <div className="text-xs font-medium text-muted-foreground">
                      {t("reverseShares.modals.details.protection")}
                    </div>
                    {onUpdatePassword && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-4 w-4 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPasswordModal(true)}
                        title={t("reverseShares.modals.details.editPassword")}
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </Button>
                    )}
                  </div>
                  <div className="mt-1">
                    {reverseShare.hasPassword ? (
                      <Badge
                        variant="secondary"
                        className="bg-yellow-500/20 text-yellow-700 border-yellow-200"
                      >
                        <Lock className="h-3 w-3 me-1" />
                        {t("reverseShares.modals.details.protectedByPassword")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                      >
                        <LockOpen className="h-3 w-3 me-1" />
                        {t("reverseShares.modals.details.publicAccess")}
                      </Badge>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-muted-foreground">
                    {t("reverseShares.modals.details.status")}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {reverseShare.isActive ? (
                      <Badge
                        variant="secondary"
                        className="bg-green-500/20 text-green-700 dark:text-green-400 border-green-200 dark:border-green-800"
                      >
                        <ToggleRight className="h-3 w-3 me-1" />
                        {t("reverseShares.status.active")}
                      </Badge>
                    ) : (
                      <Badge
                        variant="secondary"
                        className="bg-red-500/20 text-red-700 border-red-200"
                      >
                        <ToggleLeft className="h-3 w-3 me-1" />
                        {t("reverseShares.status.inactive")}
                      </Badge>
                    )}
                    {onToggleActive && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleToggleActive}
                        className="h-6 text-xs"
                      >
                        {reverseShare.isActive
                          ? t("reverseShares.modals.details.deactivate")
                          : t("reverseShares.modals.details.activate")}
                      </Button>
                    )}
                  </div>
                </div>

                <div>
                  <div className="text-xs font-medium text-muted-foreground mb-1">
                    {t("reverseShares.form.notifyOnUpload")}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Switch
                      checked={
                        pendingChanges.notifyOnUpload !== undefined
                          ? (pendingChanges.notifyOnUpload as boolean)
                          : reverseShare.notifyOnUpload
                      }
                      onCheckedChange={(checked) => handleUpdateField("notifyOnUpload", checked)}
                      disabled={!onUpdateReverseShare}
                    />
                    <span className="text-sm text-muted-foreground">
                      {t("reverseShares.form.notifyOnUploadHelp")}
                    </span>
                  </div>
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
