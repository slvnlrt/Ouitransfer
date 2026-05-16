"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import type { UpdateReverseShareBody } from "@/http/endpoints/reverse-shares/types";
import type { ReverseShare } from "../hooks/use-reverse-shares";
import { BasicInfoSection } from "./edit-reverse-share/basic-info-section";
import { ExpirationSection } from "./edit-reverse-share/expiration-section";
import { FieldRequirementsSection } from "./edit-reverse-share/field-requirements-section";
import { FileLimitsSection } from "./edit-reverse-share/file-limits-section";
import { PasswordSection } from "./edit-reverse-share/password-section";
import { DEFAULT_VALUES, type EditReverseShareFormData } from "./edit-reverse-share/types";

interface EditReverseShareModalProps {
  reverseShare: ReverseShare | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdateReverseShare: (data: UpdateReverseShareBody) => Promise<unknown>;
  isUpdating: boolean;
}

function getFormDefaultValues(): EditReverseShareFormData {
  return {
    name: DEFAULT_VALUES.EMPTY_STRING,
    description: DEFAULT_VALUES.EMPTY_STRING,
    expiration: DEFAULT_VALUES.EMPTY_STRING,
    maxFiles: DEFAULT_VALUES.EMPTY_STRING,
    maxFileSize: DEFAULT_VALUES.EMPTY_STRING,
    allowedFileTypes: DEFAULT_VALUES.EMPTY_STRING,
    pageLayout: DEFAULT_VALUES.PAGE_LAYOUT,
    nameFieldRequired: "OPTIONAL",
    emailFieldRequired: "OPTIONAL",
    hasExpiration: false,
    hasFileLimits: false,
    hasFieldRequirements: false,
    hasPassword: false,
    password: DEFAULT_VALUES.EMPTY_STRING,
    isActive: true,
    noFilesLimit: true,
    noSizeLimit: true,
    allFileTypes: true,
  };
}

function parsePositiveIntegerOrNull(value?: string): number | null {
  if (!value || value === DEFAULT_VALUES.ZERO_STRING) return null;
  const parsed = parseInt(value, 10);
  return parsed > 0 ? parsed : null;
}

function mapReverseShareToFormData(reverseShare: ReverseShare): EditReverseShareFormData {
  const maxFilesValue = reverseShare.maxFiles?.toString() || DEFAULT_VALUES.ZERO_STRING;
  const maxFileSizeValue = reverseShare.maxFileSize?.toString() || DEFAULT_VALUES.ZERO_STRING;
  const allowedFileTypesValue = reverseShare.allowedFileTypes || DEFAULT_VALUES.EMPTY_STRING;
  const expirationValue = reverseShare.expiration
    ? new Date(reverseShare.expiration).toISOString().slice(0, 16)
    : DEFAULT_VALUES.EMPTY_STRING;

  return {
    name: reverseShare.name || DEFAULT_VALUES.EMPTY_STRING,
    description: reverseShare.description || DEFAULT_VALUES.EMPTY_STRING,
    expiration: expirationValue,
    maxFiles: maxFilesValue,
    maxFileSize: maxFileSizeValue,
    allowedFileTypes: allowedFileTypesValue,
    pageLayout: (reverseShare.pageLayout as "DEFAULT" | "WETRANSFER") || DEFAULT_VALUES.PAGE_LAYOUT,
    nameFieldRequired:
      (reverseShare.nameFieldRequired as "HIDDEN" | "OPTIONAL" | "REQUIRED") || "OPTIONAL",
    emailFieldRequired:
      (reverseShare.emailFieldRequired as "HIDDEN" | "OPTIONAL" | "REQUIRED") || "OPTIONAL",
    hasExpiration: !!reverseShare.expiration,
    hasFileLimits: !!(
      reverseShare.maxFiles ||
      reverseShare.maxFileSize ||
      reverseShare.allowedFileTypes
    ),
    hasFieldRequirements:
      reverseShare.nameFieldRequired !== "OPTIONAL" ||
      reverseShare.emailFieldRequired !== "OPTIONAL",
    hasPassword: reverseShare.hasPassword,
    password: DEFAULT_VALUES.EMPTY_STRING,
    isActive: reverseShare.isActive,
    noFilesLimit: !reverseShare.maxFiles,
    noSizeLimit: !reverseShare.maxFileSize,
    allFileTypes: !reverseShare.allowedFileTypes,
  };
}

