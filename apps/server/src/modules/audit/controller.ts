import type { FastifyReply, FastifyRequest } from "fastify";

import { getAuditLogs } from "./service.js";

export class AuditController {
  async listAuditLogs(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as {
      userId?: string;
      action?: string;
      limit?: string;
      offset?: string;
    };

    const result = await getAuditLogs({
      userId: query.userId,
      action: query.action,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });

    return reply.send(result);
  }
}
