"use client";

import { Calendar, Copy, Download, Eye, Link as LinkIcon, Lock, Share } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { FileTree, type TreeFile, type TreeFolder } from "@/components/tables/files-tree";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LazyQRCode } from "@/components/ui/lazy-qr-code";
import { Loader } from "@/components/ui/loader";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { useQrDownload } from "@/hooks/use-qr-download";
import { createShare, createShareAlias, listFiles, listFolders } from "@/http/endpoints";
import { logger } from "@/lib/logger";
import { customNanoid } from "@/lib/utils";
import { ALIAS_MAX_LENGTH, ALIAS_MIN_LENGTH, getAliasValidationError } from "@/utils/alias";
import { generateQrFilename } from "@/utils/qr-download";
import { SharePrivacySection } from "./share-privacy-section";

export interface PreselectedItem {
  id: string;
  name: string;
}

export interface ShareCreationPreselection {
  files: PreselectedItem[];
  folders: PreselectedItem[];
}

interface ShareCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /**
   * Items pre-selected from a calling context (e.g. "Share" on a file/folder, or
   * a multi-selection). When provided, the file step opens with these already
   * selected and the share name is pre-filled. Omit it (main "Create share"
   * button) to open the empty file picker.
   */
  preselected?: ShareCreationPreselection | null;
}

const EMPTY_FORM = {
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
};

type Step = "details" | "files" | "link";

