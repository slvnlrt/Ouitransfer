"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useFileUpload } from "@/hooks/use-file-upload";
import { createShare, createShareAlias, notifyRecipients } from "@/http/endpoints";
import { customNanoid } from "@/lib/utils";
import { isValidEmail } from "@/utils/email";

export type QuickShareState = "dropzone" | "uploading" | "confirmation";

export type ExpirationOption = "1day" | "7days" | "30days" | "never";

export interface QuickShareSettings {
  name: string;
  expiration: ExpirationOption;
  password: string;
  isPasswordProtected: boolean;
  recipients: string[];
}

const EXPIRATION_DAYS: Record<ExpirationOption, number | null> = {
  "1day": 1,
  "7days": 7,
  "30days": 30,
  never: null,
};

const generateAlias = () =>
  customNanoid(10, "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ");

export interface UseQuickShareOptions {
  onShareCreated?: () => void;
  smtpEnabled?: string;
}

export function useQuickShare(options: UseQuickShareOptions = {}) {
  const { onShareCreated, smtpEnabled } = options;
  const t = useTranslations();
  const [state, setState] = useState<QuickShareState>("dropzone");
  const [settings, setSettings] = useState<QuickShareSettings>({
    name: "",
    expiration: "7days",
    password: "",
    isPasswordProtected: false,
    recipients: [],
  });
  const [shareLink, setShareLink] = useState("");
  const [_shareAlias, setShareAlias] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingShare, setPendingShare] = useState(false);

  const {
    addFiles,
    startUpload,
    removeFile: rawRemoveFile,
    retryUpload,
    clearAll,
    fileUploads,
    isUploading,
  } = useFileUpload();

  // Track whether user has manually edited the share name
  const nameTouchedRef = useRef(false);

  // Track the previous file count to detect "files removed" (count went positive → zero)
  // rather than "just transitioned to uploading with empty queue".
  const prevFileCountRef = useRef(0);

  // Keep a stable ref to startUpload so callbacks can schedule it without
  // re-creating themselves on every render.
  const startUploadRef = useRef(startUpload);
  useEffect(() => {
    startUploadRef.current = startUpload;
  }, [startUpload]);

  // Auto-start uploads when pending files exist in uploading state.
  // This covers both the initial drop (dropzone→uploading) and subsequent drops.
  useEffect(() => {
    if (state !== "uploading") return;
    if (fileUploads.some((f) => f.status === "pending")) {
      const timer = setTimeout(() => startUploadRef.current(), 200);
      return () => clearTimeout(timer);
    }
  }, [fileUploads, state]);

  const handleFilesAdded = useCallback(
    (files: File[]) => {
      addFiles(files);

      if (state === "dropzone") {
        // Transitioning to uploading: set default name, switch state, and
        // schedule startUpload after a short delay so Uppy has time to process
        // the added files before we trigger the upload.
        nameTouchedRef.current = false;
        const defaultName =
          files.length === 1
            ? files[0].name
            : t("quickShare.upload.defaultName", { count: files.length });
        setSettings((prev) => ({ ...prev, name: defaultName }));
        setState("uploading");
      } else if (!nameTouchedRef.current) {
        // Adding more files while already uploading — auto-rename only if user
        // hasn't manually edited the name.
        const totalCount = fileUploads.length + files.length;
        const newName =
          totalCount === 1
            ? (fileUploads[0]?.file.name ?? files[0].name)
            : t("quickShare.upload.defaultName", { count: totalCount });
        setSettings((prev) => ({ ...prev, name: newName }));
      }
    },
    [addFiles, state, t, fileUploads],
  );

  const updateSettings = useCallback((updates: Partial<QuickShareSettings>) => {
    // Track manual name edits
    if ("name" in updates) {
      nameTouchedRef.current = true;
    }
    setSettings((prev) => ({ ...prev, ...updates }));
  }, []);

  const performShare = useCallback(async () => {
    // Check for errored files — abort if any failed
    const hasErrors = fileUploads.some((u) => u.status === "error");
    if (hasErrors) {
      toast.error(t("quickShare.upload.uploadError"));
      setPendingShare(false);
      return;
    }

    // Gather file IDs from successfully uploaded+registered files
    const fileIds = fileUploads
      .filter((u) => u.status === "success" && u.registeredFileId)
      .map((u) => u.registeredFileId as string);

    if (fileIds.length === 0) {
      toast.error(t("quickShare.upload.uploadError"));
      setPendingShare(false);
      return;
    }

    setIsSubmitting(true);

    try {
      // Calculate expiration date
      const days = EXPIRATION_DAYS[settings.expiration];
      const expiration = days
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      // Create the share
      const shareResult = await createShare({
        name: settings.name || undefined,
        files: fileIds,
        expiration,
        password: settings.isPasswordProtected ? settings.password : undefined,
        recipients: settings.recipients.length > 0 ? settings.recipients : undefined,
      });

      const shareId = shareResult.data.share.id;

      // Generate alias with retry (collision + transient failure)
      let alias = "";
      let aliasCreated = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          alias = generateAlias();
          await createShareAlias(shareId, { alias });
          aliasCreated = true;
          break;
        } catch {
          // Retry with a new alias
        }
      }

      if (!aliasCreated) {
        // All retries failed — clean up the orphan share
        try {
          const { deleteShare } = await import("@/http/endpoints");
          await deleteShare(shareId);
        } catch {
          // Best-effort cleanup
        }
        throw new Error("Failed to create share alias");
      }

      const link = `${window.location.origin}/s/${alias}`;
      setShareLink(link);
      setShareAlias(alias);

      // Notify recipients if any (non-blocking)
      if (settings.recipients.length > 0) {
        try {
          await notifyRecipients(shareId, {});
        } catch {
          toast.error(t("quickShare.upload.notifyError"));
        }
      }

      // Fire onShareCreated callback BEFORE state transition
      onShareCreated?.();
      setState("confirmation");
    } catch {
      toast.error(t("quickShare.upload.error"));
    } finally {
      setIsSubmitting(false);
      setPendingShare(false);
    }
  }, [fileUploads, settings, t, onShareCreated]);

  const handleShare = useCallback(() => {
    const hasErrors = fileUploads.some((u) => u.status === "error");
    const hasPending = fileUploads.some((u) => u.status === "pending" || u.status === "uploading");

    if (hasErrors) {
      toast.error(t("quickShare.upload.uploadError"));
      return;
    }

    if (hasPending) {
      // Register intent — share will be created when uploads finish
      setPendingShare(true);
      return;
    }

    // All uploads done, create share immediately
    performShare();
  }, [fileUploads, performShare, t]);

  // Auto-share when all uploads complete and pendingShare is true
  useEffect(() => {
    if (!pendingShare) return;

    const allDone =
      fileUploads.length > 0 &&
      fileUploads.every(
        (u) => u.status === "success" || u.status === "error" || u.status === "cancelled",
      );

    if (allDone) {
      // Clear pendingShare BEFORE calling performShare to prevent double-fire
      setPendingShare(false);
      performShare();
    }
  }, [pendingShare, fileUploads, performShare]);

  // Auto-reset to dropzone when all files are removed while in uploading state.
  // Only resets if we previously had files (prevFileCountRef > 0 → now 0),
  // preventing a false reset immediately after the dropzone→uploading transition.
  useEffect(() => {
    const prevCount = prevFileCountRef.current;
    prevFileCountRef.current = fileUploads.length;

    if (state === "uploading" && fileUploads.length === 0 && prevCount > 0) {
      clearAll();
      setState("dropzone");
      setSettings({
        name: "",
        expiration: "7days",
        password: "",
        isPasswordProtected: false,
        recipients: [],
      });
      setPendingShare(false);
      nameTouchedRef.current = false;
    }
  }, [state, fileUploads.length, clearAll]);

  // Wrapped removeFile that delegates to upload hook
  const removeFile = useCallback(
    (fileId: string) => {
      rawRemoveFile(fileId);
    },
    [rawRemoveFile],
  );

  const reset = useCallback(() => {
    clearAll();
    setState("dropzone");
    setSettings({
      name: "",
      expiration: "7days",
      password: "",
      isPasswordProtected: false,
      recipients: [],
    });
    setShareLink("");
    setShareAlias("");
    setIsSubmitting(false);
    setPendingShare(false);
    nameTouchedRef.current = false;
  }, [clearAll]);

  return {
    // State
    state,
    settings,
    shareLink,
    isSubmitting,
    pendingShare,
    smtpEnabled: smtpEnabled ?? "false",

    // Upload state (passthrough)
    fileUploads,
    isUploading,

    // Actions
    handleFilesAdded,
    updateSettings,
    handleShare,
    removeFile,
    retryUpload,
    reset,
    isValidEmail,
  };
}
