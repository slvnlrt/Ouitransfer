import type { FastifyReply, FastifyRequest } from "fastify";
import { AdminStatsService } from "./stats.service.js";

const statsService = new AdminStatsService();

export class AdminStatsController {
  async getStats(_request: FastifyRequest, reply: FastifyReply) {
    const stats = await statsService.getStats();
    return reply.status(200).send(stats);
  }
}
