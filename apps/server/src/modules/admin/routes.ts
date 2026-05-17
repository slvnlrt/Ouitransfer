import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { AdminStatsController } from "./stats.controller.js";

export async function adminRoutes(app: FastifyInstance) {
  const adminStatsController = new AdminStatsController();
  const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

  app.get(
    "/admin/stats",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Admin"],
        operationId: "getAdminStats",
        summary: "Get platform-wide statistics",
        description: "Returns aggregated platform metrics. Admin only.",
        response: {
          200: z.object({
            users: z.object({ total: z.number(), active: z.number() }),
            files: z.object({ total: z.number() }),
            shares: z.object({ active: z.number(), expired: z.number() }),
            reverseShares: z.object({ active: z.number() }),
          }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    adminStatsController.getStats.bind(adminStatsController),
  );
}
