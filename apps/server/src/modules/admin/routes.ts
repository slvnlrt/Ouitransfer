import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { AdminStatsService } from "./stats.service.js";

const statsService = new AdminStatsService();
const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

export const adminRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "GET",
    url: "/admin/stats",
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
    preValidation: adminPreValidation,
    handler: async (_request, reply) => {
      const stats = await statsService.getStats();
      return reply.status(200).send(stats);
    },
  });
};
