import { ErrorCodes } from "@ouitransfer/shared/error-codes";

import { prisma } from "../../shared/prisma.js";
import { AppError } from "../../utils/app-error.js";

/**
 * Anti-spam / mailer-abuse limits for user-triggered outbound mail (A6-03 / A4-10).
 *
 * Any authenticated share owner can attach external recipient addresses to a
 * share / reverse-share and trigger invitation + reminder emails to them. Without
 * a cap the configured SMTP relay becomes a spam vector. These guards bound the
 * blast radius along three independent axes:
 *
 *  1. A hard ceiling on the number of recipients attached to a single share, so a
 *     single notify call cannot fan out to thousands of addresses.
 *  2. A per-user rolling-24h quota on user-attributed invitation/reminder emails
 *     enqueued, so a user cannot loop the notify endpoint to mass-mail.
 *  3. A short-window enqueue-rate cap (independent of HTTP request count — one
 *     HTTP request enqueues N recipients) to stop bursts.
 *
 * All limits are intentionally generous for legitimate use and only bite on abuse.
 */

/** Hard ceiling on recipients attached to a single share / reverse-share. */
export const MAX_RECIPIENTS_PER_SHARE = 100;

/** Rolling window for the per-user email quota. */
export const EMAIL_QUOTA_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Max user-attributed invitation/reminder emails enqueued per user per rolling 24h. */
export const EMAIL_QUOTA_PER_DAY = 500;

/** Short window for the burst (enqueue-rate) cap. */
export const EMAIL_BURST_WINDOW_MS = 60 * 1000;

/** Max user-attributed emails enqueued per user inside {@link EMAIL_BURST_WINDOW_MS}. */
export const EMAIL_BURST_MAX = 100;

/**
 * Asserts that attaching `count` recipients to a single share does not exceed the
 * per-share ceiling. Throws a 400 {@link AppError} otherwise.
 */
export function assertRecipientCountWithinLimit(count: number): void {
  if (count > MAX_RECIPIENTS_PER_SHARE) {
    throw new AppError(
      400,
      `A share may have at most ${MAX_RECIPIENTS_PER_SHARE} recipients (received ${count}).`,
      ErrorCodes.VALIDATION_ERROR,
    );
  }
}

/**
 * Asserts that the user has remaining budget to enqueue `additional` user-attributed
 * emails right now, against BOTH the rolling-24h quota and the short-window burst cap.
 *
 * Counts only rows attributed to this user via `EmailJob.senderUserId` (system/
 * critical mail is never attributed, so it never consumes a user's budget). The
 * check is best-effort and racy under heavy concurrency (no row lock), but the
 * window is short and the cap generous, so a small overshoot is acceptable — the
 * goal is to bound mass abuse, not to be a precise accounting ledger.
 *
 * Throws a 429 {@link AppError} when either limit would be exceeded.
 */
export async function assertEmailQuotaAvailable(userId: string, additional: number): Promise<void> {
  if (additional <= 0) return;

  const now = Date.now();
  const dayCutoff = new Date(now - EMAIL_QUOTA_WINDOW_MS);
  const burstCutoff = new Date(now - EMAIL_BURST_WINDOW_MS);

  const [dayCount, burstCount] = await Promise.all([
    prisma.emailJob.count({
      where: { senderUserId: userId, createdAt: { gt: dayCutoff } },
    }),
    prisma.emailJob.count({
      where: { senderUserId: userId, createdAt: { gt: burstCutoff } },
    }),
  ]);

  if (dayCount + additional > EMAIL_QUOTA_PER_DAY) {
    throw new AppError(
      429,
      `Daily email limit reached (${EMAIL_QUOTA_PER_DAY} per 24 hours). Please try again later.`,
      ErrorCodes.RATE_LIMITED,
    );
  }

  if (burstCount + additional > EMAIL_BURST_MAX) {
    throw new AppError(
      429,
      `Too many emails sent in a short period (${EMAIL_BURST_MAX} per minute). Please slow down.`,
      ErrorCodes.RATE_LIMITED,
    );
  }
}
