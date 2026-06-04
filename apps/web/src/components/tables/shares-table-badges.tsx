import { Lock, LockOpen } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import type { Share } from "@/http/endpoints/shares/types";
import type { ShareLifecycleState } from "@/lib/share-lifecycle";

/**
 * Status badge for a share (active / never-expires / paused / expired /
 * max-views). Shared between the desktop table and the mobile card list.
 */
export function ShareStatusBadge({
  share,
  lifecycle,
}: {
  share: Share;
  lifecycle: ShareLifecycleState;
}) {
  const t = useTranslations();

  if (lifecycle.kind === "active") {
    return (
      <Badge
        variant="secondary"
        className="bg-green-500/20 hover:bg-green-500/30 text-green-600 dark:text-green-400"
      >
        {share.expiration ? t("sharesTable.status.active") : t("sharesTable.status.neverExpires")}
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={
        lifecycle.reason === "manual"
          ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 dark:text-amber-400"
          : "bg-red-500/20 hover:bg-red-500/30 text-red-600 dark:text-red-400"
      }
    >
      {lifecycle.reason === "manual"
        ? t("sharesTable.status.paused")
        : lifecycle.reason === "max_views"
          ? t("sharesTable.status.maxViewsReached")
          : t("sharesTable.status.expired")}
    </Badge>
  );
}

/**
 * Security badge for a share (password-protected / public). Shared between the
 * desktop table and the mobile card list.
 */
export function ShareSecurityBadge({ share }: { share: Share }) {
  const t = useTranslations();

  return (
    <Badge
      variant="secondary"
      className={`flex items-center gap-1 ${
        share.security.hasPassword
          ? "bg-yellow-500/20 hover:bg-yellow-500/30 text-yellow-600 dark:text-yellow-400"
          : "bg-green-500/20 hover:bg-green-500/30 text-green-600 dark:text-green-400"
      }`}
    >
      {share.security.hasPassword ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
      {share.security.hasPassword
        ? t("sharesTable.security.protected")
        : t("sharesTable.security.public")}
    </Badge>
  );
}
