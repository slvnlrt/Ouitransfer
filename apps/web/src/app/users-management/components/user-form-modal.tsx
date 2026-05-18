import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { FileSizeInput } from "@/app/settings/components/file-size-input";
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
import { getUserQuota, updateUserQuota } from "@/http/endpoints/users";
import { queryKeys } from "@/lib/query-keys";
import type { UserFormModalProps } from "../types";

type QuotaMode = "inherit" | "unlimited" | "custom";

function getInitialMode(override: string | null | undefined): QuotaMode {
  if (override === null || override === undefined) return "inherit";
  if (override === "0") return "unlimited";
  return "custom";
}

function formatBytes(bytes: string): string {
  const n = Number(bytes);
  if (n === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(n) / Math.log(1024));
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function UserFormModal({
  isOpen,
  onClose,
  modalMode,
  selectedUser,
  formMethods,
  onSubmit,
}: UserFormModalProps) {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const {
    register,
    formState: { errors, isSubmitting },
    control,
  } = formMethods;

  const [fileSizeMode, setFileSizeMode] = useState<QuotaMode>("inherit");
  const [fileSizeValue, setFileSizeValue] = useState("0");
  const [storageLimitMode, setStorageLimitMode] = useState<QuotaMode>("inherit");
  const [storageLimitValue, setStorageLimitValue] = useState("0");

  useEffect(() => {
    if (modalMode === "edit" && selectedUser) {
      const fsOverride = selectedUser.maxFileSizeOverride;
      const stOverride = selectedUser.maxTotalStorageOverride;

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
  }, [selectedUser, isOpen, modalMode]);

  const quotaQuery = useQuery({
    queryKey: queryKeys.users.quota(selectedUser?.id ?? ""),
    queryFn: () => getUserQuota(selectedUser!.id),
    enabled: modalMode === "edit" && !!selectedUser,
  });

  const handleFormSubmit = async (data: Parameters<typeof onSubmit>[0]) => {
    await onSubmit(data);

    // Also save quota changes when in edit mode
    if (modalMode === "edit" && selectedUser) {
      const body: Record<string, string | null> = {};

      if (fileSizeMode === "inherit") body.maxFileSizeOverride = null;
      else if (fileSizeMode === "unlimited") body.maxFileSizeOverride = "0";
      else body.maxFileSizeOverride = fileSizeValue;

      if (storageLimitMode === "inherit") body.maxTotalStorageOverride = null;
      else if (storageLimitMode === "unlimited") body.maxTotalStorageOverride = "0";
      else body.maxTotalStorageOverride = storageLimitValue;

      try {
        await updateUserQuota(selectedUser.id, body);
        queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
        queryClient.invalidateQueries({ queryKey: queryKeys.users.quota(selectedUser.id) });
      } catch {
        toast.error(t("users.form.quota.saveError"));
      }
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <Form {...formMethods}>
          <form onSubmit={formMethods.handleSubmit(handleFormSubmit)}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 mb-2">
                <UserPlus className="size-6 me-1" />
                {modalMode === "create" ? t("users.form.titleCreate") : t("users.form.titleEdit")}
              </DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <Label>{t("users.form.firstName")}</Label>
                        <Input
                          {...field}
                          className={errors.firstName ? "border-destructive" : ""}
                        />
                        {errors.firstName && <FormMessage>{errors.firstName.message}</FormMessage>}
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <Label>{t("users.form.lastName")}</Label>
                        <Input {...field} className={errors.lastName ? "border-destructive" : ""} />
                        {errors.lastName && <FormMessage>{errors.lastName.message}</FormMessage>}
                      </FormItem>
                    )}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t("users.form.username")}</Label>
                  <Input
                    {...register("username")}
                    className={errors.username ? "border-destructive" : ""}
                  />
                  {errors.username && <FormMessage>{errors.username.message}</FormMessage>}
                </div>

                <div className="space-y-2">
                  <Label>{t("users.form.email")}</Label>
                  <Input
                    {...register("email")}
                    type="email"
                    className={errors.email ? "border-destructive" : ""}
                  />
                  {errors.email && <FormMessage>{errors.email.message}</FormMessage>}
                </div>

                <div className="space-y-2">
                  <Label>
                    {modalMode === "create"
                      ? t("users.form.password")
                      : t("users.form.newPassword")}
                  </Label>
                  <Input
                    {...register("password")}
                    type="password"
                    className={errors.password ? "border-destructive" : ""}
                    placeholder={
                      modalMode === "edit" ? t("users.form.passwordPlaceholder") : undefined
                    }
                  />
                  {errors.password && <FormMessage>{errors.password.message}</FormMessage>}
                </div>

                {modalMode === "edit" && (
                  <div className="space-y-2">
                    <Label>{t("users.form.role")}</Label>
                    <FormField
                      control={control}
                      name="isAdmin"
                      render={({ field }) => (
                        <FormItem>
                          <Select
                            defaultValue={selectedUser?.isAdmin ? "true" : "false"}
                            onValueChange={(value) => field.onChange(value === "true")}
                            value={field.value?.toString()}
                          >
                            <SelectTrigger className={errors.isAdmin ? "border-destructive" : ""}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="false">{t("users.form.roleUser")}</SelectItem>
                              <SelectItem value="true">{t("users.form.roleAdmin")}</SelectItem>
                            </SelectContent>
                          </Select>
                          {errors.isAdmin && <FormMessage>{errors.isAdmin.message}</FormMessage>}
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                {modalMode === "edit" && (
                  <>
                    <Separator />
                    <div className="flex flex-col gap-4">
                      <p className="text-sm font-medium">{t("users.form.quota.title")}</p>

                      {quotaQuery.data && (
                        <div className="text-sm text-muted-foreground space-y-1 rounded-md border p-3">
                          <div className="flex justify-between">
                            <span>{t("users.form.quota.currentUsage")}</span>
                            <span>{formatBytes(quotaQuery.data.data.used)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>{t("users.form.quota.effectiveMaxFileSize")}</span>
                            <span>
                              {quotaQuery.data.data.maxFileSize === "0"
                                ? t("users.form.quota.unlimited")
                                : formatBytes(quotaQuery.data.data.maxFileSize)}
                            </span>
                          </div>
                          <div className="flex justify-between">
                            <span>{t("users.form.quota.effectiveMaxStorage")}</span>
                            <span>
                              {quotaQuery.data.data.maxTotalStorage === "0"
                                ? t("users.form.quota.unlimited")
                                : formatBytes(quotaQuery.data.data.maxTotalStorage)}
                            </span>
                          </div>
                          {quotaQuery.data.data.maxTotalStorage !== "0" && (
                            <div className="flex justify-between">
                              <span>{t("users.form.quota.usagePercent")}</span>
                              <span>{quotaQuery.data.data.percentage}%</span>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Max File Size */}
                      <div className="space-y-2">
                        <Label>{t("users.form.quota.maxFileSize")}</Label>
                        <Select
                          value={fileSizeMode}
                          onValueChange={(value) => {
                            const mode = value as QuotaMode;
                            setFileSizeMode(mode);
                            if (mode === "custom" && (!fileSizeValue || fileSizeValue === "0")) {
                              const effectiveDefault =
                                quotaQuery.data?.data.maxFileSize &&
                                quotaQuery.data.data.maxFileSize !== "0"
                                  ? quotaQuery.data.data.maxFileSize
                                  : "1073741824";
                              setFileSizeValue(effectiveDefault);
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">{t("users.form.quota.inherit")}</SelectItem>
                            <SelectItem value="unlimited">
                              {t("users.form.quota.unlimited")}
                            </SelectItem>
                            <SelectItem value="custom">{t("users.form.quota.custom")}</SelectItem>
                          </SelectContent>
                        </Select>
                        {fileSizeMode === "custom" && (
                          <FileSizeInput value={fileSizeValue} onChange={setFileSizeValue} />
                        )}
                      </div>

                      {/* Max Total Storage */}
                      <div className="space-y-2">
                        <Label>{t("users.form.quota.maxTotalStorage")}</Label>
                        <Select
                          value={storageLimitMode}
                          onValueChange={(value) => {
                            const mode = value as QuotaMode;
                            setStorageLimitMode(mode);
                            if (
                              mode === "custom" &&
                              (!storageLimitValue || storageLimitValue === "0")
                            ) {
                              const effectiveDefault =
                                quotaQuery.data?.data.maxTotalStorage &&
                                quotaQuery.data.data.maxTotalStorage !== "0"
                                  ? quotaQuery.data.data.maxTotalStorage
                                  : "1073741824";
                              setStorageLimitValue(effectiveDefault);
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="inherit">{t("users.form.quota.inherit")}</SelectItem>
                            <SelectItem value="unlimited">
                              {t("users.form.quota.unlimited")}
                            </SelectItem>
                            <SelectItem value="custom">{t("users.form.quota.custom")}</SelectItem>
                          </SelectContent>
                        </Select>
                        {storageLimitMode === "custom" && (
                          <FileSizeInput
                            value={storageLimitValue}
                            onChange={setStorageLimitValue}
                          />
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onClose} type="button">
                {t("common.cancel")}
              </Button>
              <Button disabled={isSubmitting} type="submit">
                {modalMode === "create" ? "" : <Save className="h-4 w-4" />}
                {modalMode === "create" ? t("users.form.create") : t("users.form.save")}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
