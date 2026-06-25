import { useQuery } from "@tanstack/react-query";
import { Layers, Save, Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { LdapGroupSearch } from "@/app/admin/ldap/components/ldap-group-search";
import type { LdapConnectionValues } from "@/app/admin/ldap/types";
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
import { getLdapConfig } from "@/http/endpoints/ldap";
import { queryKeys } from "@/lib/query-keys";
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
    setValue,
  } = formMethods;

  const [fileSizeMode, setFileSizeMode] = useState<QuotaMode>("inherit");
  const [fileSizeValue, setFileSizeValue] = useState("0");
  const [storageLimitMode, setStorageLimitMode] = useState<QuotaMode>("inherit");
  const [storageLimitValue, setStorageLimitValue] = useState("0");
  const [groupSearchOpen, setGroupSearchOpen] = useState(false);

  // Reuse the LDAP directory group search (built for the LDAP config screen) so
  // admins pick the AD group DN from the live directory instead of typing it.
  // The mapping modal has no connection form, so we source the connection from
  // the saved LDAP config; the bind password is left empty and the server reuses
  // the stored encrypted one (resolveBindPassword).
  const { data: ldapConfig } = useQuery({
    queryKey: queryKeys.ldap.config(),
    queryFn: async () => (await getLdapConfig()).data,
    enabled: isOpen,
  });

  const ldapSearchBase = ldapConfig?.searchBase ?? "";
  const ldapConnection: LdapConnectionValues = {
    serverUrl: ldapConfig?.serverUrl ?? "",
    bindDn: ldapConfig?.bindDn ?? "",
    bindPassword: "",
    useTls: ldapConfig?.useTls ?? true,
    tlsSkipVerify: ldapConfig?.tlsSkipVerify ?? false,
  };
  // Browsing is offered only when LDAP is configured with the connection
  // prerequisites a group search needs (it roots at the search base, scope=sub).
  const canBrowseGroups =
    Boolean(ldapConfig?.configured) &&
    Boolean(ldapConnection.serverUrl) &&
    Boolean(ldapConnection.bindDn) &&
    Boolean(ldapSearchBase);

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
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="sm:max-w-lg">
          <Form {...formMethods}>
            <form onSubmit={formMethods.handleSubmit(handleFormSubmit)}>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 mb-2">
                  <Layers className="size-6 me-1" />
                  {modalMode === "create"
                    ? t("groups.form.titleCreate")
                    : t("groups.form.titleEdit")}
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
                        <div className="flex gap-2">
                          <Input
                            {...field}
                            placeholder={t("groups.form.ldapDn.placeholder")}
                            className={`flex-1 ${errors.ldapDn ? "border-destructive" : ""}`}
                          />
                          {canBrowseGroups && (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => setGroupSearchOpen(true)}
                              aria-label={t("ldap.browse.groups.buttonLabel")}
                              title={t("ldap.browse.groups.buttonLabel")}
                            >
                              <Search className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
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

      {canBrowseGroups && (
        <LdapGroupSearch
          open={groupSearchOpen}
          onOpenChange={setGroupSearchOpen}
          connection={ldapConnection}
          searchBase={ldapSearchBase}
          onSelect={(dn) => setValue("ldapDn", dn, { shouldValidate: true })}
        />
      )}
    </>
  );
}
