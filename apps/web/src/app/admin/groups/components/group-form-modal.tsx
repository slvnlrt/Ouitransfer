import { Layers, Save } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { FileSizeInput } from "@/app/admin/settings/components/file-size-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { GroupFormModalProps } from "../types";

type QuotaMode = "inherit" | "unlimited" | "custom";

function getInitialMode(override: string | null | undefined): QuotaMode {
  if (override === null || override === undefined) return "inherit";
  if (override === "0") return "unlimited";
  return "custom";
}

export function GroupFormModal({
  isOpen,
  onClose,
  modalMode,
  selectedGroup,
  formMethods,
  onSubmit,
}: GroupFormModalProps) {
  const t = useTranslations();
  const {
    formState: { errors, isSubmitting },
    control,
  } = formMethods;

  const [fileSizeMode, setFileSizeMode] = useState<QuotaMode>("inherit");
  const [fileSizeValue, setFileSizeValue] = useState("0");
  const [storageLimitMode, setStorageLimitMode] = useState<QuotaMode>("inherit");
  const [storageLimitValue, setStorageLimitValue] = useState("0");

  useEffect(() => {
    if (modalMode === "edit" && selectedGroup) {
      const fsOverride = selectedGroup.maxFileSizeOverride;
      const stOverride = selectedGroup.maxTotalStorageOverride;

      setFileSizeMode(getInitialMode(fsOverride));
      setFileSizeValue(fsOverride && fsOverride !== "0" ? fsOverride : "0");

      setStorageLimitMode(getInitialMode(stOverride));
      setStorageLimitValue(stOverride && stOverride !== "0" ? stOverride : "0");
    } else {
      setFileSizeMode("inherit");
      setFileSizeValue("0");
      setStorageLimitMode("inherit");
      setStorageLimitValue("0");
    }
  }, [selectedGroup, isOpen, modalMode]);

  const handleFormSubmit = async (data: Parameters<typeof onSubmit>[0]) => {
    const body = {
      ...data,
      maxFileSizeOverride:
        fileSizeMode === "inherit" ? null : fileSizeMode === "unlimited" ? "0" : fileSizeValue,
      maxTotalStorageOverride:
        storageLimitMode === "inherit"
          ? null
          : storageLimitMode === "unlimited"
            ? "0"
            : storageLimitValue,
    };
    await onSubmit(body);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-lg">
        <Form {...formMethods}>
          <form onSubmit={formMethods.handleSubmit(handleFormSubmit)}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 mb-2">
                <Layers className="size-6 me-1" />
                {modalMode === "create" ? t("groups.form.titleCreate") : t("groups.form.titleEdit")}
              </DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <div className="flex flex-col gap-4">
                <FormField
                  control={control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("groups.form.name")}</Label>
                      <Input {...field} className={errors.name ? "border-destructive" : ""} />
                      {errors.name && <FormMessage>{errors.name.message}</FormMessage>}
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("groups.form.description")}</Label>
                      <Textarea
                        {...field}
                        className={errors.description ? "border-destructive" : ""}
                        rows={3}
                      />
                      {errors.description && (
                        <FormMessage>{errors.description.message}</FormMessage>
                      )}
                    </FormItem>
                  )}
                />

                <FormField
                  control={control}
                  name="ldapDn"
                  render={({ field }) => (
                    <FormItem>
                      <Label>{t("groups.form.ldapDn.label")}</Label>
                      <Input
                        {...field}
                        placeholder={t("groups.form.ldapDn.placeholder")}
                        className={errors.ldapDn ? "border-destructive" : ""}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("groups.form.ldapDn.description")}
                      </p>
                      {errors.ldapDn && <FormMessage>{errors.ldapDn.message}</FormMessage>}
                    </FormItem>
                  )}
                />

                <Separator />

                <div className="flex flex-col gap-4">
                  <p className="text-sm font-medium">{t("groups.form.quota.title")}</p>

                  {/* Max File Size */}
                  <div className="space-y-2">
                    <Label>{t("groups.form.quota.maxFileSize")}</Label>
                    <Select
                      value={fileSizeMode}
                      onValueChange={(value) => {
                        const mode = value as QuotaMode;
                        setFileSizeMode(mode);
                        if (mode === "custom" && (!fileSizeValue || fileSizeValue === "0")) {
                          setFileSizeValue("1073741824");
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">{t("groups.form.quota.inherit")}</SelectItem>
                        <SelectItem value="unlimited">
                          {t("groups.form.quota.unlimited")}
                        </SelectItem>
                        <SelectItem value="custom">{t("groups.form.quota.custom")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {fileSizeMode === "custom" && (
                      <FileSizeInput value={fileSizeValue} onChange={setFileSizeValue} />
                    )}
                  </div>

                  {/* Max Total Storage */}
                  <div className="space-y-2">
                    <Label>{t("groups.form.quota.maxTotalStorage")}</Label>
                    <Select
                      value={storageLimitMode}
                      onValueChange={(value) => {
                        const mode = value as QuotaMode;
                        setStorageLimitMode(mode);
                        if (
                          mode === "custom" &&
                          (!storageLimitValue || storageLimitValue === "0")
                        ) {
                          setStorageLimitValue("1073741824");
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">{t("groups.form.quota.inherit")}</SelectItem>
                        <SelectItem value="unlimited">
                          {t("groups.form.quota.unlimited")}
                        </SelectItem>
                        <SelectItem value="custom">{t("groups.form.quota.custom")}</SelectItem>
                      </SelectContent>
                    </Select>
                    {storageLimitMode === "custom" && (
                      <FileSizeInput value={storageLimitValue} onChange={setStorageLimitValue} />
                    )}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} type="button">
                {t("common.cancel")}
              </Button>
              <Button disabled={isSubmitting} type="submit">
                {modalMode === "create" ? null : <Save className="h-4 w-4" />}
                {modalMode === "create" ? t("groups.form.create") : t("groups.form.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
