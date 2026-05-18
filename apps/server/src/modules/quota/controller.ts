import type { FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "../../shared/prisma.js";
import { NotFoundError } from "../../utils/app-error.js";
import { quotaService } from "./service.js";

export class QuotaController {
  async getUserQuota(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const status = await quotaService.getQuotaStatus(id);

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
    });
  }

  async updateUserQuota(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const input = request.body as {
      maxFileSizeOverride?: bigint | null;
      maxTotalStorageOverride?: bigint | null;
    };

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundError("User not found");
    }

    const updateData: Record<string, bigint | null> = {};
    if (input.maxFileSizeOverride !== undefined) {
      updateData.maxFileSizeOverride = input.maxFileSizeOverride;
    }
    if (input.maxTotalStorageOverride !== undefined) {
      updateData.maxTotalStorageOverride = input.maxTotalStorageOverride;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        maxFileSizeOverride: true,
        maxTotalStorageOverride: true,
      },
    });

    return reply.send({
      message: "User quota overrides updated",
      overrides: {
        maxFileSizeOverride: updated.maxFileSizeOverride?.toString() ?? null,
        maxTotalStorageOverride: updated.maxTotalStorageOverride?.toString() ?? null,
      },
    });
  }
}
