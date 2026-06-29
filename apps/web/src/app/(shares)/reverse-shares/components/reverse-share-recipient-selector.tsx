"use client";

import { Bell, Check, Clock, Mail, Plus, Trash2, Upload, Users, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
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
  addReverseShareRecipients,
  notifyReverseShareRecipients,
  removeReverseShareRecipients,
} from "@/http/endpoints/reverse-shares";
import type { ReverseShareRecipient } from "@/http/endpoints/reverse-shares/types";
import { formatDateTime } from "@/lib/format-date-time";
import { logger } from "@/lib/logger";
import { isValidEmail } from "@/utils/email";

interface ReverseShareRecipientSelectorProps {
  reverseShareId: string;
  selectedRecipients: ReverseShareRecipient[];
  reverseShareAlias?: string;
  /**
   * The reverse share's email-field requirement. When it is not "REQUIRED",
   * per-recipient upload tracking is best-effort (uploaders may upload without
   * declaring an email), so "Pending" is shown with an "approximate" hint.
   */
  emailFieldRequired?: string;
  onSuccess: () => void;
}

export function ReverseShareRecipientSelector({
  reverseShareId,
  selectedRecipients,
  reverseShareAlias,
  emailFieldRequired,
  onSuccess,
}: ReverseShareRecipientSelectorProps) {
  const t = useTranslations();
  const locale = useLocale();
  // R-5: upload attribution is best-effort unless an uploader email is required.
  const isUploadApproximate = emailFieldRequired !== "REQUIRED";
  const { value: smtpEnabled, isLoading: isSmtpLoading } = useSecureConfigValue("smtpEnabled");
  const [recipients, setRecipients] = useState<ReverseShareRecipient[]>(selectedRecipients ?? []);
  const [newRecipient, setNewRecipient] = useState("");
  const [newRecipientName, setNewRecipientName] = useState("");
  const [selectedForAction, setSelectedForAction] = useState<Set<string>>(new Set());
  const [isAddingRecipient, setIsAddingRecipient] = useState(false);
  const [notifyingEmails, setNotifyingEmails] = useState<Set<string>>(new Set());

  useEffect(() => {
    setRecipients(selectedRecipients ?? []);
    setSelectedForAction(new Set());
  }, [selectedRecipients]);

  const handleAddRecipient = async () => {
    const trimmed = newRecipient.trim();
    if (!trimmed) return;

    if (!isValidEmail(trimmed)) {
      toast.error(t("recipientSelector.invalidEmail"));
      return;
    }

    if (recipients.some((r) => r.email === trimmed.toLowerCase())) {
      toast.error(t("recipientSelector.duplicateEmail"));
      return;
    }

    setIsAddingRecipient(true);
    try {
      await addReverseShareRecipients(reverseShareId, {
        recipients: [{ email: trimmed, name: newRecipientName.trim() || undefined }],
      });
      setNewRecipient("");
      setNewRecipientName("");
      toast.success(t("recipientSelector.addSuccess"));
      onSuccess();
    } catch (error) {
      logger.error("Failed to add recipient:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("recipientSelector.addError"));
    } finally {
      setIsAddingRecipient(false);
    }
  };

  const handleRemoveRecipient = async (email: string) => {
    try {
      await removeReverseShareRecipients(reverseShareId, { emails: [email] });
      toast.success(t("recipientSelector.removeSuccess"));
      onSuccess();
    } catch (error) {
      logger.error("Failed to remove recipient:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("recipientSelector.removeError"));
    }
  };

  const handleNotify = async (emails?: string[]) => {
    const notifySet = new Set(emails ?? recipients.map((r) => r.email));
    setNotifyingEmails(notifySet);
    try {
      const response = await notifyReverseShareRecipients(reverseShareId, {
        emails: emails ?? undefined,
      });
      const count = response.data.notifiedRecipients.length;
      const total = emails?.length ?? recipients.length;
      if (count === total) {
        toast.success(
          emails?.length === 1
            ? t("recipientSelector.singleNotifySuccess", { email: emails[0] })
            : t("recipientSelector.bulkNotifySuccess", { count }),
        );
      } else {
        toast.warning(t("recipientSelector.notifyPartial", { sent: count, total }));
      }
      onSuccess();
    } catch (error) {
      logger.error("Failed to notify recipients:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("recipientSelector.notifyError"));
    } finally {
      setNotifyingEmails(new Set());
    }
  };

  const handleBulkRemove = async () => {
    const emailsToRemove = recipients
      .filter((r) => selectedForAction.has(r.email))
      .map((r) => r.email);
    if (emailsToRemove.length === 0) return;
    try {
      await removeReverseShareRecipients(reverseShareId, { emails: emailsToRemove });
      toast.success(t("recipientSelector.bulkRemoveSuccess", { count: emailsToRemove.length }));
      setSelectedForAction(new Set());
      onSuccess();
    } catch (error) {
      logger.error("Failed to bulk remove recipients:", {
        err: error instanceof Error ? error.message : String(error),
      });
      toast.error(t("recipientSelector.bulkRemoveError"));
    }
  };

  const handleBulkNotify = async () => {
    const emailsToNotify = recipients
      .filter((r) => selectedForAction.has(r.email))
      .map((r) => r.email);
    if (emailsToNotify.length === 0) return;
    await handleNotify(emailsToNotify);
    setSelectedForAction(new Set());
  };

  const toggleSelectAll = () => {
    if (selectedForAction.size === recipients.length) {
      setSelectedForAction(new Set());
    } else {
      setSelectedForAction(new Set(recipients.map((r) => r.email)));
    }
  };

  const toggleRecipient = (email: string) => {
    setSelectedForAction((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  };

  const isSmtp = smtpEnabled === "true";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-base font-medium text-foreground">
          {t("recipientSelector.recipients", { count: recipients.length })}
        </h3>
      </div>

      {/* Add recipient form */}
      <div className="flex gap-2">
        <div className="flex-1 flex gap-2">
          <Input
            value={newRecipient}
            onChange={(e) => setNewRecipient(e.target.value)}
            placeholder={t("recipientSelector.emailPlaceholder")}
            className="h-8 text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleAddRecipient()}
            type="email"
          />
          <Input
            value={newRecipientName}
            onChange={(e) => setNewRecipientName(e.target.value)}
            placeholder={t("recipientSelector.namePlaceholder")}
            className="h-8 text-sm w-36"
            onKeyDown={(e) => e.key === "Enter" && handleAddRecipient()}
          />
        </div>
        <Button
          size="sm"
          className="h-8"
          onClick={handleAddRecipient}
          disabled={isAddingRecipient || !newRecipient.trim()}
        >
          {isAddingRecipient ? <Spinner className="h-3 w-3" /> : <Plus className="h-3 w-3 me-1" />}
          {t("recipientSelector.add")}
        </Button>
      </div>

      {/* Recipient list */}
      {recipients.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">{t("recipientSelector.noRecipients")}</p>
      ) : (
        <>
          {/* Bulk actions */}
          <div className="flex items-center gap-2 text-xs">
            <Checkbox
              checked={selectedForAction.size === recipients.length && recipients.length > 0}
              onCheckedChange={toggleSelectAll}
              aria-label={t("recipientSelector.selectAll")}
            />
            <span className="text-muted-foreground">{t("recipientSelector.selectAll")}</span>
            {selectedForAction.size > 0 && (
              <>
                <span className="text-muted-foreground">
                  ({t("recipientSelector.selectedCount", { count: selectedForAction.size })})
                </span>
                <Separator orientation="vertical" className="h-4" />
                {isSmtp && reverseShareAlias && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs"
                    onClick={handleBulkNotify}
                    disabled={notifyingEmails.size > 0}
                  >
                    <Bell className="h-3 w-3 me-1" />
                    {t("recipientSelector.notifySelected")}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs text-destructive hover:text-destructive"
                  onClick={handleBulkRemove}
                >
                  <Trash2 className="h-3 w-3 me-1" />
                  {t("recipientSelector.removeSelected")}
                </Button>
              </>
            )}
          </div>

          {/* Recipient rows */}
          <div className="space-y-1 max-h-48 overflow-y-auto">
            {recipients.map((recipient) => (
              <div
                key={recipient.email}
                className="flex items-center gap-2 py-1 px-1 rounded hover:bg-muted/30 group"
              >
                <Checkbox
                  checked={selectedForAction.has(recipient.email)}
                  onCheckedChange={() => toggleRecipient(recipient.email)}
                  aria-label={t("recipientSelector.selectRecipient", { email: recipient.email })}
                />
                <Mail className="h-3 w-3 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm truncate">{recipient.email}</span>
                    {recipient.name && (
                      <span className="text-xs text-muted-foreground truncate">
                        ({recipient.name})
                      </span>
                    )}
                    {/* Primary upload-status badge (8.3 lot D, best-effort):
                        keyed off uploadedAt. "Pending" is only shown once the
                        recipient is notified — they have no expectation to
                        upload before being invited. */}
                    {(() => {
                      const hasUploaded = recipient.uploadedAt != null;
                      const isPending = !hasUploaded && recipient.notifiedAt != null;
                      const approximateHint = isUploadApproximate
                        ? ` — ${t("recipientSelector.uploadApproximateHint")}`
                        : "";
                      if (hasUploaded) {
                        const uploadedTooltip =
                          t("recipientSelector.uploadedAt", {
                            date: formatDateTime(recipient.uploadedAt as string, "table", locale),
                          }) + approximateHint;
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                role="img"
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                                aria-label={uploadedTooltip}
                              >
                                <Upload className="h-2.5 w-2.5" aria-hidden="true" />
                                {t("recipientSelector.uploaded")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{uploadedTooltip}</TooltipContent>
                          </Tooltip>
                        );
                      }
                      if (isPending) {
                        return isUploadApproximate ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span
                                role="img"
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground"
                                aria-label={t("recipientSelector.uploadApproximateHint")}
                              >
                                <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                                {t("recipientSelector.pending")}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              {t("recipientSelector.uploadApproximateHint")}
                            </TooltipContent>
                          </Tooltip>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                            <Clock className="h-2.5 w-2.5" aria-hidden="true" />
                            {t("recipientSelector.pending")}
                          </span>
                        );
                      }
                      return null;
                    })()}
                    {recipient.notifiedAt && (
                      <span className="text-xs text-green-600 dark:text-green-400 flex items-center gap-0.5">
                        <Check className="h-2.5 w-2.5" />
                        {t("recipientSelector.notified")}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {isSmtp && reverseShareAlias && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => handleNotify([recipient.email])}
                          disabled={notifyingEmails.has(recipient.email)}
                        >
                          {notifyingEmails.has(recipient.email) ? (
                            <Spinner className="h-3 w-3" />
                          ) : (
                            <Bell className="h-3 w-3" />
                          )}
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{t("recipientSelector.notifySingle")}</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => handleRemoveRecipient(recipient.email)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("recipientSelector.removeSingle")}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>

          {/* Notify all button */}
          {isSmtp && reverseShareAlias && recipients.length > 0 && (
            <>
              <Separator />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => handleNotify()}
                  disabled={notifyingEmails.size > 0}
                >
                  {notifyingEmails.size > 0 ? (
                    <Spinner className="h-3 w-3 me-1" />
                  ) : (
                    <Bell className="h-3 w-3 me-1" />
                  )}
                  {t("recipientSelector.notifyAll")}
                </Button>
              </div>
            </>
          )}
        </>
      )}

      {isSmtpLoading && <Loader className="h-4 w-4" />}
    </div>
  );
}
