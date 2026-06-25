import { ErrorCodes } from "@ouitransfer/shared/error-codes";
import { AppError } from "../../utils/app-error.js";

/**
 * A6 deactivated-owner gate for reverse shares (single source of truth).
 *
 * Blocks any external access/upload action when the reverse share's owner
 * account is deactivated. This is a read-time gate derived from
 * `creator.isActive` (no stored flag), so it auto-reverses when the account is
 * reactivated. Mirrors the regular-share A6 gate in `share/service.ts`.
 *
 * Must be applied on EVERY external entry point (metadata fetch, presign,
 * register, multipart) so a semi-public/bookmarkable upload URL cannot bypass
 * it. Repository `findById`/`findByAlias` select `creator.isActive` for this.
 *
 * @param reverseShare any loaded reverse share whose `creator.isActive` is selected
 */
export function assertOwnerActive(reverseShare: {
  creator?: { isActive?: boolean | null } | null;
}): void {
  if (reverseShare.creator?.isActive === false) {
    throw new AppError(403, "Reverse share owner is inactive", ErrorCodes.OWNER_INACTIVE);
  }
}
