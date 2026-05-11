import type { FastifyReply, FastifyRequest } from "fastify";

import { AppError, UnauthorizedError, ValidationError } from "../../utils/app-error.js";
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

    try {
      const diskSpace = await this.storageService.getDiskSpace(userId, isAdmin);
      return reply.send(diskSpace);
    } catch (error: unknown) {
      // Map specific disk-space detection errors to 503
      const message = error instanceof Error ? error.message : undefined;
      if (message?.includes("Unable to determine actual disk space")) {
        throw new AppError(
          503,
          "Disk space detection unavailable - system configuration issue",
          "DISK_SPACE_DETECTION_FAILED",
          { details: "Please check system permissions and available disk utilities" },
        );
      }
      throw error;
    }
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
