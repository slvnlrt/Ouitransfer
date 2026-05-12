import { HeadBucketCommand } from "@aws-sdk/client-s3";

import { bucketName, s3Client } from "../../config/storage.config.js";
import { prisma } from "../../shared/prisma.js";

interface HealthCheckResult {
  status: "healthy" | "degraded";
  timestamp: string;
  uptime: number;
  checks: {
    database: "ok" | "error";
    storage: "ok" | "error" | "not_configured";
  };
}

export class HealthController {
  async check(): Promise<HealthCheckResult> {
    const checks: HealthCheckResult["checks"] = {
      database: "error",
      storage: "not_configured",
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.database = "ok";
    } catch {
      checks.database = "error";
    }

    if (s3Client && bucketName) {
      try {
        await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
        checks.storage = "ok";
      } catch {
        checks.storage = "error";
      }
    }

    const allHealthy = Object.values(checks).every((v) => v === "ok" || v === "not_configured");

    return {
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
  }
}