function buildUpdatePayload(data: EditReverseShareFormData, id: string): UpdateReverseShareBody {
  const payload: UpdateReverseShareBody = {
    id,
    name: data.name,
    pageLayout: data.pageLayout || DEFAULT_VALUES.PAGE_LAYOUT,
    isActive: data.isActive,
    nameFieldRequired: data.nameFieldRequired,
    emailFieldRequired: data.emailFieldRequired,
  };

  if (data.description?.trim()) {
    payload.description = data.description.trim();
  }

  if (data.hasExpiration && data.expiration) {
    payload.expiration = new Date(data.expiration).toISOString();
  } else if (!data.hasExpiration) {
    payload.expiration = undefined;
  }

  if (data.hasFileLimits) {
    payload.maxFiles = parsePositiveIntegerOrNull(data.maxFiles);
    payload.maxFileSize = parsePositiveIntegerOrNull(data.maxFileSize);
  } else {
    payload.maxFiles = null;
    payload.maxFileSize = null;
  }

  payload.allowedFileTypes = data.allowedFileTypes?.trim() || null;

  if (data.hasPassword && data.password) {
    payload.password = data.password;
  } else if (!data.hasPassword) {
    payload.password = undefined;
  }

  return payload;
}

export function EditReverseShareModal({
  reverseShare,
  isOpen,
  onClose,
  onUpdateReverseShare,
  isUpdating,
}: EditReverseShareModalProps) {
  const t = useTranslations();

  const form = useForm<EditReverseShareFormData>({
    defaultValues: getFormDefaultValues(),
  });

  const watchedValues = {
    hasExpiration: form.watch("hasExpiration"),
    hasFileLimits: form.watch("hasFileLimits"),
    hasFieldRequirements: form.watch("hasFieldRequirements"),
    noFilesLimit: form.watch("noFilesLimit"),
    noSizeLimit: form.watch("noSizeLimit"),
    allFileTypes: form.watch("allFileTypes"),
    hasPassword: form.watch("hasPassword"),
  };

  useEffect(() => {
    if (reverseShare) {
      form.reset(mapReverseShareToFormData(reverseShare));
    }
  }, [reverseShare, form]);

  const handleSubmit = async (data: EditReverseShareFormData) => {
    if (!reverseShare) return;

    try {
      const payload = buildUpdatePayload(data, reverseShare.id);
      await onUpdateReverseShare(payload);
    } catch {
      // Error is handled by the hook
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[500px] md:max-w-[650px] max-h-[85vh] overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-5" />
            {t("reverseShares.modals.edit.title")}
          </DialogTitle>
          <DialogDescription>{t("reverseShares.modals.edit.description")}</DialogDescription>
        </DialogHeader>

        <div className="overflow-y-auto max-h-[calc(85vh-140px)] py-2">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
              <BasicInfoSection form={form} />
              <Separator />
              <ExpirationSection form={form} hasExpiration={watchedValues.hasExpiration} />
              <Separator />
              <FileLimitsSection
                form={form}
                hasFileLimits={watchedValues.hasFileLimits}
                noFilesLimit={watchedValues.noFilesLimit}
                noSizeLimit={watchedValues.noSizeLimit}
                allFileTypes={watchedValues.allFileTypes}
              />
              <Separator />
              <PasswordSection form={form} hasPassword={watchedValues.hasPassword} />
              <Separator />
              <FieldRequirementsSection
                form={form}
                hasFieldRequirements={watchedValues.hasFieldRequirements}
              />

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={onClose} disabled={isUpdating}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isUpdating}>
                  {isUpdating ? (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin">⠋</div>
                      {t("reverseShares.modals.edit.updating")}
                    </div>
                  ) : (
                    t("reverseShares.modals.edit.saveChanges")
                  )}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
