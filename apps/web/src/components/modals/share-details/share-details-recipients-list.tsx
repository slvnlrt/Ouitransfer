"use client";

import { Check, Clock, Download, Eye, Mail, Pencil } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import type { Share, ShareRecipient } from "@/http/endpoints/shares/types";

interface ShareDetailsRecipientsListProps {
  recipients: ShareRecipient[];
  onManageRecipients?: (share: Share) => void;
  share: Share;
}

export function ShareDetailsRecipientsList({
  recipients,
  onManageRecipients,
  share,
}: ShareDetailsRecipientsListProps) {
  const t = useTranslations();
  const format = useFormatter();

  // Nothing to show and no way to edit (non-owner with no recipients): render nothing,
  // matching the previous inline behavior. Owners always get the section (with a manage
  // affordance) so they can add the first recipient.
  if (recipients.length === 0 && !onManageRecipients) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 border-b pb-2">
        <h3 className="text-base font-medium text-foreground">{t("shareDetails.recipients")}</h3>
        {onManageRecipients && (
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 text-muted-foreground hover:text-foreground"
            onClick={() => onManageRecipients(share)}
            title={t("sharesTable.actions.manageRecipients")}
          >
            <Pencil className="h-3 w-3" />
          </Button>
        )}
      </div>
      {recipients.length === 0 ? (
        <p className="text-sm text-muted-foreground py-2">{t("recipientSelector.noRecipients")}</p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {recipients.map((recipient: ShareRecipient) => {
            const { lastDownloadedAt, notifiedAt, accessCount, lastAccessedAt } = recipient;
            const hasDownloaded = lastDownloadedAt != null;
            const isPending = !hasDownloaded && notifiedAt != null;
            return (
              <div
                key={recipient.id}
                className="flex items-center gap-3 p-2 rounded-md border bg-muted/20"
              >
                <div className="w-7 h-7 bg-primary/10 rounded-full flex items-center justify-center flex-shrink-0">
                  <Mail className="h-3.5 w-3.5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  {recipient.name && (
                    <p className="text-sm font-medium truncate">{recipient.name}</p>
                  )}
                  <p
                    className={`text-sm truncate ${recipient.name ? "text-muted-foreground text-xs" : "font-medium"}`}
                  >
                    {recipient.email}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    {/* Download-status badge — consistent with the recipient
                        selector (8.3, R-6): keyed off lastDownloadedAt. */}
                    {hasDownloaded ? (
                      <span
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400"
                        title={t("recipientSelector.downloadedAt", {
                          date: format.dateTime(new Date(lastDownloadedAt), {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }),
                        })}
                      >
                        <Download className="h-3 w-3" aria-hidden="true" />
                        {t("recipientSelector.downloaded")}
                      </span>
                    ) : isPending ? (
                      <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                        <Clock className="h-3 w-3" aria-hidden="true" />
                        {t("recipientSelector.pending")}
                      </span>
                    ) : null}
                    {notifiedAt && (
                      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
                        <Check className="h-3 w-3" aria-hidden="true" />
                        {t("shareDetails.recipientNotified")}
                      </span>
                    )}
                    {accessCount > 0 && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Eye className="h-3 w-3" />
                        {lastAccessedAt
                          ? t("shareDetails.recipientAccessWithLast", {
                              count: accessCount,
                              lastAccess: format.relativeTime(new Date(lastAccessedAt)),
                            })
                          : t("shareDetails.recipientAccess", {
                              count: accessCount,
                            })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
