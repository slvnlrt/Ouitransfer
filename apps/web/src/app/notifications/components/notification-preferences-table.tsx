"use client";

import type { NotificationType } from "@ouitransfer/shared/notification-types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, LayoutDashboard, Loader2 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "@/http/endpoints/notifications";
import type { NotificationPreference } from "@/http/endpoints/notifications/types";
import { queryKeys } from "@/lib/query-keys";
import { parseApiError } from "@/utils/api-error";

// Maps notification types to their display category
const TYPE_TO_CATEGORY: Record<NotificationType, string> = {
  password_reset: "account",
  welcome: "account",
  account_deactivated: "account",
  account_reactivated: "account",
  share_invitation: "shares",
  share_accessed: "shares",
  share_downloaded: "shares",
  share_expiring: "shares",
  share_expired: "shares",
  share_max_views_reached: "shares",
  share_no_activity: "shares",
  reverse_share_invitation: "reverseShares",
  reverse_share_uploaded: "reverseShares",
  reverse_share_expiring: "reverseShares",
  reverse_share_expired: "reverseShares",
  quota_warning: "quota",
  quota_exceeded: "quota",
  files_auto_deleted: "quota",
  share_auto_deleted: "quota",
  admin_user_registered: "admin",
  admin_quota_alert: "admin",
  test_email: "test",
};

// Order in which categories appear
const CATEGORY_ORDER = ["account", "shares", "reverseShares", "quota", "admin", "test"];

function groupByCategory(
  preferences: NotificationPreference[],
): Map<string, NotificationPreference[]> {
  const map = new Map<string, NotificationPreference[]>();

  for (const category of CATEGORY_ORDER) {
    map.set(category, []);
  }

  for (const pref of preferences) {
    const category = TYPE_TO_CATEGORY[pref.type] ?? "account";
    const existing = map.get(category);
    if (existing) {
      existing.push(pref);
    } else {
      map.set(category, [pref]);
    }
  }

  // Remove empty categories
  for (const [key, value] of map.entries()) {
    if (value.length === 0) {
      map.delete(key);
    }
  }

  return map;
}

export function NotificationPreferencesTable() {
  const t = useTranslations("notificationPreferences");
  const tNav = useTranslations("navigation");
  const tCommon = useTranslations("common");
  const queryClient = useQueryClient();

  // Local state: track user-modified frequencies (type -> frequency)
  const [localChanges, setLocalChanges] = useState<Partial<Record<NotificationType, string>>>({});
  const hasUnsavedChanges = Object.keys(localChanges).length > 0;

  // Warn about unsaved changes when navigating away
  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: queryKeys.notifications.preferences(),
    queryFn: async () => {
      const response = await getNotificationPreferences();
      return response.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (changes: Partial<Record<NotificationType, string>>) => {
      const preferences = Object.entries(changes).map(([type, frequency]) => ({
        type: type as NotificationType,
        frequency: frequency as string,
      }));
      await updateNotificationPreferences({ preferences });
    },
    onSuccess: () => {
      toast.success(t("saveSuccess"));
      setLocalChanges({});
      queryClient.invalidateQueries({ queryKey: queryKeys.notifications.preferences() });
    },
    onError: (error: unknown) => {
      const apiError = parseApiError(error);
      toast.error(`${t("saveError")}: ${apiError.message}`);
    },
  });

  const handleFrequencyChange = (type: NotificationType, frequency: string) => {
    setLocalChanges((prev) => ({ ...prev, [type]: frequency }));
  };

  const handleSave = () => {
    if (Object.keys(localChanges).length === 0) {
      toast.info(t("noChanges"));
      return;
    }
    saveMutation.mutate(localChanges);
  };

  // Filter out non-configurable (critical) types — spec says they are not shown in preferences
  const preferences = (data?.preferences ?? []).filter((pref) => !pref.isCritical);
  const grouped = groupByCategory(preferences);

  const getFrequency = (pref: NotificationPreference): string => {
    return localChanges[pref.type] ?? pref.frequency;
  };

  return (
    <div className="flex flex-col gap-8">
      {/* Page header */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-row items-center gap-2">
          <Bell className="size-5" />
          <h1 className="text-2xl font-bold">{t("pageTitle")}</h1>
        </div>
        <Separator />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/dashboard" className="flex items-center">
                  <LayoutDashboard className="size-5 me-1" />
                  {tNav("dashboard")}
                </Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <span className="flex items-center gap-1">
                <Bell className="size-5" /> {t("pageTitle")}
              </span>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      {/* Preferences card */}
      <Card>
        <CardHeader>
          <CardTitle>{t("pageTitle")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          {isLoading ? (
            <div className="text-muted-foreground text-sm py-8 text-center">
              {tCommon("loadingSimple")}
            </div>
          ) : data === undefined && error ? (
            <div className="text-center py-8 space-y-3">
              <p className="text-sm text-destructive">{t("loadError")}</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                {t("retry")}
              </Button>
            </div>
          ) : (
            <>
              {Array.from(grouped.entries()).map(([category, prefs]) => (
                <div key={category} className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    {t(`categories.${category}`)}
                  </h3>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-1/2">{t("type")}</TableHead>
                          <TableHead>{t("frequency")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {prefs.map((pref) => {
                          const isChanged = localChanges[pref.type] !== undefined;
                          return (
                            <TableRow key={pref.type} className={isChanged ? "bg-accent/30" : ""}>
                              <TableCell className="font-medium">
                                {t(`types.${pref.type}` as Parameters<typeof t>[0])}
                              </TableCell>
                              <TableCell>
                                <Select
                                  value={getFrequency(pref)}
                                  onValueChange={(value) => handleFrequencyChange(pref.type, value)}
                                >
                                  <SelectTrigger className="w-40">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="immediate">{t("immediate")}</SelectItem>
                                    <SelectItem value="disabled">{t("disabled")}</SelectItem>
                                  </SelectContent>
                                </Select>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-end gap-3 pt-2">
                {hasUnsavedChanges && (
                  <span className="text-xs text-muted-foreground">
                    {t("unsavedChanges", { count: Object.keys(localChanges).length })}
                  </span>
                )}
                <Button
                  onClick={handleSave}
                  disabled={saveMutation.isPending || !hasUnsavedChanges}
                >
                  {saveMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("saving")}
                    </>
                  ) : (
                    t("save")
                  )}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
