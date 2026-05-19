"use client";

import { CheckCircle, Loader2, Server, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { LdapConfigFormProps } from "../types";

export function LdapConfigForm({
  isLoading,
  isSaving,
  isTesting,
  testResult,
  formMethods,
  onSave,
  onTest,
}: LdapConfigFormProps) {
  const t = useTranslations();
  const { register, handleSubmit, watch, setValue } = formMethods;
  const enabled = watch("enabled");
  const useTls = watch("useTls");

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin" />
        </CardContent>
      </Card>
    );
  }

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
              </div>
              <div className="flex items-end gap-4">
                <div className="flex items-center gap-2">
                  <Label htmlFor="useTls">{t("ldap.config.useTls")}</Label>
                  <Switch
                    id="useTls"
                    checked={useTls}
                    onCheckedChange={(checked) => setValue("useTls", checked)}
                  />
                </div>
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="bindPassword">{t("ldap.config.bindPassword")}</Label>
                <Input
                  id="bindPassword"
                  type="password"
                  placeholder="••••••••"
                  {...register("bindPassword")}
                />
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="syncGroupDn">{t("ldap.config.syncGroupDn")}</Label>
                <Input
                  id="syncGroupDn"
                  placeholder="CN=OuiTransfer Users,OU=Groups,DC=corp,DC=local"
                  {...register("syncGroupDn")}
                />
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="emailAttribute">{t("ldap.config.emailAttr")}</Label>
                <Input id="emailAttribute" {...register("emailAttribute")} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="displayNameAttribute">{t("ldap.config.displayNameAttr")}</Label>
                <Input id="displayNameAttribute" {...register("displayNameAttribute")} />
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
                <p className="text-xs text-muted-foreground">{t("ldap.config.syncIntervalHelp")}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="appUrl">{t("ldap.config.appUrl")}</Label>
                <Input
                  id="appUrl"
                  placeholder="https://transfer.company.com"
                  {...register("appUrl")}
                />
                <p className="text-xs text-muted-foreground">{t("ldap.config.appUrlHelp")}</p>
              </div>
            </div>
          </div>

          {/* Test Result */}
          {testResult && (
            <div
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
            <Button type="button" variant="outline" onClick={onTest} disabled={isTesting}>
              {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("ldap.config.testConnection")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
