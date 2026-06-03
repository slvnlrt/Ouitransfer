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

/** Values persisted in `Share.deactivationReason` / `ReverseShare.deactivationReason`. */
export const DEACTIVATION_REASONS = ["expired", "max_views", "manual"] as const;

/** Reason a share/reverse-share was deactivated. */
export type DeactivationReason = (typeof DEACTIVATION_REASONS)[number];
