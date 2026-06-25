import { Link2Off, Lock, LockOpen } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Share } from "@/http/endpoints/shares/types";
import type { ShareLifecycleState } from "@/lib/share-lifecycle";
import { cn } from "@/lib/utils";

/**
 * Status badge for a share (active / never-expires / paused / expired /
 * max-views). Shared between the desktop table and the mobile card list.
 *
 * When the matching lifecycle handler is provided, the badge becomes a button
 * that triggers the contextual action: active → pause, manual-pause → resume,
 * expired/max-views → renew. The pencil affordance is reserved for text fields,
 * so the status itself is the click target.
 */
export function ShareStatusBadge({
  share,
  lifecycle,
  onPause,
  onResume,
  onRenew,
}: {
  share: Share;
  lifecycle: ShareLifecycleState;
  onPause?: (share: Share) => void;
  onResume?: (share: Share) => void;
  onRenew?: (share: Share) => void;
}) {
  const t = useTranslations();

  // Resolve label, color and the (optional) click action from the lifecycle.
  let label: string;
  let colorClass: string;
  let action: ((share: Share) => void) | undefined;
  let actionLabel: string | undefined;

  if (lifecycle.kind === "active") {
    label = share.expiration
      ? t("sharesTable.status.active")
      : t("sharesTable.status.neverExpires");
    colorClass = "bg-green-500/20 hover:bg-green-500/30 text-green-600 dark:text-green-400";
    action = onPause;
    actionLabel = t("sharesTable.actions.pause");
  } else if (lifecycle.reason === "manual") {
    label = t("sharesTable.status.paused");
    colorClass = "bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-400";
    action = onResume;
    actionLabel = t("sharesTable.actions.resume");
  } else {
    label =
      lifecycle.reason === "max_views"
        ? t("sharesTable.status.maxViewsReached")
        : t("sharesTable.status.expired");
    colorClass = "bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-400";
    action = onRenew;
    actionLabel = t("sharesTable.actions.renew");
  }

  if (!action) {
    return (
      <Badge variant="secondary" className={colorClass}>
        {label}
      </Badge>
    );
  }

  const handler = action;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge asChild variant="secondary" className={cn(colorClass, "cursor-pointer")}>
          <button
            type="button"
            aria-label={`${label}: ${actionLabel}`}
            onClick={(e) => {
              e.stopPropagation();
              handler(share);
            }}
          >
            {label}
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{actionLabel}</TooltipContent>
    </Tooltip>
  );
}

/**
 * "No link" badge — shown when a share has no alias yet, so it is not reachable
 * by anyone. This is orthogonal to the lifecycle state (a share can be active
 * and link-less): it signals the share simply isn't accessible until a link is
 * generated, which is distinct from being paused or expired.
 *
 * When `onGenerateLink` is provided, clicking the badge opens the share-link
 * step of the unified modal for this share.
 */
export function ShareNoLinkBadge({
  share,
  onGenerateLink,
}: {
  share: Share;
  onGenerateLink?: (share: Share) => void;
}) {
  const t = useTranslations();

  if (share.alias) return null;

  const content = (
    <>
      <Link2Off className="h-4 w-4" />
      {t("sharesTable.status.noLink")}
    </>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onGenerateLink ? (
          <Badge
            asChild
            variant="outline"
            className="flex items-center gap-1 border-dashed text-muted-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground"
          >
            <button
              type="button"
              aria-label={t("sharesTable.status.noLinkTooltip")}
              onClick={(e) => {
                e.stopPropagation();
                onGenerateLink(share);
              }}
            >
              {content}
            </button>
          </Badge>
        ) : (
          <Badge
            variant="outline"
            className="flex items-center gap-1 border-dashed text-muted-foreground"
          >
            {content}
          </Badge>
        )}
      </TooltipTrigger>
      <TooltipContent>{t("sharesTable.status.noLinkTooltip")}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Security badge for a share (password-protected / public). Shared between the
 * desktop table and the mobile card list. When `onEditSecurity` is provided the
 * badge itself opens the security settings modal (replacing the standalone
 * pencil button).
 */
export function ShareSecurityBadge({
  share,
  onEditSecurity,
}: {
  share: Share;
  onEditSecurity?: (share: Share) => void;
}) {
  const t = useTranslations();

  const isProtected = share.security.hasPassword;
  const colorClass = isProtected
    ? "bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-600 dark:text-yellow-400"
    : "bg-green-500/20 hover:bg-green-500/30 text-green-600 dark:text-green-400";
  const label = isProtected
    ? t("sharesTable.security.protected")
    : t("sharesTable.security.public");
  const icon = isProtected ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />;

  if (!onEditSecurity) {
    return (
      <Badge variant="secondary" className={cn("flex items-center gap-1", colorClass)}>
        {icon}
        {label}
      </Badge>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          asChild
          variant="secondary"
          className={cn("flex items-center gap-1 cursor-pointer", colorClass)}
        >
          <button
            type="button"
            aria-label={`${label}: ${t("shareDetails.editSecurity")}`}
            onClick={(e) => {
              e.stopPropagation();
              onEditSecurity(share);
            }}
          >
            {icon}
            {label}
          </button>
        </Badge>
      </TooltipTrigger>
      <TooltipContent>{t("shareDetails.editSecurity")}</TooltipContent>
    </Tooltip>
  );
}
