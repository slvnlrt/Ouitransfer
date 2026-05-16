"use client";

import { Upload } from "lucide-react";
import { useTranslations } from "next-intl";
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
import type { CreateReverseShareBody } from "@/http/endpoints/reverse-shares/types";
import { BasicInfoSection } from "./create-reverse-share/basic-info-section";
import { ExpirationSection } from "./create-reverse-share/expiration-section";
import { FieldRequirementsSection } from "./create-reverse-share/field-requirements-section";
import { FileLimitsSection } from "./create-reverse-share/file-limits-section";
import { PasswordSection } from "./create-reverse-share/password-section";
import { type CreateReverseShareFormData, DEFAULT_FORM_VALUES } from "./create-reverse-share/types";

const DIALOG_CONFIG = {
  maxWidth: "sm:max-w-[500px] md:max-w-[650px]",
  maxHeight: "max-h-[85vh]",
  contentMaxHeight: "max-h-[calc(85vh-140px)]",
} as const;

interface CreateReverseShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateReverseShare: (data: CreateReverseShareBody) => Promise<void>;
  isCreating: boolean;
}

function buildPayload(formData: CreateReverseShareFormData): CreateReverseShareBody {
  const payload: CreateReverseShareBody = {
    name: formData.name,
    pageLayout: formData.pageLayout || "DEFAULT",
    nameFieldRequired: formData.nameFieldRequired,
    emailFieldRequired: formData.emailFieldRequired,
  };

  if (formData.description?.trim()) {
    payload.description = formData.description.trim();
  }

  if (formData.hasExpiration && formData.expiration) {
    payload.expiration = new Date(formData.expiration).toISOString();
  }

  if (formData.isPasswordProtected && formData.password?.trim()) {
    payload.password = formData.password.trim();
  }

  if (formData.hasFileLimits) {
    const maxFiles = parseInt(formData.maxFiles || "0", 10);
    const maxFileSize = parseInt(formData.maxFileSize || "0", 10);

    if (maxFiles > 0) {
      payload.maxFiles = maxFiles;
    }

    if (maxFileSize > 0) {
      payload.maxFileSize = maxFileSize;
    }
  }

  if (formData.allowedFileTypes?.trim()) {
    payload.allowedFileTypes = formData.allowedFileTypes.trim();
  }

  return payload;
}

export function CreateReverseShareModal({
  isOpen,
  onClose,
  onCreateReverseShare,
  isCreating,
}: CreateReverseShareModalProps) {
  const t = useTranslations();

  const form = useForm<CreateReverseShareFormData>({
    defaultValues: DEFAULT_FORM_VALUES,
  });

  const watchedValues = {
    isPasswordProtected: form.watch("isPasswordProtected"),
    hasExpiration: form.watch("hasExpiration"),
    hasFileLimits: form.watch("hasFileLimits"),
    hasFieldRequirements: form.watch("hasFieldRequirements"),
    noFilesLimit: form.watch("noFilesLimit"),
    noSizeLimit: form.watch("noSizeLimit"),
    allFileTypes: form.watch("allFileTypes"),
  };

  const handleSubmit = async (formData: CreateReverseShareFormData) => {
    try {
      const payload = buildPayload(formData);
      await onCreateReverseShare(payload);
      form.reset();
    } catch {
      // Error handling is managed by the hook
    }
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent
        className={`${DIALOG_CONFIG.maxWidth} ${DIALOG_CONFIG.maxHeight} overflow-hidden`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload size={20} />
            {t("reverseShares.modals.create.title")}
          </DialogTitle>
          <DialogDescription>{t("reverseShares.modals.create.description")}</DialogDescription>
        </DialogHeader>

        <div className={`overflow-y-auto ${DIALOG_CONFIG.contentMaxHeight} py-2`}>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
              <BasicInfoSection form={form} />
              <Separator />
              <ExpirationSection form={form} hasExpiration={watchedValues.hasExpiration} />
              <Separator />
              <PasswordSection
                form={form}
                isPasswordProtected={watchedValues.isPasswordProtected}
              />
              <Separator />
              <FileLimitsSection
                form={form}
                hasFileLimits={watchedValues.hasFileLimits}
                noFilesLimit={watchedValues.noFilesLimit}
                noSizeLimit={watchedValues.noSizeLimit}
                allFileTypes={watchedValues.allFileTypes}
              />
              <Separator />
              <FieldRequirementsSection
                form={form}
                hasFieldRequirements={watchedValues.hasFieldRequirements}
              />

              <DialogFooter className="gap-2">
                <Button type="button" variant="outline" onClick={handleClose} disabled={isCreating}>
                  {t("common.cancel")}
                </Button>
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin">⠋</div>
                      {t("common.creating")}
                    </div>
                  ) : (
                    t("reverseShares.form.submit")
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
