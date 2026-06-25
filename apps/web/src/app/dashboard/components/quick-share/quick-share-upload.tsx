"use client";

import { CloudUpload, CornerDownLeft, Loader2, Plus, RotateCcw, Send, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileTypeIcon } from "@/components/ui/file-type-icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusIcon } from "@/components/ui/status-icon";
import { Switch } from "@/components/ui/switch";
import type { FileUploadState } from "@/hooks/use-uppy-upload";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/utils/format-file-size";
import type { ExpirationOption, QuickShareSettings } from "../../hooks/use-quick-share";

interface QuickShareUploadProps {
  fileUploads: FileUploadState[];
  settings: QuickShareSettings;
  isSubmitting: boolean;
  pendingShare: boolean;
  smtpEnabled: string;
  onFilesAdded: (files: File[]) => void;
  onUpdateSettings: (updates: Partial<QuickShareSettings>) => void;
  onRemoveFile: (fileId: string) => void;
  onRetryUpload: (fileId: string) => void;
  onShare: () => void;
  isValidEmail: (email: string) => boolean;
}

const EXPIRATION_OPTIONS: ExpirationOption[] = ["1day", "7days", "30days", "never"];

export function QuickShareUpload({
  fileUploads,
  settings,
  isSubmitting,
  pendingShare,
  smtpEnabled,
  onFilesAdded,
  onUpdateSettings,
  onRemoveFile,
  onRetryUpload,
  onShare,
  isValidEmail,
}: QuickShareUploadProps) {
  const t = useTranslations("quickShare.upload");
  const addMoreRef = useRef<HTMLInputElement>(null);
  const recipientInputRef = useRef<HTMLInputElement>(null);

  const handleAddMore = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFilesAdded(Array.from(files));
      }
      e.target.value = "";
    },
    [onFilesAdded],
  );

  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragOver(true);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounterRef.current = 0;
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        onFilesAdded(Array.from(files));
      }
    },
    [onFilesAdded],
  );

  const hasErrors = fileUploads.some((u) => u.status === "error");
  const allDone = fileUploads.every(
    (u) => u.status === "success" || u.status === "error" || u.status === "cancelled",
  );

  const getButtonLabel = () => {
    if (isSubmitting) return t("sharing");
    if (pendingShare) return t("waitingUpload");
    return t("share");
  };

  return (
    <Card
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(
        "relative transition-all duration-200",
        isDragOver && "border-primary bg-primary/5 ring-2 ring-primary/20",
      )}
    >
      {/* Drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-primary/5 border-2 border-dashed border-primary">
          <p className="text-sm font-medium text-primary">{t("dropToAdd")}</p>
        </div>
      )}
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CloudUpload className="size-5 text-primary" />
            {t("title")}
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => addMoreRef.current?.click()}
            className="text-xs"
          >
            <Plus className="size-3.5 mr-1" />
            {t("addMore")}
          </Button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
          {/* File list */}
          <div className="space-y-2 max-h-48 overflow-y-auto lg:max-h-[24rem]">
            {fileUploads.map((upload) => (
              <div key={upload.id} className="flex items-center gap-3 p-2 rounded-md bg-muted/30">
                <FileTypeIcon fileName={upload.file.name} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{upload.file.name}</p>
                    <StatusIcon status={upload.status} sizeClass="size-3.5" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatFileSize(upload.file.size)}
                  </p>
                  {upload.status === "uploading" && (
                    <Progress value={upload.progress} className="h-1 mt-1" />
                  )}
                  {upload.status === "error" && upload.error && (
                    <p className="text-xs text-destructive mt-0.5">{upload.error}</p>
                  )}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  {upload.status === "error" && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onRetryUpload(upload.id)}
                      className="h-6 w-6 p-0"
                      disabled={isSubmitting}
                    >
                      <RotateCcw className="size-3" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onRemoveFile(upload.id)}
                    className="h-6 w-6 p-0"
                    disabled={isSubmitting}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Options + share action */}
          <div className="space-y-4 border-t pt-6 lg:border-t-0 lg:pt-0 lg:border-s lg:ps-8">
            {/* Name */}
            <div className="space-y-1.5">
              <Input
                value={settings.name}
                onChange={(e) => onUpdateSettings({ name: e.target.value })}
                placeholder={t("namePlaceholder")}
              />
            </div>

            {/* Expiration */}
            <div className="flex items-center gap-3">
              <Label className="text-sm text-muted-foreground whitespace-nowrap">
                {t("expiration.label")}
              </Label>
              <Select
                value={settings.expiration}
                onValueChange={(v) => onUpdateSettings({ expiration: v as ExpirationOption })}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {t(`expiration.${opt}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Password */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label
                  htmlFor="quickshare-password-toggle"
                  className="text-sm text-muted-foreground"
                >
                  {t("password.label")}
                </Label>
                <Switch
                  id="quickshare-password-toggle"
                  checked={settings.isPasswordProtected}
                  onCheckedChange={(checked) =>
                    onUpdateSettings({
                      isPasswordProtected: checked,
                      password: checked ? settings.password : "",
                    })
                  }
                />
              </div>
              {settings.isPasswordProtected && (
                <Input
                  type="password"
                  value={settings.password}
                  onChange={(e) => onUpdateSettings({ password: e.target.value })}
                  placeholder={t("password.placeholder")}
                />
              )}
            </div>

            {/* Recipients — only shown when SMTP is configured */}
            {smtpEnabled !== "false" && (
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">{t("recipients.label")}</Label>
                <Input
                  ref={recipientInputRef}
                  type="email"
                  placeholder={t("recipients.placeholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const value = e.currentTarget.value.trim();
                      if (!value) return;
                      if (!isValidEmail(value)) {
                        toast.error(t("invalidEmail"));
                        return;
                      }
                      if (!settings.recipients.includes(value)) {
                        onUpdateSettings({
                          recipients: [...settings.recipients, value],
                        });
                        e.currentTarget.value = "";
                      }
                    }
                  }}
                />
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <CornerDownLeft className="size-3" />
                  {t("recipients.hint")}
                </p>
                {settings.recipients.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {settings.recipients.map((email) => (
                      <span
                        key={email}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs"
                      >
                        {email}
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              recipients: settings.recipients.filter((r) => r !== email),
                            })
                          }
                          className="hover:text-destructive"
                        >
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Share button */}
            <Button
              onClick={() => {
                const input = recipientInputRef.current;
                if (input) {
                  const value = input.value.trim();
                  if (value) {
                    if (isValidEmail(value) && !settings.recipients.includes(value)) {
                      onUpdateSettings({ recipients: [...settings.recipients, value] });
                    }
                    input.value = "";
                  }
                }
                onShare();
              }}
              disabled={isSubmitting || fileUploads.length === 0 || (hasErrors && allDone)}
              className="w-full"
              size="lg"
            >
              {(isSubmitting || pendingShare) && <Loader2 className="size-4 mr-2 animate-spin" />}
              {!isSubmitting && !pendingShare && <Send className="size-4 mr-2" />}
              {getButtonLabel()}
            </Button>
          </div>
        </div>
      </CardContent>

      <input
        ref={addMoreRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleAddMore}
        tabIndex={-1}
        aria-hidden="true"
      />
    </Card>
  );
}
