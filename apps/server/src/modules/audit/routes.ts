import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { AuditController } from "./controller.js";

export async function auditRoutes(app: FastifyInstance) {
  const auditController = new AuditController();

  const adminPreValidation = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      request.log.warn({ err }, "Admin JWT verification failed");
      return reply.status(401).send({ error: "Unauthorized" });
    }

    if (!request.user.isAdmin) {
      return reply.status(403).send({ error: "Access restricted to administrators" });
    }
  };

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
          userId: z.string().optional().describe("Filter by user ID"),
          action: z.string().optional().describe("Filter by action"),
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
                metadata: z.string().nullable().describe("JSON metadata"),
                createdAt: z.date().describe("Timestamp"),
              }),
            ),
            total: z.number().describe("Total number of matching records"),
          }),
          401: z.object({ error: z.string().describe("Error message") }),
          403: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    auditController.listAuditLogs.bind(auditController),
  );
}
