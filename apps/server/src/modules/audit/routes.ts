import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import {
  AuditActionSchema,
  AuditTargetTypeSchema,
  exportAuditLogs,
  getAuditLogs,
} from "./service.js";

const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /admin/audit-logs — paginated list with filters
  app.route({
    method: "GET",
    url: "/admin/audit-logs",
    schema: {
      tags: ["Admin"],
      operationId: "getAuditLogs",
      summary: "Get Audit Logs",
      description: "Get paginated audit logs with filters (admin only)",
      querystring: z.object({
        userId: z.string().min(1).optional().describe("Filter by user ID"),
        action: AuditActionSchema.optional().describe("Filter by action"),
        targetType: AuditTargetTypeSchema.optional().describe("Filter by target type"),
        targetId: z.string().min(1).optional().describe("Filter by target ID"),
        dateFrom: z.string().datetime().optional().describe("From date (inclusive, ISO 8601)"),
        dateTo: z.string().datetime().optional().describe("To date (inclusive, ISO 8601)"),
        search: z.string().min(1).optional().describe("Search in IP address and action"),
        limit: z.coerce.number().int().min(1).max(100).optional().default(50),
        offset: z.coerce.number().int().min(0).optional().default(0),
      }),
      response: {
        200: z.object({
          logs: z.array(
            z.object({
              id: z.string(),
              userId: z.string().nullable(),
              action: z.string(),
              ipAddress: z.string(),
              userAgent: z.string().nullable(),
              metadata: z.unknown().nullable(),
              targetType: z.string().nullable().optional(),
              targetId: z.string().nullable().optional(),
              createdAt: z.date(),
            }),
          ),
          total: z.number(),
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    preValidation: adminPreValidation,
    handler: async (request, reply) => {
      const q = request.query;
      const result = await getAuditLogs({
        userId: q.userId,
        action: q.action,
        targetType: q.targetType,
        targetId: q.targetId,
        dateFrom: q.dateFrom ? new Date(q.dateFrom) : undefined,
        dateTo: q.dateTo ? new Date(q.dateTo) : undefined,
        search: q.search,
        limit: q.limit,
        offset: q.offset,
      });
      return reply.send(result);
    },
  });

  // GET /admin/audit-logs/export — streaming file download
  app.route({
    method: "GET",
    url: "/admin/audit-logs/export",
    schema: {
      tags: ["Admin"],
      operationId: "exportAuditLogs",
      summary: "Export Audit Logs",
      description: "Export audit logs as CSV or JSON. Date range is required. Max 100k rows.",
      querystring: z.object({
        format: z.enum(["csv", "json"]).describe("Export format"),
        userId: z.string().min(1).optional(),
        action: AuditActionSchema.optional(),
        targetType: AuditTargetTypeSchema.optional(),
        targetId: z.string().min(1).optional(),
        dateFrom: z.string().datetime().describe("From date (required, ISO 8601)"),
        dateTo: z.string().datetime().describe("To date (required, ISO 8601)"),
        search: z.string().min(1).optional(),
      }),
      response: {
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    preValidation: adminPreValidation,
    handler: async (request, reply) => {
      const q = request.query;
      const ext = q.format === "csv" ? "csv" : "json";
      const contentType =
        q.format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8";

      reply.raw.setHeader("Content-Type", contentType);
      reply.raw.setHeader(
        "Content-Disposition",
        `attachment; filename="audit-logs-${q.dateFrom.slice(0, 10)}-${q.dateTo.slice(0, 10)}.${ext}"`,
      );

      const generator = exportAuditLogs({
        format: q.format,
        userId: q.userId,
        action: q.action,
        targetType: q.targetType,
        targetId: q.targetId,
        dateFrom: new Date(q.dateFrom),
        dateTo: new Date(q.dateTo),
        search: q.search,
      });

      for await (const chunk of generator) {
        reply.raw.write(chunk);
      }

      reply.raw.end();
      return reply;
    },
  });
};
