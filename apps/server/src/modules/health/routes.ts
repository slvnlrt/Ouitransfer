import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { bucketName, s3Client } from "../../config/storage.config.js";
import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";

const healthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  timestamp: z.string(),
  uptime: z.number(),
  checks: z.object({
    database: z.enum(["ok", "error"]),
    storage: z.enum(["ok", "error", "not_configured"]),
  }),
});

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
      const checks: { database: "ok" | "error"; storage: "ok" | "error" | "not_configured" } = {
        database: "error",
        storage: "not_configured",
      };

      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = "ok";
      } catch {
        checks.database = "error";
      }

      if (s3Client && bucketName) {
        try {
          await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
          checks.storage = "ok";
        } catch {
          checks.storage = "error";
        }
      }

      const allHealthy = Object.values(checks).every((v) => v === "ok" || v === "not_configured");

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
        }),
      },
    },
    handler: async (_request, reply) => {
      const logger = getLogger();
      let dbOk = false;
      let storageOk = false;

      // Check database
      try {
        await prisma.$queryRaw`SELECT 1`;
        dbOk = true;
      } catch (err) {
        logger.error({ err }, "Health status: database check failed");
      }

      // Check storage — mirrors the existing health check pattern
      if (s3Client && bucketName) {
        try {
          await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
          storageOk = true;
        } catch (err) {
          logger.error({ err }, "Health status: storage check failed");
        }
      } else {
        // Storage not configured — treat as ok
        storageOk = true;
      }

      const status = dbOk && storageOk ? "healthy" : dbOk || storageOk ? "degraded" : "unhealthy";

      return reply.status(200).send({ status });
    },
  });
};
