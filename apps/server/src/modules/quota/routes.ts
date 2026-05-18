import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { ForbiddenError, UnauthorizedError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { QuotaController } from "./controller.js";
import { QuotaStatusResponseSchema, UpdateQuotaResponseSchema, UpdateQuotaSchema } from "./dto.js";

export async function quotaRoutes(app: FastifyInstance) {
  const quotaController = new QuotaController();

  // Admin-only preValidation (same pattern as user routes)
  const preValidation = async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch (_err) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }
    if (!request.user.isAdmin) {
      throw new ForbiddenError("Access restricted to administrators");
    }
  };

  app.get(
    "/users/:id/quota",
    {
      preValidation,
      schema: {
        tags: ["Quota"],
        operationId: "getUserQuota",
        summary: "Get user quota status",
        description:
          "Get effective limits, current usage, and warning level for a user (admin only)",
        params: z.object({ id: z.string().describe("User ID") }),
        response: {
          200: QuotaStatusResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    quotaController.getUserQuota.bind(quotaController),
  );

  app.patch(
    "/users/:id/quota",
    {
      preValidation,
      schema: {
        tags: ["Quota"],
        operationId: "updateUserQuota",
        summary: "Update user quota overrides",
        description:
          "Set per-user quota overrides. null = clear (inherit), 0 = unlimited, >0 = explicit limit in bytes (admin only)",
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
    quotaController.updateUserQuota.bind(quotaController),
  );
}
