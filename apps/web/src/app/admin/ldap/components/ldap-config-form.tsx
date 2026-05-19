"use client";

import { AlertTriangle, CheckCircle, Loader2, Server, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LdapConfigFormProps } from "../types";

export function LdapConfigForm({
  isSaving,
  isTesting,
  testResult,
  formMethods,
  onSave,
  onTest,
}: LdapConfigFormProps) {
  const t = useTranslations();
  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = formMethods;
  const enabled = watch("enabled");
  const useTls = watch("useTls");
  const tlsSkipVerify = watch("tlsSkipVerify");
  const bindPassword = watch("bindPassword");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Server className="h-5 w-5 text-muted-foreground" />
            <div>
              <CardTitle>{t("ldap.config.title")}</CardTitle>
              <CardDescription>{t("ldap.config.description")}</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Label htmlFor="ldap-enabled">{t("ldap.config.enabled")}</Label>
            <Switch
              id="ldap-enabled"
              checked={enabled}
              onCheckedChange={(checked) => setValue("enabled", checked)}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSave)} className="space-y-6">
          {/* Connection */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t("ldap.config.connection")}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="serverUrl">{t("ldap.config.serverUrl")}</Label>
                <Input
                  id="serverUrl"
                  placeholder="ldaps://ad.corp.local:636"
                  {...register("serverUrl")}
                />
                {errors.serverUrl && (
                  <p className="text-sm text-destructive">{errors.serverUrl.message}</p>
                )}
              </div>
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 pt-6">
                  <Label htmlFor="useTls">{t("ldap.config.useTls")}</Label>
                  <Switch
                    id="useTls"
                    checked={useTls}
                    onCheckedChange={(checked) => setValue("useTls", checked)}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="tlsSkipVerify">{t("ldap.config.tlsSkipVerify")}</Label>
                  <Switch
                    id="tlsSkipVerify"
                    checked={tlsSkipVerify}
                    onCheckedChange={(checked) => setValue("tlsSkipVerify", checked)}
                  />
                </div>
                {tlsSkipVerify && (
                  <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span>{t("ldap.config.tlsSkipVerifyWarning")}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="bindDn">{t("ldap.config.bindDn")}</Label>
                <Input
                  id="bindDn"
                  placeholder="cn=svc-ouitransfer,ou=Service Accounts,dc=corp,dc=local"
                  {...register("bindDn")}
                />
                {errors.bindDn && (
                  <p className="text-sm text-destructive">{errors.bindDn.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="bindPassword">{t("ldap.config.bindPassword")}</Label>
                <Input
                  id="bindPassword"
                  type="password"
                  autoComplete="new-password"
                  placeholder={t("ldap.config.bindPasswordPlaceholder")}
                  {...register("bindPassword")}
                />
                {errors.bindPassword && (
                  <p className="text-sm text-destructive">{errors.bindPassword.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Search */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t("ldap.config.search")}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="searchBase">{t("ldap.config.searchBase")}</Label>
                <Input id="searchBase" placeholder="DC=corp,DC=local" {...register("searchBase")} />
                {errors.searchBase && (
                  <p className="text-sm text-destructive">{errors.searchBase.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="syncGroupDn">{t("ldap.config.syncGroupDn")}</Label>
                <Input
                  id="syncGroupDn"
                  placeholder="CN=OuiTransfer Users,OU=Groups,DC=corp,DC=local"
                  {...register("syncGroupDn")}
                />
                {errors.syncGroupDn && (
                  <p className="text-sm text-destructive">{errors.syncGroupDn.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Attribute Mapping */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t("ldap.config.attributes")}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="usernameAttribute">{t("ldap.config.usernameAttr")}</Label>
                <Input id="usernameAttribute" {...register("usernameAttribute")} />
                {errors.usernameAttribute && (
                  <p className="text-sm text-destructive">{errors.usernameAttribute.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="emailAttribute">{t("ldap.config.emailAttr")}</Label>
                <Input id="emailAttribute" {...register("emailAttribute")} />
                {errors.emailAttribute && (
                  <p className="text-sm text-destructive">{errors.emailAttribute.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayNameAttribute">{t("ldap.config.displayNameAttr")}</Label>
                <Input id="displayNameAttribute" {...register("displayNameAttribute")} />
                {errors.displayNameAttribute && (
                  <p className="text-sm text-destructive">{errors.displayNameAttribute.message}</p>
                )}
              </div>
            </div>
          </div>

          {/* Sync Settings */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium">{t("ldap.config.syncSettings")}</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="syncIntervalMinutes">{t("ldap.config.syncInterval")}</Label>
                <Input
                  id="syncIntervalMinutes"
                  type="number"
                  min={15}
                  max={10080}
                  {...register("syncIntervalMinutes", { valueAsNumber: true })}
                />
                {errors.syncIntervalMinutes && (
                  <p className="text-sm text-destructive">{errors.syncIntervalMinutes.message}</p>
                )}
                <p className="text-xs text-muted-foreground">{t("ldap.config.syncIntervalHelp")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="appUrl">{t("ldap.config.appUrl")}</Label>
                <Input
                  id="appUrl"
                  placeholder="https://transfer.company.com"
                  {...register("appUrl")}
                />
                {errors.appUrl && (
                  <p className="text-sm text-destructive">{errors.appUrl.message}</p>
                )}
                <p className="text-xs text-muted-foreground">{t("ldap.config.appUrlHelp")}</p>
              </div>
            </div>
          </div>

          {/* Test Result (I-6: ARIA live region) */}
          {testResult && (
            <div
              role="status"
              aria-live="polite"
              className={`flex items-center gap-2 rounded-md border p-3 ${
                testResult.success
                  ? "border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950"
                  : "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-950"
              }`}
            >
              {testResult.success ? (
                <CheckCircle className="h-4 w-4 text-green-600" />
              ) : (
                <XCircle className="h-4 w-4 text-red-600" />
              )}
              <span className="text-sm">{testResult.message}</span>
              {testResult.success && (
                <Badge variant="secondary" className="ml-auto">
                  {testResult.memberCount} {t("ldap.config.members")}
                </Badge>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("ldap.config.save")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={onTest}
              disabled={isTesting || !bindPassword}
            >
              {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("ldap.config.testConnection")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
