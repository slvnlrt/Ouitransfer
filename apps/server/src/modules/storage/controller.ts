import type { FastifyReply, FastifyRequest } from "fastify";

import { ValidationError } from "../../utils/app-error.js";
import { StorageService } from "./service.js";

export class StorageController {
  private storageService = new StorageService();

  async getDiskSpace(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user.userId;
    const isAdmin = request.user.isAdmin || false;

    const diskSpace = await this.storageService.getDiskSpace(userId, isAdmin);
    return reply.send(diskSpace);
  }

  async checkUploadAllowed(request: FastifyRequest, reply: FastifyReply) {
    const { fileSize } = request.query as { fileSize: string };
    const userId = request.user.userId;

    if (!fileSize) {
      throw new ValidationError("File size parameter is required (in bytes)");
    }

    const result = await this.storageService.checkUploadAllowed(Number(fileSize), userId);
    return reply.send(result);
  }
}
