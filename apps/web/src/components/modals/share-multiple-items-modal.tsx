"use client";

import { Calendar, Copy, Download, Eye, Folder, Link, Lock, Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { FileItem, FolderItem } from "@/components/tables/files-table-types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { createShare, createShareAlias, listFiles, listFolders } from "@/http/endpoints";
import { logger } from "@/lib/logger";
import { customNanoid } from "@/lib/utils";
import { getFileIcon } from "@/utils/file-icons";
import { SharePrivacySection } from "./share-privacy-section";

type BulkFile = Pick<
  FileItem,
  "id" | "name" | "description" | "size" | "objectName" | "createdAt" | "updatedAt"
>;
interface BulkItem {
  id: string;
  name: string;
  description?: string;
  size?: number;
  type: "file" | "folder";
  createdAt?: string;
  updatedAt?: string;
}

interface ShareMultipleItemsModalProps {
  files: BulkFile[] | null;
  folders: FolderItem[] | null;
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const generateCustomId = () =>
  customNanoid(10, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

export function ShareMultipleItemsModal({
  files,
  folders,
  isOpen,
  onClose,
  onSuccess,
}: ShareMultipleItemsModalProps) {
  const t = useTranslations();
  const { copy } = useCopyToClipboard();
  const [step, setStep] = useState<"create" | "link">("create");
  const [shareId, setShareId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    password: "",
    expiresAt: "",
    isPasswordProtected: false,
    maxViews: "",
    nameFieldRequired: "HIDDEN" as "HIDDEN" | "OPTIONAL" | "REQUIRED",
    emailFieldRequired: "HIDDEN" as "HIDDEN" | "OPTIONAL" | "REQUIRED",
    notifyOnDownload: false,
    inactivityAlertDays: "",
  });
  const [alias, setAlias] = useState(() => generateCustomId());
  const [generatedLink, setGeneratedLink] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isOpen && ((files && files.length > 0) || (folders && folders.length > 0))) {
      const fileCount = files ? files.length : 0;
      const folderCount = folders ? folders.length : 0;
      const totalCount = fileCount + folderCount;

      let defaultName = "";
      if (totalCount === 1) {
        if (fileCount === 1 && files) {
          defaultName = files[0].name.split(".")[0];
        } else if (folderCount === 1 && folders) {
          defaultName = folders[0].name;
        }
      } else {
        const items = [];
        if (fileCount > 0) items.push(`${fileCount} files`);
        if (folderCount > 0) items.push(`${folderCount} folders`);
        defaultName = `${items.join(" and ")} shared`;
      }

      setFormData({
        name: defaultName,
        description: "",
        password: "",
        expiresAt: "",
        isPasswordProtected: false,
        maxViews: "",
        nameFieldRequired: "HIDDEN",
        emailFieldRequired: "HIDDEN",
        notifyOnDownload: false,
        inactivityAlertDays: "",
      });
      setAlias(generateCustomId());
      setStep("create");
      setShareId(null);
      setGeneratedLink("");
    }
  }, [isOpen, files, folders]);

  const getAllFolderContents = async (
    folderId: string,
  ): Promise<{ files: string[]; folders: string[] }> => {
    try {
      const [filesResponse, foldersResponse] = await Promise.all([listFiles(), listFolders()]);

      const allFiles = filesResponse.data.files || [];
      const allFolders = foldersResponse.data.folders || [];

      const collectContents = (parentId: string): { files: string[]; folders: string[] } => {
        const folderFiles = allFiles.filter((f) => f.folderId === parentId).map((f) => f.id);

        const subFolders = allFolders.filter((f) => f.parentId === parentId);
        const subFolderIds = subFolders.map((f) => f.id);

        let allSubFiles: string[] = [...folderFiles];
        let allSubFolders: string[] = [...subFolderIds];

        subFolders.forEach((subFolder) => {
          const subContents = collectContents(subFolder.id);
          allSubFiles = [...allSubFiles, ...subContents.files];
          allSubFolders = [...allSubFolders, ...subContents.folders];
        });

        return { files: allSubFiles, folders: allSubFolders };
      };

      return collectContents(folderId);
    } catch (error) {
      logger.error("Error getting folder contents:", {
        err: error instanceof Error ? error.message : String(error),
      });
      return { files: [], folders: [] };
    }
  };

  const handleCreateShare = async () => {
    const fileCount = files ? files.length : 0;
    const folderCount = folders ? folders.length : 0;

    if (fileCount === 0 && folderCount === 0) return;

    try {
      setIsLoading(true);

      let allFilesToShare: string[] = files ? files.map((f) => f.id) : [];
      let allFoldersToShare: string[] = folders ? folders.map((f) => f.id) : [];

      if (folders && folders.length > 0) {
        for (const folder of folders) {
          const folderContents = await getAllFolderContents(folder.id);
          allFilesToShare = [...allFilesToShare, ...folderContents.files];
          allFoldersToShare = [...allFoldersToShare, ...folderContents.folders];
        }
      }

      const shareResponse = await createShare({
        name: formData.name,
        description: formData.description || undefined,
        password: formData.isPasswordProtected ? formData.password : undefined,
        expiration: formData.expiresAt ? new Date(formData.expiresAt).toISOString() : undefined,
        maxViews: formData.maxViews ? parseInt(formData.maxViews, 10) : undefined,
        files: allFilesToShare,
        folders: allFoldersToShare,
        nameFieldRequired: formData.nameFieldRequired,
        emailFieldRequired: formData.emailFieldRequired,
        notifyOnDownload: formData.notifyOnDownload,
        inactivityAlertDays: formData.inactivityAlertDays
          ? parseInt(formData.inactivityAlertDays, 10)
          : undefined,
      });

      const newShareId = shareResponse.data.share.id;
      setShareId(newShareId);

      toast.success(t("createShare.success"));
      setStep("link");
    } catch {
      toast.error(t("createShare.error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleGenerateLink = async () => {
    if (!shareId) return;

    try {
      setIsLoading(true);
      await createShareAlias(shareId, { alias });
      const link = `${window.location.origin}/s/${alias}`;
      setGeneratedLink(link);
      toast.success(t("generateShareLink.success"));
    } catch {
      toast.error(t("generateShareLink.error"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyLink = async () => {
    const ok = await copy(generatedLink);
    if (ok) {
      toast.success(t("generateShareLink.copied"));
    }
  };

  const downloadQRCode = () => {
    const qrCodeElement = document.getElementById("share-multiple-files-qr-code");
    if (qrCodeElement) {
      const canvas = qrCodeElement.querySelector("canvas");
      if (canvas) {
        const link = document.createElement("a");
        link.download = "share-multiple-files-qr-code.png";
        link.href = canvas.toDataURL("image/png");
        link.click();
      }
    }
  };

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      setStep("create");
      setShareId(null);
      setGeneratedLink("");
      setFormData({
        name: "",
        description: "",
        password: "",
        expiresAt: "",
        isPasswordProtected: false,
        maxViews: "",
        nameFieldRequired: "HIDDEN",
        emailFieldRequired: "HIDDEN",
        notifyOnDownload: false,
        inactivityAlertDays: "",
      });
    }, 300);
  };

  const handleSuccess = () => {
    onSuccess();
    handleClose();
  };

  if (!files && !folders) return null;

  const filesList = files || [];
  const foldersList = folders || [];
  const allItems: BulkItem[] = [
    ...filesList.map((file) => ({
      id: file.id,
      name: file.name,
      description: file.description,
      size: file.size,
      type: "file" as const,
      createdAt: file.createdAt,
      updatedAt: file.updatedAt,
    })),
    ...foldersList.map((folder) => ({
      id: folder.id,
      name: folder.name,
      description: folder.description,
      size: folder.totalSize ? parseInt(folder.totalSize, 10) : undefined,
      type: "folder" as const,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
    })),
  ];

  const totalSize =
    filesList.reduce((sum, file) => sum + file.size, 0) +
    foldersList.reduce(
      (sum, folder) => sum + (folder.totalSize ? parseInt(folder.totalSize, 10) : 0),
      0,
    );
  const formatFileSize = (bytes: number) => {
    const sizes = ["B", "KB", "MB", "GB"];
    if (bytes === 0) return "0 B";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round((bytes / 1024 ** i) * 100) / 100} ${sizes[i]}`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === "create" ? (
              <>
                <Share className="size-5" />
                {t("shareMultipleFiles.title")}
              </>
            ) : (
              <>
                <Link className="size-5" />
                {t("shareActions.linkTitle")}
              </>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-auto">
          {step === "create" && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("shareMultipleFiles.shareNameLabel")} *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder={t("shareMultipleFiles.shareNamePlaceholder")}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>{t("shareMultipleFiles.descriptionLabel")}</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder={t("shareMultipleFiles.descriptionPlaceholder")}
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Calendar className="size-4" />
                  {t("createShare.expirationLabel")}
                </Label>
                <Input
                  placeholder={t("createShare.expirationPlaceholder")}
                  type="datetime-local"
                  value={formData.expiresAt}
                  onChange={(e) => setFormData({ ...formData, expiresAt: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Eye className="size-4" />
                  {t("createShare.maxViewsLabel")}
                </Label>
                <Input
                  min="1"
                  placeholder={t("createShare.maxViewsPlaceholder")}
                  type="number"
                  value={formData.maxViews}
                  onChange={(e) => setFormData({ ...formData, maxViews: e.target.value })}
                />
              </div>

              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.isPasswordProtected}
                  onCheckedChange={(checked) =>
                    setFormData({
                      ...formData,
                      isPasswordProtected: checked,
                      password: "",
                    })
                  }
                  id="password-protection"
                />
                <Label htmlFor="password-protection" className="flex items-center gap-2">
                  <Lock className="size-4" />
                  {t("createShare.passwordProtection")}
                </Label>
              </div>

              {formData.isPasswordProtected && (
                <div className="space-y-2">
                  <Label>{t("createShare.passwordLabel")}</Label>
                  <Input
                    type="password"
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    placeholder={t("createShare.passwordLabel")}
                  />
                </div>
              )}

              <SharePrivacySection
                value={{
                  nameFieldRequired: formData.nameFieldRequired,
                  emailFieldRequired: formData.emailFieldRequired,
                  notifyOnDownload: formData.notifyOnDownload,
                  inactivityAlertDays: formData.inactivityAlertDays,
                }}
                onChange={(privacy) => setFormData({ ...formData, ...privacy })}
                switchIdSuffix="multiple"
              />

              <div className="space-y-2">
                <Label>{t("shareMultipleFiles.itemsToShare", { count: allItems.length })}</Label>
                <ScrollArea className="h-32 w-full rounded-md border p-2 bg-muted/30">
                  <div className="space-y-1">
                    {allItems.map((item) => {
                      const isFolder = item.type === "folder";
                      const { icon: FileIcon, color } = isFolder
                        ? { icon: Folder, color: "text-primary" }
                        : getFileIcon(item.name);

                      return (
                        <div key={item.id} className="flex justify-between items-center text-sm">
                          <div className="flex items-center gap-2 truncate flex-1">
                            <FileIcon className={`h-4 w-4 ${color} flex-shrink-0`} />
                            <span className="truncate">{item.name}</span>
                          </div>
                          <span className="text-muted-foreground ms-2">
                            {item.size ? formatFileSize(item.size) : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
                <p className="text-xs text-muted-foreground">
                  {t("shareMultipleFiles.totalSize", { size: formatFileSize(totalSize) })} (
                  {filesList.length} files, {foldersList.length} folders)
                </p>
              </div>
            </div>
          )}

          {step === "link" && (
            <div className="space-y-4">
              {!generatedLink ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("shareActions.linkDescriptionFile")}
                  </p>
                  <div className="space-y-2">
                    <Label>{t("shareActions.aliasLabel")}</Label>
                    <Input
                      placeholder={t("shareActions.aliasPlaceholder")}
                      value={alias}
                      onChange={(e) => setAlias(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-col items-center justify-center">
                    <div className="p-4 bg-card rounded-lg">
                      <svg style={{ display: "none" }} /> {/* For SSR safety */}
                      <LazyQRCode
                        id="share-multiple-files-qr-code"
                        value={generatedLink}
                        size={250}
                        level="H"
                        fgColor="#000000"
                        bgColor="#FFFFFF"
                      />
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">{t("shareActions.linkReady")}</p>
                  <div className="flex gap-2">
                    <Input readOnly value={generatedLink} className="flex-1" />
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleCopyLink}
                      title={t("shareActions.copyLink")}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          {step === "create" && (
            <>
              <Button variant="outline" onClick={handleClose}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={
                  isLoading ||
                  !formData.name.trim() ||
                  (formData.isPasswordProtected && !formData.password.trim())
                }
                onClick={handleCreateShare}
              >
                {isLoading ? <div className="animate-spin">⠋</div> : t("shareMultipleFiles.create")}
              </Button>
            </>
          )}

          {step === "link" && !generatedLink && (
            <>
              <Button variant="outline" onClick={() => setStep("create")}>
                {t("common.back")}
              </Button>
              <Button disabled={!alias || isLoading} onClick={handleGenerateLink}>
                {isLoading ? <div className="animate-spin">⠋</div> : t("shareActions.generateLink")}
              </Button>
            </>
          )}

          {step === "link" && generatedLink && (
            <>
              <Button variant="outline" onClick={handleSuccess}>
                {t("common.close")}
              </Button>
              <Button onClick={downloadQRCode}>
                <Download className="h-4 w-4" />
                {t("qrCodeModal.download")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
