"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, Loader, Mail, Send } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getEmailStats, sendTestEmail } from "@/http/endpoints/notifications";
import { queryKeys } from "@/lib/query-keys";

export function EmailAdminSection() {
  const t = useTranslations();
  const [testEmail, setTestEmail] = useState("");

  const emailStatsQuery = useQuery({
    queryKey: queryKeys.admin.emailStats(),
    queryFn: async () => {
      const res = await getEmailStats();
      return res.data;
    },
    refetchInterval: 30000,
  });

  const stats = emailStatsQuery.data;

  const testEmailMutation = useMutation({
    mutationFn: () => sendTestEmail(testEmail.trim()),
    onSuccess: () => {
      toast.success(t("settings.emailAdmin.testSuccess"));
      setTestEmail("");
    },
    onError: () => {
      toast.error(t("settings.emailAdmin.testError"));
    },
  });

  const handleSendTest = () => {
    if (!testEmail.trim()) return;
    testEmailMutation.mutate();
  };

  return (
    <div className="mt-6 space-y-6">
      {/* Queue Status Card */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("settings.emailAdmin.queueStatus")}</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="flex flex-col items-center justify-center rounded-md border bg-muted/30 p-3 text-center">
            <span className="text-2xl font-bold tabular-nums">
              {emailStatsQuery.isError ? (
                <span className="text-xs text-destructive">{t("common.unavailable")}</span>
              ) : emailStatsQuery.isLoading ? (
                <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                (stats?.pending ?? 0)
              )}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {t("settings.emailAdmin.pending")}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center rounded-md border bg-muted/30 p-3 text-center">
            <span className="text-2xl font-bold tabular-nums text-green-600 dark:text-green-400">
              {emailStatsQuery.isError ? (
                <span className="text-xs text-destructive">{t("common.unavailable")}</span>
              ) : emailStatsQuery.isLoading ? (
                <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                (stats?.sentLast24h ?? 0)
              )}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {t("settings.emailAdmin.sentLast24h")}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center rounded-md border bg-muted/30 p-3 text-center">
            <span className="text-2xl font-bold tabular-nums text-destructive">
              {emailStatsQuery.isError ? (
                <span className="text-xs text-destructive">{t("common.unavailable")}</span>
              ) : emailStatsQuery.isLoading ? (
                <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                (stats?.failed ?? 0)
              )}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {t("settings.emailAdmin.failed")}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center rounded-md border bg-muted/30 p-3 text-center">
            <span className="text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              {emailStatsQuery.isError ? (
                <span className="text-xs text-destructive">{t("common.unavailable")}</span>
              ) : emailStatsQuery.isLoading ? (
                <Loader className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                (stats?.digestPending ?? 0)
              )}
            </span>
            <span className="mt-1 text-xs text-muted-foreground">
              {t("settings.emailAdmin.digestQueue")}
            </span>
          </div>
        </div>
      </div>

      {/* Send Test Email */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Mail className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">{t("settings.emailAdmin.sendTest")}</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <Input
            type="email"
            placeholder={t("settings.emailAdmin.testPlaceholder")}
            value={testEmail}
            onChange={(e) => setTestEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !testEmailMutation.isPending && handleSendTest()}
            disabled={testEmailMutation.isPending}
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            onClick={handleSendTest}
            disabled={!testEmail.trim() || testEmailMutation.isPending}
            className="sm:w-auto w-full"
          >
            {testEmailMutation.isPending ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                {t("settings.emailAdmin.testSending")}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {t("settings.emailAdmin.sendTest")}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
