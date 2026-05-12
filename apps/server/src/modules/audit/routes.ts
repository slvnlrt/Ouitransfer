import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { AuditController } from "./controller.js";
import { AuditActionSchema } from "./service.js";

export async function auditRoutes(app: FastifyInstance) {
  const auditController = new AuditController();

  const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

  app.get(
    "/admin/audit-logs",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Admin"],
        operationId: "getAuditLogs",
        summary: "Get Audit Logs",
        description: "Get paginated audit logs (admin only)",
        querystring: z.object({
          userId: z.string().min(1).optional().describe("Filter by user ID (non-empty string)"),
          action: AuditActionSchema.optional().describe(
            `Filter by action. Valid values: ${AuditActionSchema.options.join(", ")}`,
          ),
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .default(50)
            .describe("Number of results to return"),
          offset: z.coerce
            .number()
            .int()
            .min(0)
            .optional()
            .default(0)
            .describe("Number of results to skip"),
        }),
        response: {
          200: z.object({
            logs: z.array(
              z.object({
                id: z.string().describe("Audit log ID"),
                userId: z.string().nullable().describe("User ID"),
                action: z.string().describe("Action performed"),
                ipAddress: z.string().describe("IP address"),
                userAgent: z.string().nullable().describe("User agent"),
                metadata: z.unknown().nullable().describe("Parsed metadata object (or null)"),
                createdAt: z.date().describe("Timestamp"),
              }),
            ),
            total: z.number().describe("Total number of matching records"),
          }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    auditController.listAuditLogs.bind(auditController),
  );
}
