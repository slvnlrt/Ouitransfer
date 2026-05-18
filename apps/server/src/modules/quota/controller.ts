import type { FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "../../shared/prisma.js";
import { NotFoundError } from "../../utils/app-error.js";
import { UpdateQuotaSchema } from "./dto.js";
import { QuotaService } from "./service.js";

export class QuotaController {
  private quotaService = new QuotaService();

  async getUserQuota(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        maxFileSizeOverride: true,
        maxTotalStorageOverride: true,
      },
    });

    if (!user) {
      throw new NotFoundError("User not found");
    }

    const status = await this.quotaService.getQuotaStatus(id);

    return reply.send({
      used: status.used.toString(),
      maxTotalStorage: status.maxTotalStorage.toString(),
      maxFileSize: status.maxFileSize.toString(),
      percentage: status.percentage,
      warningLevel: status.warningLevel,
      uploadAllowed: status.uploadAllowed,
      overrides: {
        maxFileSizeOverride: user.maxFileSizeOverride?.toString() ?? null,
        maxTotalStorageOverride: user.maxTotalStorageOverride?.toString() ?? null,
      },
    });
  }

  async updateUserQuota(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const input = UpdateQuotaSchema.parse(request.body);

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
