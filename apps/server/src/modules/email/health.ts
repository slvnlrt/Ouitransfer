import { prisma } from "../../shared/prisma.js";
import { getConfigValue } from "../config/service.js";

export type EmailHealthStatus = "ok" | "disabled" | "degraded" | "down";

export interface EmailHealth {
  status: EmailHealthStatus;
  smtpConfigured: boolean;
  queue: {
    pending: number;
    failed: number;
    sentLast24h: number;
    digestPending: number;
  };
  lastError: string | null;
}

/** Recency window for failure-based signals (status + lastError). */
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * A job that is ready to send (`pending`, `nextAttemptAt <= now`) or locked for
 * delivery (`processing`) for longer than this is treated as a stalled queue.
 *
 * The worker drains the queue oldest-first (`orderBy createdAt asc`) at a fixed
 * batch size, so while it is running the oldest *ready* job is always young — it
 * gets picked up on the very next poll. A ready job that ages past this window
 * therefore means the worker is not draining (frozen on a hung `sendMail`,
 * crashed, or otherwise stuck), not merely that the backlog is large.
 *
 * The threshold is set well above both the queue's 5-minute stuck-`processing`
 * recovery window and several poll intervals, so it only trips on a genuinely
 * frozen worker and never flaps under bursty load or a slow poll interval.
 */
const STALLED_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Evaluate the health of the email / notifications subsystem.
 *
 * Status is derived purely from cheap DB queue counters and the persisted SMTP
 * config flag — there is **no live SMTP probe** (no `transporter.verify()`).
 * This function feeds the public, unauthenticated `/health` and `/health/status`
 * endpoints, which must stay cheap and side-effect-free: a per-poll network
 * round-trip to the SMTP server would add latency and an
 * amplification/availability-leak vector. Queue counters are the signal we
 * actually care about (jobs piling up / failing), so they are sufficient.
 *
 * Failure-based signals use a **recent (24h) window** so that old dead-letter
 * jobs — failed jobs are retained for `emailJobRetentionDays` (~30d) and never
 * auto-pruned — do not pin the subsystem to `degraded` forever, nor flip a quiet
 * but healthy instance to `down`. A genuinely broken SMTP keeps producing fresh
 * failures, so it stays degraded/down; once failures age out (and no new ones
 * appear) the status self-heals to `ok`. The `failed` counter exposed to admins
 * stays the lifetime total (informative); only the status/lastError derivation
 * is windowed.
 *
 * A **stalled queue** is also surfaced: a transport that hangs leaves jobs stuck
 * in `processing`/`pending` and produces no outright failures, so the
 * failure-based signals above would still report `ok`. We detect this cheaply
 * via the oldest still-unsent job: a job ready to send (or locked for delivery)
 * for longer than {@link STALLED_THRESHOLD_MS} means the worker is not draining
 * the queue → `degraded`. It self-heals to `ok` once the worker resumes and the
 * backlog clears.
 *
 * Status derivation:
 * - `disabled`  — SMTP not enabled (admin choice, not a fault).
 * - `down`      — enabled, recent failed jobs and nothing sent in the last 24h.
 * - `degraded`  — enabled, recent failed jobs but some mail is still going out,
 *                 OR the queue is stalled (not draining).
 * - `ok`        — enabled, no recent failures and the queue is draining.
 */
export async function evaluateEmailHealth(): Promise<EmailHealth> {
  let smtpConfigured = false;
  try {
    const smtpEnabled = await getConfigValue("smtpEnabled");
    smtpConfigured = smtpEnabled === "true";
  } catch {
    // Config key missing ⇒ SMTP not configured.
    smtpConfigured = false;
  }

  const now = Date.now();
  const since = new Date(now - RECENT_WINDOW_MS);
  const stalledBefore = new Date(now - STALLED_THRESHOLD_MS);

  const [
    pending,
    sentLast24h,
    failed,
    failedRecent,
    digestPending,
    stalledPending,
    stalledProcessing,
  ] = await Promise.all([
    prisma.emailJob.count({ where: { status: "pending" } }),
    prisma.emailJob.count({ where: { status: "sent", sentAt: { gte: since } } }),
    prisma.emailJob.count({ where: { status: "failed" } }),
    prisma.emailJob.count({ where: { status: "failed", createdAt: { gte: since } } }),
    prisma.emailJob.count({ where: { status: "digest_pending" } }),
    // Stall signals: a job ready to send (pending, due) or locked for delivery
    // (processing) since before the stall cutoff — the worker is not draining.
    prisma.emailJob.count({ where: { status: "pending", nextAttemptAt: { lte: stalledBefore } } }),
    prisma.emailJob.count({ where: { status: "processing", lockedAt: { lte: stalledBefore } } }),
  ]);

  const queueStalled = stalledPending > 0 || stalledProcessing > 0;

  // Only surface an error for a recently-failed job — a job that ultimately sent
  // keeps its (now-stale) `lastError`, and an old dead-letter job is not a
  // current problem.
  const lastErrorJob = await prisma.emailJob.findFirst({
    where: { status: "failed", lastError: { not: null }, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    select: { lastError: true },
  });
  const lastError = lastErrorJob?.lastError ?? null;

  let status: EmailHealthStatus;
  if (!smtpConfigured) {
    status = "disabled";
  } else if (failedRecent > 0 && sentLast24h === 0) {
    status = "down";
  } else if (failedRecent > 0 || queueStalled) {
    status = "degraded";
  } else {
    status = "ok";
  }

  return {
    status,
    smtpConfigured,
    queue: { pending, failed, sentLast24h, digestPending },
    lastError,
  };
}
