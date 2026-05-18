import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { QuotaStatusResponseSchema, UpdateQuotaResponseSchema, UpdateQuotaSchema } from "./dto.js";

// TODO(task-5): Replace stubs with full implementations and wire up QuotaController
export async function quotaRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/users/:id/quota",
    {
      schema: {
        tags: ["Quota"],
        operationId: "getUserQuota",
        summary: "Get User Quota",
        description: "Get quota status for a user (admin only)",
        params: z.object({ id: z.string().describe("User ID") }),
        response: {
          200: QuotaStatusResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async () => {
      // TODO(task-5): implement handler
    },
  );

  app.patch(
    "/users/:id/quota",
    {
      schema: {
        tags: ["Quota"],
        operationId: "updateUserQuota",
        summary: "Update User Quota Overrides",
        description: "Set per-user quota overrides (admin only)",
        params: z.object({ id: z.string().describe("User ID") }),
        body: UpdateQuotaSchema,
        response: {
          200: UpdateQuotaResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    async () => {
      // TODO(task-5): implement handler
    },
  );
}
