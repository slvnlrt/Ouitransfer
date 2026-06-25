import type { Share } from "@/http/endpoints/shares/types";

/**
 * Derived lifecycle display state for an owner's share (Phase A.1).
 *
 * The server persists deactivation explicitly (`isActive=false` + a reason), but
 * a share can also lapse between scheduler sweeps — it is still `isActive=true`
 * yet its `expiration` has passed or its `maxViews` was reached. The owner UI
 * mirrors the server's defensive read-time gate so a lapsed share is shown as
 * deactivated immediately, not "active", even before the sweep persists it.
 *
 * Reasons and the affordance each one gets:
 * - `manual`     → paused by the owner → **Resume** (re-activates instantly).
 * - `expired`    → past its expiration → **Renew** (extend expiration; resume
 *                  alone would be refused by the server).
 * - `max_views`  → hit its view limit → **Renew** (raise maxViews; resume refused).
 */
export type ShareLifecycleState =
  | { kind: "active" }
  | { kind: "deactivated"; reason: "manual" | "expired" | "max_views" };

/** True when the share's expiration is in the past. */
export function isShareExpired(share: Pick<Share, "expiration">): boolean {
  return !!share.expiration && new Date(share.expiration) <= new Date();
}

/** True when the share has reached its configured view limit. */
export function isShareMaxedOut(share: Pick<Share, "maxViews" | "views">): boolean {
  return share.maxViews !== null && share.views >= share.maxViews;
}

/**
 * Resolve the lifecycle state shown to the share owner.
 *
 * Persisted deactivation (`isActive=false`) wins and carries its stored reason.
 * Otherwise we apply the same defensive expiry/maxViews check the server does at
 * read time, so a share that lapsed since the last sweep still reads as
 * deactivated with the appropriate reason.
 */
export function getShareLifecycleState(
  share: Pick<Share, "isActive" | "deactivationReason" | "expiration" | "maxViews" | "views">,
): ShareLifecycleState {
  if (!share.isActive) {
    // Persisted reason is authoritative. Fall back defensively (older rows could
    // be inactive without a reason) using the same expiry/maxViews precedence as
    // the server's deactivation sweep.
    const reason =
      share.deactivationReason ??
      (isShareExpired(share) ? "expired" : isShareMaxedOut(share) ? "max_views" : "manual");
    return { kind: "deactivated", reason };
  }

  // Still active per the DB, but may have lapsed between sweeps.
  if (isShareExpired(share)) return { kind: "deactivated", reason: "expired" };
  if (isShareMaxedOut(share)) return { kind: "deactivated", reason: "max_views" };

  return { kind: "active" };
}
