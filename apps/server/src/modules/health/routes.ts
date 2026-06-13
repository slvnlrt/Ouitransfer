import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import { bucketName, s3Client } from "../../config/storage.config.js";
import { prisma } from "../../shared/prisma.js";
import { evaluateEmailHealth } from "../email/health.js";

const emailStatusEnum = z.enum(["ok", "disabled", "degraded", "down"]);

const healthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  timestamp: z.string(),
  uptime: z.number(),
  checks: z.object({
    database: z.enum(["ok", "error"]),
    storage: z.enum(["ok", "error", "not_configured"]),
    // Coarse email subsystem status (enum only — no counters, this endpoint is public).
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
  app.route({
    method: "GET",
    url: "/health",
    schema: {
      tags: ["Health"],
      operationId: "checkHealth",
      summary: "Check API Health",
      description: "Returns health status including database and storage checks.",
      response: {
        200: healthResponseSchema,
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
      // non-critical subsystem (upload/download works without it), so it must not
      // flip ops monitoring to degraded — the UI bumps the dot client-side instead.
      const allHealthy =
        checks.database === "ok" &&
        (checks.storage === "ok" || checks.storage === "not_configured");

      return reply.code(200).send({
        status: allHealthy ? "healthy" : "degraded",
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        checks,
      });
    },
  });

  app.route({
    method: "GET",
    url: "/health/status",
    schema: {
      tags: ["Health"],
      operationId: "getHealthStatus",
      summary: "Get simplified system health status",
      description: "Returns aggregate health status as a single field. No authentication required.",
      response: {
        200: z.object({
          status: z.enum(["healthy", "degraded", "unhealthy"]),
          // Coarse email subsystem status (enum only — no counters, this endpoint is public).
          email: emailStatusEnum,
        }),
      },
    },
    handler: async (_request, reply) => {
      const { dbOk, storageOk, storageConfigured } = await runHealthChecks();
      const { status: emailStatus } = await evaluateEmailHealth();

      // Storage not configured is treated as ok for the simplified status.
      // The aggregate `status` is deliberately based on DB + storage ONLY — email is
      // a non-critical subsystem and is surfaced separately via the `email` field.
      const effectiveStorageOk = !storageConfigured || storageOk;
      const status =
        dbOk && effectiveStorageOk
          ? "healthy"
          : dbOk || effectiveStorageOk
            ? "degraded"
            : "unhealthy";

      return reply.status(200).send({ status, email: emailStatus });
    },
  });
};
