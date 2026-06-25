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

import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import type { DeactivationReason } from "../../generated/prisma/client.js";
import { AppError } from "../../utils/app-error.js";

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

/** Minimal share shape the lifecycle gate needs (works for both `getShare` and the download path). */
export interface AccessibleShareState {
  isActive: boolean;
  deactivationReason: DeactivationReason | null;
  expiration: Date | string | null;
  maxViews: number | null;
  views: number;
  creator?: { isActive: boolean } | null;
}

/**
 * Enforce the share-lifecycle access gate for a public (non-owner) consumer (R2 — A4-02).
 *
 * This is the SINGLE source of truth for "is this share currently servable to a visitor",
 * shared by {@link ShareService.getShare} (the read path) and the file-download path so the two
 * can never diverge. It throws the same {@link AppError}s `getShare` historically threw inline.
 *
 * Order mirrors `getShare`:
 *   1. owner-inactive  → 403 OWNER_INACTIVE   (read-time gate, auto-reverses on reactivation)
 *   2. persisted deactivation (isActive=false) → 410/403 keyed by `deactivationReason`
 *   3. defensive date-based expiry (A4-14: compute from the DATE, not only the persisted flag,
 *      so a not-yet-swept expired share still gates)
 *   4. max-views reached (defensive; the read path also increments atomically)
 *
 * Password and identification are NOT handled here — they are consumer-specific and stay at the
 * call sites. This helper is purely the lifecycle/owner gate.
 */
export function assertShareAccessible(share: AccessibleShareState): void {
  // 1. Owner deactivated — derived from creator.isActive (no stored flag; auto-reverses).
  if (share.creator && share.creator.isActive === false) {
    throw new AppError(403, "Share owner is inactive", ErrorCodes.OWNER_INACTIVE);
  }

  // 2. Persisted deactivation — the response depends on *why* it was deactivated.
  if (!share.isActive) {
    switch (share.deactivationReason) {
      case "max_views":
        throw new AppError(410, "Share has reached maximum views", ErrorCodes.MAX_VIEWS_REACHED);
      case "manual":
        throw new AppError(403, "Share is inactive", ErrorCodes.SHARE_INACTIVE);
      default:
        throw new AppError(410, "Share has expired", ErrorCodes.SHARE_EXPIRED);
    }
  }

  // 3. Defensive expiry by date — a share that expires between scheduler sweeps is still
  //    isActive=true here; block immediately by date even before the flag is backfilled.
  if (share.expiration && new Date() > new Date(share.expiration)) {
    throw new AppError(410, "Share has expired", ErrorCodes.SHARE_EXPIRED);
  }

  // 4. Max-views reached — defensive (the read path increments atomically; the download path
  //    never increments, so without this an exhausted share would still serve bytes).
  if (share.maxViews !== null && share.views >= share.maxViews) {
    throw new AppError(410, "Share has reached maximum views", ErrorCodes.MAX_VIEWS_REACHED);
  }
}
