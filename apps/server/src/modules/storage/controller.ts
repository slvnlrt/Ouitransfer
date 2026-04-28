import type { FastifyReply, FastifyRequest } from "fastify";

import { StorageService } from "./service.js";

export class StorageController {
  private storageService = new StorageService();

  async getDiskSpace(request: FastifyRequest, reply: FastifyReply) {
    try {
      let userId: string | undefined;
      let isAdmin = false;

      try {
        await request.jwtVerify();
        userId = request.user?.userId;
        isAdmin = request.user?.isAdmin || false;
      } catch (_err) {
        return reply.status(401).send({
          error: "Unauthorized: a valid token is required to access this resource.",
        });
      }

      const diskSpace = await this.storageService.getDiskSpace(userId, isAdmin);
      return reply.send(diskSpace);
    } catch (error: unknown) {
      request.log.error({ err: error }, "Controller error in getDiskSpace");
      const message = error instanceof Error ? error.message : undefined;

      if (message?.includes("Unable to determine actual disk space")) {
        return reply.status(503).send({
          error: "Disk space detection unavailable - system configuration issue",
          details: "Please check system permissions and available disk utilities",
          code: "DISK_SPACE_DETECTION_FAILED",
        });
      }

      return reply.status(500).send({
        error: "Failed to retrieve disk space information",
        details: message ?? "Unknown error occurred",
      });
    }
  }

  async checkUploadAllowed(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { fileSize } = request.query as { fileSize: string };
      let userId: string | undefined;

      try {
        await request.jwtVerify();
        userId = request.user?.userId;
      } catch (_err) {
        return reply.status(401).send({
          error: "Unauthorized: a valid token is required to access this resource.",
        });
      }

      if (!fileSize) {
        return reply.status(400).send({
          error: "File size parameter is required (in bytes)",
        });
      }

      const result = await this.storageService.checkUploadAllowed(Number(fileSize), userId);
      return reply.send(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(500).send({ error: message });
    }
  }
}
