"use client";

import { ChevronDown, ChevronUp, Eye, File, Files } from "lucide-react";
import { useTranslations } from "next-intl";
import type { UseFormReturn } from "react-hook-form";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FileSizeInput } from "../file-size-input";
import { FileTypesTagsInput } from "../file-types-tags-input";
import type { CreateReverseShareFormData } from "./types";

interface FileLimitsSectionProps {
  form: UseFormReturn<CreateReverseShareFormData>;
  hasFileLimits: boolean;
  noFilesLimit: boolean;
  noSizeLimit: boolean;
  allFileTypes: boolean;
}

export function FileLimitsSection({
  form,
  hasFileLimits,
  noFilesLimit,
  noSizeLimit,
  allFileTypes,
}: FileLimitsSectionProps) {
  const t = useTranslations();

  const toggleFileLimits = () => {
    const currentValue = form.getValues("hasFileLimits");
    form.setValue("hasFileLimits", !currentValue);
    if (currentValue) {
      form.setValue("maxFiles", "");
      form.setValue("maxFileSize", "");
      form.setValue("allowedFileTypes", "");
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1">
        <Label className="flex items-center gap-2">
          <File className="size-4" />
          {t("reverseShares.labels.configureLimits")}
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={toggleFileLimits}
        >
          {hasFileLimits ? (
            <ChevronUp className="size-3.5" />
          ) : (
            <ChevronDown className="size-3.5" />
          )}
        </Button>
      </div>

      {hasFileLimits && (
        <div className="space-y-4">
          <FormField
            control={form.control}
            name="maxFiles"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  <Eye className="size-4" />
                  {t("reverseShares.form.maxFiles.label")}
                </FormLabel>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="no-files-limit-create"
                      checked={noFilesLimit}
                      onCheckedChange={(checked) => {
                        form.setValue("noFilesLimit", !!checked);
                        if (checked) field.onChange("0");
                      }}
                    />
                    <label
                      htmlFor="no-files-limit-create"
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      {t("reverseShares.form.maxFiles.noLimit")}
                    </label>
                  </div>
                  {!noFilesLimit && (
                    <FormControl>
                      <Input
                        type="number"
                        min="1"
                        placeholder={t("reverseShares.form.maxFiles.placeholder")}
                        {...field}
                      />
                    </FormControl>
                  )}
                </div>
                <FormDescription className="text-xs">
                  {t("reverseShares.form.maxFiles.description")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="maxFileSize"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="flex items-center gap-2">
                  <Files className="size-4" />
                  {t("reverseShares.form.maxFileSize.label")}
                </FormLabel>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="no-size-limit-create"
                      checked={noSizeLimit}
                      onCheckedChange={(checked) => {
                        form.setValue("noSizeLimit", !!checked);
                        if (checked) field.onChange("0");
                      }}
                    />
                    <label
                      htmlFor="no-size-limit-create"
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      {t("reverseShares.form.maxFileSize.noLimit")}
                    </label>
                  </div>
                  {!noSizeLimit && (
                    <FormControl>
                      <FileSizeInput
                        value={field.value || ""}
                        onChange={field.onChange}
                        placeholder={t("reverseShares.form.maxFileSize.placeholder")}
                      />
                    </FormControl>
                  )}
                </div>
                <FormDescription className="text-xs">
                  {t("reverseShares.form.maxFileSize.description")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="allowedFileTypes"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("reverseShares.form.allowedFileTypes.label")}</FormLabel>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="all-file-types-create"
                      checked={allFileTypes}
                      onCheckedChange={(checked) => {
                        form.setValue("allFileTypes", !!checked);
                        if (checked) field.onChange("");
                      }}
                    />
                    <label
                      htmlFor="all-file-types-create"
                      className="text-sm text-muted-foreground cursor-pointer"
                    >
                      {t("reverseShares.form.allowedFileTypes.allTypes")}
                    </label>
                  </div>
                  {!allFileTypes && (
                    <FormControl>
                      <FileTypesTagsInput
                        value={field.value ? field.value.split(",").filter(Boolean) : []}
                        onChange={(tags) => field.onChange(tags.join(","))}
                        placeholder="jpg png pdf docx"
                      />
                    </FormControl>
                  )}
                </div>
                <FormDescription className="text-xs">
                  {t("reverseShares.form.allowedFileTypes.description")}
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      )}
    </div>
  );
}
