import type { FastifyReply, FastifyRequest } from "fastify";

import { UnauthorizedError, ValidationError } from "../../utils/app-error.js";
import { StorageService } from "./service.js";

export class StorageController {
  private storageService = new StorageService();

  async getDiskSpace(request: FastifyRequest, reply: FastifyReply) {
    let userId: string | undefined;
    let isAdmin = false;

    try {
      await request.jwtVerify();
      userId = request.user?.userId;
      isAdmin = request.user?.isAdmin || false;
    } catch (_err) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const diskSpace = await this.storageService.getDiskSpace(userId, isAdmin);
    return reply.send(diskSpace);
  }

  async checkUploadAllowed(request: FastifyRequest, reply: FastifyReply) {
    const { fileSize } = request.query as { fileSize: string };
    let userId: string | undefined;

    try {
      await request.jwtVerify();
      userId = request.user?.userId;
    } catch (_err) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    if (!fileSize) {
      throw new ValidationError("File size parameter is required (in bytes)");
    }

    const result = await this.storageService.checkUploadAllowed(Number(fileSize), userId);
    return reply.send(result);
  }
}
