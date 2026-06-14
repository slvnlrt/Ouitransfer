import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import { bucketName, s3Client } from "../../config/storage.config.js";
import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { prisma } from "../../shared/prisma.js";
import { evaluateEmailHealth } from "../email/health.js";

const emailStatusEnum = z.enum(["ok", "disabled", "degraded", "down"]);

// A8-11 — Public liveness response: a single coarse field plus uptime/timestamp.
// NO per-subsystem breakdown is exposed unauthenticated (that would let an
// attacker probe which backend is degraded and time follow-on attacks). The
// detailed breakdown lives at the admin-gated /health/status endpoint below.
const livenessResponseSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  timestamp: z.string(),
  uptime: z.number(),
});

// Admin-only detailed health: full per-subsystem breakdown.
const detailedHealthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded", "unhealthy"]),
  timestamp: z.string(),
  uptime: z.number(),
  checks: z.object({
    database: z.enum(["ok", "error"]),
    storage: z.enum(["ok", "error", "not_configured"]),
    email: emailStatusEnum,
  }),
});

/**
 * Run database and storage health checks.
 *
 * Returns individual check results so each endpoint can map them
 * to its own response shape.
 */
async function runHealthChecks(): Promise<{
  dbOk: boolean;
  storageOk: boolean;
  storageConfigured: boolean;
}> {
  let dbOk = false;
  let storageOk = false;
  const storageConfigured = Boolean(s3Client && bucketName);

  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    // DB check failed
  }

  if (storageConfigured) {
    try {
      await s3Client!.send(new HeadBucketCommand({ Bucket: bucketName! }));
      storageOk = true;
    } catch {
      // Storage check failed
    }
  }

  return { dbOk, storageOk, storageConfigured };
}

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Public liveness probe (orchestrators / container healthchecks) ──────────
  // A8-11: minimal 200/503 with a coarse aggregate only — no per-subsystem detail.
  // Returns 503 when the DB is down (the only hard dependency for liveness); 200
  // otherwise (including degraded storage, which is surfaced via /health/status).
  app.route({
    method: "GET",
    url: "/health",
    schema: {
      tags: ["Health"],
      operationId: "checkHealth",
      summary: "Liveness probe",
      description:
        "Public liveness probe for orchestrators. Returns 200 when the API is alive, " +
        "503 when the database is unreachable. No per-subsystem detail is exposed " +
        "unauthenticated — use the admin-gated /health/status for the breakdown.",
      response: {
        200: livenessResponseSchema,
        503: livenessResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const { dbOk, storageOk, storageConfigured } = await runHealthChecks();

      // DB is the hard liveness dependency. Degraded storage does NOT fail the
      // liveness probe (kept consistent with the previous public aggregate) — it
      // only flips the coarse `status` to "degraded".
      const storageHealthy = !storageConfigured || storageOk;
      const status = dbOk && storageHealthy ? ("healthy" as const) : ("degraded" as const);

      return reply.code(dbOk ? 200 : 503).send({
        status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    },
  });

  // ── Admin-only detailed status (per-subsystem breakdown) ────────────────────
  // A8-11: the DB/storage/email subsystem breakdown is admin-gated so an
  // unauthenticated attacker cannot probe which backend is degraded.
  app.route({
    method: "GET",
    url: "/health/status",
    preValidation: createAdminPreValidation({ allowSetupBypass: false }),
    schema: {
      tags: ["Health"],
      operationId: "getHealthStatus",
      summary: "Detailed system health (admin only)",
      description:
        "Returns the full per-subsystem health breakdown (database, storage, email). " +
        "Requires an authenticated admin — exposes which backends are degraded.",
      response: {
        200: detailedHealthResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const { dbOk, storageOk, storageConfigured } = await runHealthChecks();
      const { status: emailStatus } = await evaluateEmailHealth();

      const checks = {
        database: dbOk ? ("ok" as const) : ("error" as const),
        storage: !storageConfigured
          ? ("not_configured" as const)
          : storageOk
            ? ("ok" as const)
            : ("error" as const),
        email: emailStatus,
      };

      // Aggregate status is deliberately based on DB + storage ONLY. Email is a
      // non-critical subsystem (upload/download works without it).
      const effectiveStorageOk = !storageConfigured || storageOk;
      const status =
        dbOk && effectiveStorageOk
          ? ("healthy" as const)
          : dbOk || effectiveStorageOk
            ? ("degraded" as const)
            : ("unhealthy" as const);

      return reply.code(200).send({
        status,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks,
      });
    },
  });
};
