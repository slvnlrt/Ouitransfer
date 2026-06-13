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
 * Status derivation:
 * - `disabled`  — SMTP not enabled (admin choice, not a fault).
 * - `down`      — enabled, recent failed jobs and nothing sent in the last 24h.
 * - `degraded`  — enabled, recent failed jobs but some mail is still going out.
 * - `ok`        — enabled, no recent failures.
 *
 * Known bounded blind spot (tracked as tech debt): a stalled transport that
 * leaves jobs stuck in `processing`/`pending` with zero outright failures still
 * reports `ok`. Detecting that cheaply (without a live probe) is a follow-up.
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

  const since = new Date(Date.now() - RECENT_WINDOW_MS);

  const [pending, sentLast24h, failed, failedRecent, digestPending] = await Promise.all([
    prisma.emailJob.count({ where: { status: "pending" } }),
    prisma.emailJob.count({ where: { status: "sent", sentAt: { gte: since } } }),
    prisma.emailJob.count({ where: { status: "failed" } }),
    prisma.emailJob.count({ where: { status: "failed", createdAt: { gte: since } } }),
    prisma.emailJob.count({ where: { status: "digest_pending" } }),
  ]);

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
  } else if (failedRecent > 0) {
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
