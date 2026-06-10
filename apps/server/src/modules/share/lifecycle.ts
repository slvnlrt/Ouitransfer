/**
 * Share / reverse-share lifecycle primitives (Phase A.1).
 *
 * A share or reverse share moves through an explicit two-phase lifecycle:
 *   active → deactivated → deleted
 *
 * `deactivationReason` records *why* a share was deactivated. Only the
 * automatic reasons (`expired`, `max_views`) are eligible for the deletion
 * sweep; `manual` pauses are never auto-deleted.
 */

import type { DeactivationReason } from "../../generated/prisma/client.js";

/** Re-export the Prisma-generated enum as the canonical type. */
export type { DeactivationReason };

/** Values persisted in `Share.deactivationReason` / `ReverseShare.deactivationReason`. */
export const DEACTIVATION_REASONS = [
  "expired",
  "max_views",
  "manual",
] as const satisfies readonly DeactivationReason[];

/**
 * Deactivation reasons that make a share/reverse-share eligible for the
 * scheduler's deletion sweep (phase 2). Only the *automatic* reasons are
 * deletable — a `manual` pause is never auto-deleted (the owner asked for it to
 * stay). If a manually-paused share later also expires, the deactivation sweep
 * upgrades its reason to `expired`, moving it into this set.
 */
export const AUTO_DELETABLE_REASONS = ["expired", "max_views"] as const;

/**
 * The persisted fields that mark a share/reverse-share as deactivated.
 *
 * Single source of truth shared by the read-time transitions (this batch) and
 * the scheduler's deactivation sweep (Batch 3) so they always write the same
 * shape. `deactivatedAt` is the instant the share became inactive; for `expired`
 * it is the expiration instant, otherwise "now".
 */
export interface DeactivationFields {
  isActive: false;
  deactivatedAt: Date;
  deactivationReason: DeactivationReason;
}

/**
 * The persisted fields that mark a share/reverse-share as active again.
 *
 * Used by manual resume and by reactivation-on-extend (raising `maxViews` /
 * extending `expiration`). Clears the deactivation metadata and re-arms the
 * pending-deletion warning so a future deactivation notifies afresh.
 */
export interface ReactivationFields {
  isActive: true;
  deactivatedAt: null;
  deactivationReason: null;
  notifiedForPendingDeletion: false;
}

/** Build the persisted fields that deactivate a share/reverse-share. */
export function deactivationFields(
  reason: DeactivationReason,
  deactivatedAt: Date = new Date(),
): DeactivationFields {
  return { isActive: false, deactivatedAt, deactivationReason: reason };
}

/** Build the persisted fields that reactivate a share/reverse-share. */
export function reactivationFields(): ReactivationFields {
  return {
    isActive: true,
    deactivatedAt: null,
    deactivationReason: null,
    notifiedForPendingDeletion: false,
  };
}
