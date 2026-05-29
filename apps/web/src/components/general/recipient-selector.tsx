"use client";

import { Bell, Check, Mail, Plus, Trash2, Users, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { useSecureConfigValue } from "@/hooks/use-secure-configs";
import { addRecipients, notifyRecipients, removeRecipients } from "@/http/endpoints";
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
  const { value: smtpEnabled } = useSecureConfigValue("smtpEnabled");
  const [recipients, setRecipients] = useState<ShareRecipient[]>(selectedRecipients ?? []);
  const [newRecipient, setNewRecipient] = useState("");
  const [selectedForAction, setSelectedForAction] = useState<Set<string>>(new Set());
  const [isAddingRecipient, setIsAddingRecipient] = useState(false);

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
      const res = await addRecipients(shareId, { emails: [trimmed] });
      setRecipients(res.data.share.recipients);
      setNewRecipient("");
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

          {recipients.length > 0 && shareAlias && smtpEnabled === "true" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleNotifyAll}
              className="sm:w-auto w-full"
            >
              <Bell className="h-4 w-4" />
              {t("recipientSelector.notifyAll")}
            </Button>
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
              {smtpEnabled === "true" && shareAlias && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleNotifySelected}
                  className="sm:w-auto w-full"
                >
                  <Bell className="h-4 w-4" />
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
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedForAction(new Set())}
                className="h-8 w-8 p-0 self-center"
                title={t("common.cancel")}
              >
                <X className="h-4 w-4" />
              </Button>
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
                  const { email, notifiedAt, accessCount } = recipient;
                  const isSelected = selectedForAction.has(email);
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
                          <span className="truncate font-medium">{email}</span>
                          <div className="flex items-center gap-2 mt-0.5">
                            {notifiedAt && (
                              <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                                <Check className="h-3 w-3" />
                                {t("recipientSelector.notified")}
                              </span>
                            )}
                            {accessCount > 0 && (
                              <span className="text-xs text-muted-foreground">
                                {t("recipientSelector.views", { count: accessCount })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        {smtpEnabled === "true" && shareAlias && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-primary hover:text-primary hover:bg-primary/10"
                            onClick={() => notify([email])}
                            title={t("recipientSelector.notifySingle")}
                          >
                            <Bell className="h-4 w-4" />
                          </Button>
                        )}

                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleRemoveRecipient(email)}
                          title={t("recipientSelector.removeSingle")}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
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