const generateAlias = () =>
  customNanoid(10, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

/** datetime-local / date string → ISO; a date-only value pins to end of day. */
const toIsoExpiration = (value: string): string | undefined => {
  if (!value) return undefined;
  if (value.length === 10) return new Date(`${value}T23:59:59`).toISOString();
  return new Date(value).toISOString();
};

/**
 * Unified share-creation flow used from every entry point (main "Create share"
 * button, single file/folder share, multi-selection share). A consistent
 * three-step flow — Details → Files → Link — with all options available
 * everywhere. The share is persisted only on the terminal action of the Link
 * step ("Create link" or "Later"), so navigating between steps never leaves a
 * half-created share behind.
 */
export function ShareCreationModal({
  isOpen,
  onClose,
  onSuccess,
  preselected,
}: ShareCreationModalProps) {
  const t = useTranslations();
  const { copy } = useCopyToClipboard();
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const { isDownloading, downloadQr } = useQrDownload();

  const [step, setStep] = useState<Step>("details");
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [files, setFiles] = useState<TreeFile[]>([]);
  const [folders, setFolders] = useState<TreeFolder[]>([]);
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [alias, setAlias] = useState(generateAlias);

  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Set once the share is persisted. After this point the user can no longer go
  // "Back" — the share exists — they can only finalize the link or close.
  const [createdShareId, setCreatedShareId] = useState<string | null>(null);
  const [generatedLink, setGeneratedLink] = useState("");

  // Latest preselection, read inside the (otherwise dependency-free) loader so a
  // fresh object reference from the caller doesn't re-run the reset effect.
  const preselectedRef = useRef(preselected);
  preselectedRef.current = preselected;

  const aliasErrorKey = getAliasValidationError(alias);
  const aliasError = aliasErrorKey
    ? t(`common.aliasValidation.${aliasErrorKey}`, { min: ALIAS_MIN_LENGTH, max: ALIAS_MAX_LENGTH })
    : null;

  // Stable string identity of the preselection — changes only when the target
  // items actually change, not on every parent render.
  const preselectKey = useMemo(() => {
    if (!preselected) return "";
    const f = preselected.files
      .map((i) => i.id)
      .sort()
      .join(",");
    const d = preselected.folders
      .map((i) => i.id)
      .sort()
      .join(",");
    return `${f}|${d}`;
  }, [preselected]);

  const defaultName = useMemo(() => {
    if (!preselected) return "";
    const fileCount = preselected.files.length;
    const folderCount = preselected.folders.length;
    const total = fileCount + folderCount;
    if (total === 0) return "";
    if (total === 1) {
      return fileCount === 1
        ? preselected.files[0].name.split(".")[0]
        : preselected.folders[0].name;
    }
    const parts: string[] = [];
    if (fileCount > 0) parts.push(t("shareMultipleFiles.defaultNameFiles", { count: fileCount }));
    if (folderCount > 0) {
      parts.push(t("shareMultipleFiles.defaultNameFolders", { count: folderCount }));
    }
    return (
      parts.join(t("shareMultipleFiles.defaultNameConnector")) +
      t("shareMultipleFiles.defaultNameSuffix")
    );
  }, [preselected, t]);

  const loadData = useCallback(async () => {
    try {
      setIsLoadingData(true);
      const [filesResponse, foldersResponse] = await Promise.all([listFiles(), listFolders()]);
      const rawFiles = filesResponse.data.files || [];
      const rawFolders = foldersResponse.data.folders || [];

      const treeFiles: TreeFile[] = rawFiles.map((file) => ({
        id: file.id,
        name: file.name,
        type: "file" as const,
        size: Number(file.size),
        parentId: file.folderId || null,
      }));
      const treeFolders: TreeFolder[] = rawFolders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        type: "folder" as const,
        parentId: folder.parentId || null,
        totalSize: folder.totalSize,
      }));

      setFiles(treeFiles);
      setFolders(treeFolders);

      // Pre-select items from the calling context. A folder must be expanded to
      // all of its descendants: the server stores explicit ids, so descendants
      // have to be listed for them to appear in the share.
      const pre = preselectedRef.current;
      if (pre) {
        const selection = new Set<string>();
        for (const file of pre.files) selection.add(file.id);
        const addDescendants = (folderId: string) => {
          for (const folder of treeFolders) {
            if (folder.parentId === folderId) {
              selection.add(folder.id);
              addDescendants(folder.id);
            }
          }
          for (const file of treeFiles) {
            if (file.parentId === folderId) selection.add(file.id);
          }
        };
        for (const folder of pre.folders) {
          selection.add(folder.id);
          addDescendants(folder.id);
        }
        setSelectedItems(Array.from(selection));
      }
    } catch (error) {
      logger.error("Error loading files and folders:", {
        err: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setIsLoadingData(false);
    }
  }, []);

  // Reset everything whenever the modal opens or the target items change.
  useEffect(() => {
    if (!isOpen) return;
    setFormData({ ...EMPTY_FORM, name: defaultName });
    setSelectedItems([]);
    setSearchQuery("");
    setAlias(generateAlias());
    setStep("details");
    setCreatedShareId(null);
    setGeneratedLink("");
    setIsSubmitting(false);
    loadData();
  }, [isOpen, preselectKey, defaultName, loadData]);

  const committed = createdShareId !== null;
  const canLeaveDetails = formData.name.trim().length > 0;
  const canSubmit = canLeaveDetails && !(formData.isPasswordProtected && !formData.password.trim());
  const selectedCount = selectedItems.length;

  /** Persist the share exactly once; returns its id (or null on failure). */
  const persistShare = async (): Promise<string | null> => {
    if (createdShareId) return createdShareId;

    const selectedFiles = selectedItems.filter((id) => files.some((f) => f.id === id));
    const selectedFolders = selectedItems.filter((id) => folders.some((f) => f.id === id));

    const response = await createShare({
      name: formData.name,
      description: formData.description || undefined,
      password: formData.isPasswordProtected ? formData.password : undefined,
      expiration: toIsoExpiration(formData.expiresAt),
      maxViews: formData.maxViews ? parseInt(formData.maxViews, 10) : undefined,
      files: selectedFiles,
      folders: selectedFolders,
      nameFieldRequired: formData.nameFieldRequired,
      emailFieldRequired: formData.emailFieldRequired,
      notifyOnDownload: formData.notifyOnDownload,
      inactivityAlertDays: formData.inactivityAlertDays
        ? parseInt(formData.inactivityAlertDays, 10)
        : undefined,
    });

    const id = response.data.share.id;
    setCreatedShareId(id);
    return id;
  };

  const handleCreateLink = async () => {
    try {
      setIsSubmitting(true);
      const id = await persistShare();
      if (!id) return;
      await createShareAlias(id, { alias });
      setGeneratedLink(`${window.location.origin}/s/${alias}`);
      // The list is refreshed on close (handleClose) — refreshing now would, for
      // the multi-selection entry point, clear the open-state and close the modal
      // before the user sees the QR code.
      toast.success(t("generateShareLink.success"));
    } catch (error) {
      logger.error("Error creating share link:", {
        err: error instanceof Error ? error.message : String(error),
      });
      // If the share itself was created but the alias failed, the share now
      // exists without a link (shown with a "No link" badge); the user can retry
      // the alias or close.
      toast.error(createdShareId ? t("generateShareLink.error") : t("createShare.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLater = async () => {
    try {
      setIsSubmitting(true);
      const id = await persistShare();
      if (!id) return;
      onSuccess();
      toast.success(t("createShare.success"));
      onClose();
    } catch (error) {
      logger.error("Error creating share:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("createShare.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyLink = async () => {
    if (await copy(generatedLink)) toast.success(t("generateShareLink.copied"));
  };

  const handleClose = () => {
    if (isSubmitting) return;
    // If a share was created during this session (link generated, or alias step
    // failed leaving a link-less share), refresh the list so it shows up.
    if (createdShareId) onSuccess();
    onClose();
  };

  const updateFormData = (field: keyof typeof formData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-3xl w-full [scrollbar-gutter:stable]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {generatedLink ? <LinkIcon className="h-5 w-5" /> : <Share className="h-5 w-5" />}
            {t("createShare.title")}
          </DialogTitle>
        </DialogHeader>

        {/* Fixed height keeps the dialog from "jumping" between steps; the active
            step scrolls internally with a reserved gutter so toggling the
            scrollbar (e.g. on button hover, or when expanding a menu) never
            shifts the layout. */}
        <Tabs
          value={step}
          onValueChange={(value) => setStep(value as Step)}
          className="flex flex-col h-[min(72vh,34rem)]"
        >
          <TabsList className="grid w-full grid-cols-3 shrink-0">
            <TabsTrigger value="details" disabled={committed}>
              {t("createShare.tabs.shareDetails")}
            </TabsTrigger>
            <TabsTrigger value="files" disabled={!canLeaveDetails || committed}>
              {t("createShare.tabs.selectFiles")}
              {selectedCount > 0 && (
                <span className="ms-1 text-xs bg-primary text-primary-foreground rounded-full px-2 py-0.5">
                  {selectedCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="link" disabled={!canLeaveDetails || committed}>
              {t("createShare.tabs.shareLink")}
            </TabsTrigger>
          </TabsList>

          {/* Step 1 — details & options */}
          <TabsContent
            value="details"
            className="flex-1 min-h-0 space-y-4 mt-4 overflow-y-auto [scrollbar-gutter:stable] pe-1"
          >
            <div className="space-y-2">
              <Label htmlFor="share-name">{t("createShare.nameLabel")} *</Label>
              <Input
                id="share-name"
                value={formData.name}
                onChange={(e) => updateFormData("name", e.target.value)}
                placeholder={t("createShare.namePlaceholder")}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="share-description">{t("createShare.descriptionLabel")}</Label>
              <Textarea
                id="share-description"
                value={formData.description}
                onChange={(e) => updateFormData("description", e.target.value)}
                placeholder={t("createShare.descriptionPlaceholder")}
                rows={3}
              />
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="password-protection"
                checked={formData.isPasswordProtected}
                onCheckedChange={(checked) => {
                  updateFormData("isPasswordProtected", checked);
                  if (!checked) updateFormData("password", "");
                }}
              />
              <Label htmlFor="password-protection" className="flex items-center gap-2">
                <Lock className="h-4 w-4" />
                {t("createShare.passwordProtection")}
              </Label>
            </div>

            {formData.isPasswordProtected && (
              <div className="space-y-2">
                <Label htmlFor="share-password">{t("createShare.passwordLabel")}</Label>
                <Input
                  id="share-password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => updateFormData("password", e.target.value)}
                  placeholder={t("createShare.passwordPlaceholder")}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="expiration" className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {t("createShare.expirationLabel")}
              </Label>
              <Input
                id="expiration"
                type="datetime-local"
                value={formData.expiresAt}
                onChange={(e) => updateFormData("expiresAt", e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-views" className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                {t("createShare.maxViewsLabel")}
              </Label>
              <Input
                id="max-views"
                type="number"
                min="1"
                value={formData.maxViews}
                onChange={(e) => updateFormData("maxViews", e.target.value)}
                placeholder={t("createShare.maxViewsPlaceholder")}
              />
            </div>

            <SharePrivacySection
              value={{
                nameFieldRequired: formData.nameFieldRequired,
                emailFieldRequired: formData.emailFieldRequired,
                notifyOnDownload: formData.notifyOnDownload,
                inactivityAlertDays: formData.inactivityAlertDays,
              }}
              onChange={(privacy) => setFormData((prev) => ({ ...prev, ...privacy }))}
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setStep("files")}
                disabled={!canLeaveDetails}
              >
                {t("createShare.nextSelectFiles")}
              </Button>
              <Button onClick={() => setStep("link")} disabled={!canLeaveDetails}>
                {t("createShare.nextGenerateLink")}
              </Button>
            </div>
          </TabsContent>

          {/* Step 2 — file selection (optional) */}
          <TabsContent value="files" className="flex-1 min-h-0 space-y-4 mt-4 flex flex-col">
            <div className="space-y-2">
              <Label htmlFor="file-search">{t("common.search")}</Label>
              <Input
                id="file-search"
                type="search"
                placeholder={t("searchBar.placeholder")}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                disabled={isLoadingData}
              />
            </div>

            <div className="text-sm text-muted-foreground">
              {selectedCount > 0
                ? t("createShare.itemsSelected", { count: selectedCount })
                : t("createShare.filesOptionalHint")}
            </div>

            <div className="flex-1 min-h-0 w-full overflow-hidden">
              {isLoadingData ? (
                <div className="flex items-center justify-center py-8">
                  <div className="text-sm text-muted-foreground">{t("common.loadingSimple")}</div>
                </div>
              ) : (
                <FileTree
                  files={files.map((file) => ({
                    id: file.id,
                    name: file.name,
                    description: "",
                    extension: "",
                    size: file.size?.toString() || "0",
                    objectName: "",
                    userId: "",
                    folderId: file.parentId,
                    createdAt: "",
                    updatedAt: "",
                  }))}
                  folders={folders.map((folder) => ({
                    id: folder.id,
                    name: folder.name,
                    description: "",
                    parentId: folder.parentId,
                    userId: "",
                    createdAt: "",
                    updatedAt: "",
                    totalSize: folder.totalSize,
                  }))}
                  selectedItems={selectedItems}
                  onSelectionChange={setSelectedItems}
                  showFiles={true}
                  showFolders={true}
                  className="h-full"
                  maxHeight="100%"
                  searchQuery={searchQuery}
                />
              )}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep("details")}>
                {t("common.back")}
              </Button>
              <Button onClick={() => setStep("link")}>{t("createShare.nextGenerateLink")}</Button>
            </div>
          </TabsContent>

          {/* Step 3 — share link */}
          <TabsContent
            value="link"
            className="flex-1 min-h-0 space-y-4 mt-4 overflow-y-auto [scrollbar-gutter:stable] pe-1"
          >
            {!generatedLink ? (
              <>
                <p className="text-sm text-muted-foreground">
                  {t("createShare.linkStepDescription")}
                </p>
                <div className="space-y-2">
                  <Label htmlFor="share-alias">{t("shareActions.aliasLabel")}</Label>
                  <Input
                    id="share-alias"
                    placeholder={t("shareActions.aliasPlaceholder")}
                    value={alias}
                    onChange={(e) => setAlias(e.target.value)}
                    aria-invalid={aliasError !== null}
                  />
                  {aliasError && <p className="text-sm text-destructive">{aliasError}</p>}
                </div>

                <div className="flex justify-between gap-2">
                  {!committed ? (
                    <Button variant="outline" onClick={() => setStep("files")}>
                      {t("common.back")}
                    </Button>
                  ) : (
                    <span />
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={handleLater}
                      disabled={!canSubmit || isSubmitting}
                    >
                      {t("generateShareLink.later")}
                    </Button>
                    <Button
                      onClick={handleCreateLink}
                      disabled={!canSubmit || isSubmitting || aliasError !== null}
                    >
                      {isSubmitting ? <Loader size="sm" /> : t("shareActions.generateLink")}
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex flex-col items-center justify-center">
                  <div ref={qrContainerRef} className="p-4 bg-card rounded-lg">
                    <LazyQRCode
                      value={generatedLink}
                      size={220}
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
                    size="icon"
                    variant="outline"
                    onClick={handleCopyLink}
                    title={t("shareActions.copyLink")}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={handleClose}>
                    {t("common.close")}
                  </Button>
                  <Button
                    onClick={() =>
                      downloadQr(qrContainerRef.current, generateQrFilename(formData.name))
                    }
                    disabled={isDownloading}
                  >
                    <Download className="h-4 w-4" />
                    {t("qrCodeModal.download")}
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
