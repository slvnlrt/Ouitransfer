import { HeadBucketCommand } from "@aws-sdk/client-s3";
import type { FastifyReply, FastifyRequest } from "fastify";

import { bucketName, s3Client } from "../../config/storage.config.js";
import { prisma } from "../../shared/prisma.js";
import { getLogger } from "../../utils/logger.js";

export class HealthStatusController {
  async getStatus(_request: FastifyRequest, reply: FastifyReply) {
    const logger = getLogger();
    let dbOk = false;
    let storageOk = false;

    // Check database
    try {
      await prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch (err) {
      logger.error({ err }, "Health status: database check failed");
    }

    // Check storage — mirrors the existing HealthController pattern
    if (s3Client && bucketName) {
      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
        storageOk = true;
      } catch (err) {
        logger.error({ err }, "Health status: storage check failed");
      }
    } else {
      // Storage not configured — treat as ok (matches existing health controller behaviour)
      storageOk = true;
    }

    const status = dbOk && storageOk ? "healthy" : dbOk || storageOk ? "degraded" : "unhealthy";

    return reply.status(200).send({ status });
  }
}
