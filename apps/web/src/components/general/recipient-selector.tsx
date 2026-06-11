"use client";

import {
  Bell,
  BellRing,
  Check,
  Clock,
  Download,
  Mail,
  Plus,
  Trash2,
  User,
  Users,
  X,
} from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Loader } from "@/components/ui/loader";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSecureConfigValue } from "@/hooks/use-secure-configs";
import {
  addRecipients,
  notifyRecipients,
  remindNonDownloaders,
  removeRecipients,
} from "@/http/endpoints";
import type { ShareRecipient } from "@/http/endpoints/shares/types";

interface RecipientSelectorProps {
  shareId: string;
  selectedRecipients: ShareRecipient[];
  shareAlias?: string;
  onSuccess: () => void;
}

export function RecipientSelector({
  shareId,
  selectedRecipients,
  shareAlias,
  onSuccess,
}: RecipientSelectorProps) {
  const t = useTranslations();
  const format = useFormatter();
  const { value: smtpEnabled, isLoading: isSmtpLoading } = useSecureConfigValue("smtpEnabled");
  const [recipients, setRecipients] = useState<ShareRecipient[]>(selectedRecipients ?? []);
  const [newRecipient, setNewRecipient] = useState("");
  const [newRecipientName, setNewRecipientName] = useState("");
  const [selectedForAction, setSelectedForAction] = useState<Set<string>>(new Set());
  const [isAddingRecipient, setIsAddingRecipient] = useState(false);
  const [notifyingEmails, setNotifyingEmails] = useState<Set<string>>(new Set());
  const [isReminding, setIsReminding] = useState(false);

  useEffect(() => {
    setRecipients(selectedRecipients ?? []);
    setSelectedForAction(new Set());
  }, [selectedRecipients]);

  const isValidEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const handleAddRecipient = async () => {
    const trimmed = newRecipient.trim();
    if (!trimmed) return;

    if (!isValidEmail(trimmed)) {
      toast.error(t("recipientSelector.invalidEmail"));
      return;
    }

    if (recipients.some((r) => r.email === trimmed)) {
      toast.error(t("recipientSelector.duplicateEmail"));
      return;
    }

    setIsAddingRecipient(true);
    try {
      const trimmedName = newRecipientName.trim() || undefined;
      const res = await addRecipients(shareId, {
        recipients: [{ email: trimmed, name: trimmedName }],
      });
      setRecipients(res.data.share.recipients);
      setNewRecipient("");
      setNewRecipientName("");
      toast.success(t("recipientSelector.addSuccess"));
      onSuccess();
    } catch {
      toast.error(t("recipientSelector.addError"));
    } finally {
      setIsAddingRecipient(false);
    }
  };

  const handleRemoveRecipient = async (email: string) => {
    try {
      const res = await removeRecipients(shareId, { emails: [email] });
      setRecipients(res.data.share.recipients);
      setSelectedForAction((prev) => {
        const newSet = new Set(prev);
        newSet.delete(email);
        return newSet;
      });
      toast.success(t("recipientSelector.removeSuccess"));
      onSuccess();
    } catch {
      toast.error(t("recipientSelector.removeError"));
    }
  };

  const handleRemoveSelected = async () => {
    const emailsToRemove = Array.from(selectedForAction);
    try {
      const res = await removeRecipients(shareId, { emails: emailsToRemove });
      setRecipients(res.data.share.recipients);
      setSelectedForAction(new Set());
      toast.success(t("recipientSelector.bulkRemoveSuccess", { count: emailsToRemove.length }));
      onSuccess();
    } catch {
      toast.error(t("recipientSelector.bulkRemoveError"));
    }
  };

  /**
   * Shared notify helper used by all three call sites (selected, all, single).
   * @param emails - specific emails to notify, or undefined to notify all
   */
  const notify = async (emails: string[] | undefined) => {
    // Track which emails are in-flight to prevent double-clicks.
    // For "notify all" (emails === undefined), use all current recipient emails.
    const trackedEmails = emails ?? recipients.map((r) => r.email);
    setNotifyingEmails((prev) => {
      const next = new Set(prev);
      for (const e of trackedEmails) next.add(e);
      return next;
    });

    const loadingToast = toast.loading(t("recipientSelector.sendingNotifications"));

    try {
      const response = await notifyRecipients(shareId, { emails });
      const notified = response.data.notifiedRecipients;
      toast.dismiss(loadingToast);
      if (emails === undefined) {
        // "Notify all" — no expected count, show generic success
        toast.success(t("recipientSelector.notifySuccess"));
      } else if (emails.length === 1) {
        if (notified.length === 1) {
          toast.success(t("recipientSelector.singleNotifySuccess", { email: emails[0] }));
        } else {
          toast.warning(
            t("recipientSelector.notifyPartial", { sent: notified.length, total: emails.length }),
          );
        }
      } else {
        if (notified.length === emails.length) {
          toast.success(t("recipientSelector.bulkNotifySuccess", { count: notified.length }));
        } else {
          toast.warning(
            t("recipientSelector.notifyPartial", { sent: notified.length, total: emails.length }),
          );
        }
      }
    } catch {
      toast.dismiss(loadingToast);
      if (emails === undefined) {
        toast.error(t("recipientSelector.notifyError"));
      } else if (emails.length === 1) {
        toast.error(t("recipientSelector.singleNotifyError"));
      } else {
        toast.error(t("recipientSelector.bulkNotifyError"));
      }
    } finally {
      setNotifyingEmails((prev) => {
        const next = new Set(prev);
        for (const e of trackedEmails) next.delete(e);
        return next;
      });
    }
  };

  const handleNotifySelected = async () => {
    const emailsToNotify = Array.from(selectedForAction);
    await notify(emailsToNotify);
    setSelectedForAction(new Set());
  };

  const handleNotifyAll = async () => {
    await notify(undefined);
  };

  /**
   * Sends a download reminder to recipients who were notified but have not downloaded yet.
   * Pending semantics match the per-row "Pending" badge: notified (notifiedAt != null) AND
   * not yet downloaded (lastDownloadedAt == null). The server re-derives and enforces the
   * non-downloader filter; this count only gates the button.
   */
  const handleRemindNonDownloaders = async () => {
    setIsReminding(true);
    const loadingToast = toast.loading(t("recipientSelector.sendingReminders"));
    try {
      const response = await remindNonDownloaders(shareId, {});
      const reminded = response.data.remindedRecipients;
      toast.dismiss(loadingToast);
      if (reminded.length > 0) {
        toast.success(t("recipientSelector.remindSuccess", { count: reminded.length }));
      } else {
        toast.info(t("recipientSelector.remindNoneSent"));
      }
      onSuccess();
    } catch {
      toast.dismiss(loadingToast);
      toast.error(t("recipientSelector.remindError"));
    } finally {
      setIsReminding(false);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedForAction(new Set(recipients.map((r) => r.email)));
    } else {
      setSelectedForAction(new Set());
    }
  };

  const handleSelectRecipient = (email: string, checked: boolean) => {
    const newSelected = new Set(selectedForAction);
    if (checked) {
      newSelected.add(email);
    } else {
      newSelected.delete(email);
    }
    setSelectedForAction(newSelected);
  };

  const isAllSelected = recipients.length > 0 && selectedForAction.size === recipients.length;
  const hasSelection = selectedForAction.size > 0;
  const isNotifying = notifyingEmails.size > 0;
  // Pending = notified but not yet downloaded — same signal as the per-row "Pending" badge.
  // This is the set the reminder targets.
  const pendingCount = recipients.filter(
    (r) => r.notifiedAt != null && r.lastDownloadedAt == null,
  ).length;
  // SMTP controls: show as disabled while loading, show normally when enabled, hide when disabled
  const smtpReady = smtpEnabled === "true";
  const showSmtpControls = isSmtpLoading || smtpReady;

  return (
    <div className="space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Plus className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-medium">{t("recipientSelector.addRecipient")}</h3>
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Mail className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              className="ps-9 h-10"
              placeholder={t("recipientSelector.emailPlaceholder")}
              value={newRecipient}
              onChange={(e) => setNewRecipient(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isAddingRecipient && handleAddRecipient()}
              disabled={isAddingRecipient}
            />
          </div>
          <div className="relative sm:w-40">
            <User className="absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              className="ps-9 h-10"
              placeholder={t("recipientSelector.namePlaceholder")}
              value={newRecipientName}
              onChange={(e) => setNewRecipientName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !isAddingRecipient && handleAddRecipient()}
              disabled={isAddingRecipient}
            />
          </div>
          <Button
            onClick={handleAddRecipient}
            disabled={!newRecipient.trim() || isAddingRecipient}
            className="h-10 px-6 sm:w-auto w-full"
          >
            {isAddingRecipient ? (
              <div className="flex items-center gap-2">
                <Spinner size="sm" className="border-background border-t-transparent" />
                {t("common.loading")}
              </div>
            ) : (
              <>
                <Plus className="h-4 w-4" />
                {t("recipientSelector.add")}
              </>
            )}
          </Button>
        </div>
      </div>

      <Separator />

      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <h3 className="text-lg font-medium">
              {t("recipientSelector.recipients", { count: recipients.length })}
            </h3>
          </div>

          {recipients.length > 0 && shareAlias && showSmtpControls && (
            <div className="flex flex-col sm:flex-row gap-2 sm:w-auto w-full">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleRemindNonDownloaders}
                    disabled={!smtpReady || isReminding || pendingCount === 0}
                    className="sm:w-auto w-full"
                  >
                    {isReminding ? <Loader size="sm" /> : <BellRing className="h-4 w-4" />}
                    {t("recipientSelector.remindNonDownloaders", { count: pendingCount })}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {t("recipientSelector.remindNonDownloadersHint", { count: pendingCount })}
                </TooltipContent>
              </Tooltip>
              <Button
                variant="outline"
                size="sm"
                onClick={handleNotifyAll}
                disabled={!smtpReady || isNotifying}
                className="sm:w-auto w-full"
              >
                {isNotifying ? <Loader size="sm" /> : <Bell className="h-4 w-4" />}
                {t("recipientSelector.notifyAll")}
              </Button>
            </div>
          )}
        </div>

        {hasSelection && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 bg-accent border border-border rounded-lg">
            <div className="flex items-center gap-2">
              <Check className="h-4 w-4 text-accent-foreground" />
              <span className="text-sm font-medium text-accent-foreground">
                {t("recipientSelector.selectedCount", { count: selectedForAction.size })}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              {showSmtpControls && shareAlias && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNotifySelected}
                  disabled={!smtpReady || isNotifying}
                  className="sm:w-auto w-full"
                >
                  {isNotifying ? <Loader size="sm" /> : <Bell className="h-4 w-4" />}
                  {t("recipientSelector.notifySelected")}
                </Button>
              )}
              <Button
                variant="destructive"
                size="sm"
                onClick={handleRemoveSelected}
                className="sm:w-auto w-full"
              >
                <Trash2 className="h-4 w-4" />
                {t("recipientSelector.removeSelected")}
              </Button>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedForAction(new Set())}
                    className="h-8 w-8 p-0 self-center"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("common.cancel")}</TooltipContent>
              </Tooltip>
            </div>
          </div>
        )}

        <div className="border rounded-lg overflow-hidden">
          {recipients.length === 0 ? (
            <div className="text-center py-12 px-6">
              <div className="mx-auto w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-muted-foreground" />
              </div>
              <h4 className="text-lg font-medium mb-2">{t("recipientSelector.noRecipients")}</h4>
              <p className="text-sm text-muted-foreground mb-4">
                {t("recipientSelector.noRecipientsDescription")}
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 p-4 border-b bg-muted/30">
                <Checkbox
                  checked={isAllSelected}
                  onCheckedChange={handleSelectAll}
                  aria-label={t("recipientSelector.selectAll")}
                />
                <span className="text-sm font-medium text-muted-foreground">
                  {t("recipientSelector.selectAll")}
                </span>
              </div>

              <div className="divide-y max-h-80 overflow-y-auto">
                {recipients.map((recipient) => {
                  const { email, name, notifiedAt, accessCount, lastDownloadedAt } = recipient;
                  const isSelected = selectedForAction.has(email);
                  // Download-status badge keys off lastDownloadedAt (R-6): a non-null
                  // timestamp means at least one file was fetched. "Pending" is only shown
                  // once the recipient has been notified — an un-notified recipient has no
                  // expectation to download yet.
                  const hasDownloaded = lastDownloadedAt != null;
                  const isPending = !hasDownloaded && notifiedAt != null;
                  return (
                    <div
                      key={recipient.id}
                      className={`flex items-center gap-3 p-4 hover:bg-muted/50 transition-colors ${
                        isSelected ? "bg-accent/50" : ""
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) =>
                          handleSelectRecipient(email, checked as boolean)
                        }
                        aria-label={t("recipientSelector.selectRecipient", { email })}
                      />

                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div className="w-8 h-8 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                          <Mail className="h-4 w-4 text-primary" />
                        </div>
                        <div className="flex flex-col min-w-0">
                          {name && <span className="truncate font-medium">{name}</span>}
                          <span
                            className={`truncate ${name ? "text-xs text-muted-foreground" : "font-medium"}`}
                          >
                            {email}
                          </span>
                          <div className="flex flex-wrap items-center gap-2 mt-0.5">
                            {/* Primary download-status badge (R-6): keyed off lastDownloadedAt */}
                            {hasDownloaded ? (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    role="img"
                                    className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                    aria-label={t("recipientSelector.downloadedAt", {
                                      date: format.dateTime(new Date(lastDownloadedAt), {
                                        dateStyle: "medium",
                                        timeStyle: "short",
                                      }),
                                    })}
                                  >
                                    <Download className="h-3 w-3" aria-hidden="true" />
                                    {t("recipientSelector.downloaded")}
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent>
                                  {t("recipientSelector.downloadedAt", {
                                    date: format.dateTime(new Date(lastDownloadedAt), {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    }),
                                  })}
                                </TooltipContent>
                              </Tooltip>
                            ) : isPending ? (
                              <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                {t("recipientSelector.pending")}
                              </span>
                            ) : null}
                            {/* Secondary signals — access ≠ download, kept distinct */}
                            {notifiedAt && (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                <Check className="h-3 w-3" aria-hidden="true" />
                                {t("recipientSelector.notified")}
                              </span>
                            )}
                            {accessCount > 0 ? (
                              <span className="text-xs text-muted-foreground">
                                {t("recipientSelector.views", { count: accessCount })}
                              </span>
                            ) : (
                              notifiedAt && (
                                <span className="text-xs text-muted-foreground">
                                  {t("recipientSelector.neverAccessed")}
                                </span>
                              )
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {showSmtpControls && shareAlias && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-primary hover:text-primary hover:bg-primary/10"
                                onClick={() => notify([email])}
                                disabled={!smtpReady || notifyingEmails.has(email)}
                              >
                                {notifyingEmails.has(email) ? (
                                  <Loader size="sm" />
                                ) : (
                                  <Bell className="h-4 w-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>{t("recipientSelector.notifySingle")}</TooltipContent>
                          </Tooltip>
                        )}

                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => handleRemoveRecipient(email)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{t("recipientSelector.removeSingle")}</TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
