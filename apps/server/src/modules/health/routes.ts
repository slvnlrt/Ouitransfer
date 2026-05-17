import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { HealthController } from "./controller.js";
import { HealthStatusController } from "./status.controller.js";

const healthResponseSchema = z.object({
  status: z.enum(["healthy", "degraded"]),
  timestamp: z.string(),
  uptime: z.number(),
  checks: z.object({
    database: z.enum(["ok", "error"]),
    storage: z.enum(["ok", "error", "not_configured"]),
  }),
});

export async function healthRoutes(app: FastifyInstance) {
  const healthController = new HealthController();
  const healthStatusController = new HealthStatusController();

  app.get(
    "/health",
    {
      schema: {
        tags: ["Health"],
        operationId: "checkHealth",
        summary: "Check API Health",
        description:
          "Returns health status including database and storage checks. 200 when healthy, 503 when degraded.",
        response: {
          200: healthResponseSchema,
          503: healthResponseSchema,
        },
      },
    },
    async (_request, reply) => {
      const result = await healthController.check();
      const statusCode = result.status === "healthy" ? 200 : 503;
      return reply.code(statusCode).send(result);
    },
  );

  app.get(
    "/health/status",
    {
      schema: {
        tags: ["Health"],
        operationId: "getHealthStatus",
        summary: "Get simplified system health status",
        description:
          "Returns aggregate health status as a single field. No authentication required.",
        response: {
          200: z.object({
            status: z.enum(["healthy", "degraded", "unhealthy"]),
          }),
        },
      },
    },
    healthStatusController.getStatus.bind(healthStatusController),
  );
}
