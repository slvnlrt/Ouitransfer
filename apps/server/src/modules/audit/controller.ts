import type { FastifyReply, FastifyRequest } from "fastify";

import { getAuditLogs } from "./service.js";

/** Query params after Zod coercion in the route schema */
interface AuditLogsQuery {
  userId?: string;
  action?: string;
  limit?: number;
  offset?: number;
}

export class AuditController {
  async listAuditLogs(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as AuditLogsQuery;

    const result = await getAuditLogs({
      userId: query.userId,
      action: query.action,
      limit: query.limit,
      offset: query.offset,
    });

    return reply.send(result);
  }
}
