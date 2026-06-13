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
 * Status derivation:
 * - `disabled`  — SMTP not enabled (admin choice, not a fault).
 * - `down`      — enabled, there are failed jobs and nothing sent in the last 24h.
 * - `degraded`  — enabled, there are failed jobs but some mail is still going out.
 * - `ok`        — enabled, no failed jobs.
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

  const [pending, sentLast24h, failed, digestPending] = await Promise.all([
    prisma.emailJob.count({ where: { status: "pending" } }),
    prisma.emailJob.count({
      where: {
        status: "sent",
        sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.emailJob.count({ where: { status: "failed" } }),
    prisma.emailJob.count({ where: { status: "digest_pending" } }),
  ]);

  const lastErrorJob = await prisma.emailJob.findFirst({
    where: { lastError: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { lastError: true },
  });
  const lastError = lastErrorJob?.lastError ?? null;

  let status: EmailHealthStatus;
  if (!smtpConfigured) {
    status = "disabled";
  } else if (failed > 0 && sentLast24h === 0) {
    status = "down";
  } else if (failed > 0) {
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
