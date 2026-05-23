import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { prisma } from "../../shared/prisma.js";
import { NotFoundError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { QuotaStatusResponseSchema, UpdateQuotaResponseSchema, UpdateQuotaSchema } from "./dto.js";
import { quotaService } from "./service.js";

const preValidation = createAdminPreValidation({ allowSetupBypass: false });

export const quotaRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "GET",
    url: "/users/:id/quota",
    schema: {
      tags: ["Quota"],
      operationId: "getUserQuota",
      summary: "Get user quota status",
      description: "Get effective limits, current usage, and warning level for a user (admin only)",
      params: z.object({ id: z.string().describe("User ID") }),
      response: {
        200: QuotaStatusResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    preValidation,
    handler: async (request, reply) => {
      const status = await quotaService.getQuotaStatus(request.params.id);
      return reply.send({
        used: status.used.toString(),
        maxTotalStorage: status.maxTotalStorage.toString(),
        maxFileSize: status.maxFileSize.toString(),
        percentage: status.percentage,
        warningLevel: status.warningLevel,
        uploadAllowed: status.uploadAllowed,
        overrides: {
          maxFileSizeOverride: status.overrides.maxFileSizeOverride?.toString() ?? null,
          maxTotalStorageOverride: status.overrides.maxTotalStorageOverride?.toString() ?? null,
        },
        sources: status.sources,
      });
    },
  });

  app.route({
    method: "PATCH",
    url: "/users/:id/quota",
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
    preValidation,
    handler: async (request, reply) => {
      const { id } = request.params;

      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) {
        throw new NotFoundError("User not found");
      }

      const updateData: Record<string, bigint | null> = {};
      if (request.body.maxFileSizeOverride !== undefined) {
        updateData.maxFileSizeOverride = request.body.maxFileSizeOverride;
      }
      if (request.body.maxTotalStorageOverride !== undefined) {
        updateData.maxTotalStorageOverride = request.body.maxTotalStorageOverride;
      }

      const updated = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          maxFileSizeOverride: true,
          maxTotalStorageOverride: true,
        },
      });

      // Audit quota change (fire-and-forget)
      logAuditEvent({
        userId: request.user?.userId,
        action: "USER_QUOTA_CHANGE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "user",
        targetId: id,
        metadata: {
          oldMaxFileSize: user.maxFileSizeOverride?.toString() ?? null,
          newMaxFileSize: updated.maxFileSizeOverride?.toString() ?? null,
          oldMaxTotalStorage: user.maxTotalStorageOverride?.toString() ?? null,
          newMaxTotalStorage: updated.maxTotalStorageOverride?.toString() ?? null,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send({
        message: "User quota overrides updated",
        overrides: {
          maxFileSizeOverride: updated.maxFileSizeOverride?.toString() ?? null,
          maxTotalStorageOverride: updated.maxTotalStorageOverride?.toString() ?? null,
        },
      });
    },
  });
};
