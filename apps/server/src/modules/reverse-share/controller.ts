import type { FastifyReply, FastifyRequest } from "fastify";

import {
  CreateReverseShareSchema,
  ReverseSharePasswordSchema,
  UpdateReverseSharePasswordSchema,
  UpdateReverseShareSchema,
  UploadToReverseShareSchema,
} from "./dto.js";
import { ReverseShareService } from "./service.js";
import { ReverseShareUploadService } from "./upload.service.js";

export class ReverseShareController {
  private reverseShareService = new ReverseShareService();
  private uploadService = new ReverseShareUploadService();

  async createReverseShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const input = CreateReverseShareSchema.parse(request.body);
      const reverseShare = await this.reverseShareService.createReverseShare(input, userId);
      return reply.status(201).send({ reverseShare });
    } catch (error: unknown) {
      request.log.error({ err: error }, "Create Reverse Share Error");
      if (error instanceof Error && "errors" in error) {
        return reply.status(400).send({ error: (error as { errors: unknown }).errors });
      }
      const message = error instanceof Error ? error.message : "Unknown error occurred";
      return reply.status(400).send({ error: message });
    }
  }

  async listUserReverseShares(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const reverseShares = await this.reverseShareService.listUserReverseShares(userId);
      return reply.send({ reverseShares });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async getReverseShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { id } = request.params as { id: string };
      const reverseShare = await this.reverseShareService.getReverseShareById(id, userId);
      return reply.send({ reverseShare });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to access this reverse share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async getReverseShareForUpload(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const password = (request.body as { password?: string } | null)?.password;

      const reverseShare = await this.reverseShareService.getReverseShareForUpload(id, password);
      return reply.send({ reverseShare });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async getReverseShareForUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      const password = (request.body as { password?: string } | null)?.password;

      const reverseShare = await this.reverseShareService.getReverseShareForUploadByAlias(
        alias,
        password,
      );
      return reply.send({ reverseShare });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async updateReverseShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { id, ...updateData } = UpdateReverseShareSchema.parse(request.body);
      const reverseShare = await this.reverseShareService.updateReverseShare(
        id,
        updateData,
        userId,
      );
      return reply.send({ reverseShare });
    } catch (error: unknown) {
      request.log.error({ err: error }, "Update Reverse Share Error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to update this reverse share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async updatePassword(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { id } = request.params as { id: string };
      const { password } = UpdateReverseSharePasswordSchema.parse(request.body);

      const updateData: { password?: string | null } = { password };
      const reverseShare = await this.reverseShareService.updateReverseShare(
        id,
        updateData,
        userId,
      );
      return reply.send({ reverseShare });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to update this reverse share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async deleteReverseShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { id } = request.params as { id: string };
      const reverseShare = await this.reverseShareService.deleteReverseShare(id, userId);
      return reply.send({ reverseShare });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to delete this reverse share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async getPresignedUrl(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { filename, extension, password } = request.body as {
        filename: string;
        extension: string;
        password?: string;
      };

      const result = await this.uploadService.getPresignedUrl(id, filename, extension, password);
      return reply.send(result);
    } catch (error: unknown) {
      request.log.error({ err: error }, "Get Presigned URL Error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async getPresignedUrlByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { filename, extension, password } = request.body as {
        filename: string;
        extension: string;
        password?: string;
      };

      const result = await this.uploadService.getPresignedUrlByAlias(
        alias,
        filename,
        extension,
        password,
      );
      return reply.send(result);
    } catch (error: unknown) {
      request.log.error({ err: error }, "Get Presigned URL by Alias Error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async registerFileUpload(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { password, ...bodyWithoutPassword } = request.body as {
        password?: string;
        [key: string]: unknown;
      };
      const fileData = UploadToReverseShareSchema.parse(bodyWithoutPassword);

      const file = await this.uploadService.registerFileUpload(id, fileData, password);
      return reply.status(201).send({ file });
    } catch (error: unknown) {
      request.log.error({ err: error }, "Register File Upload Error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      if (message === "Maximum number of files reached") {
        return reply.status(403).send({ error: message });
      }
      if (message.includes("File type") && message.includes("not allowed")) {
        return reply.status(400).send({ error: message });
      }
      if (message === "File size exceeds limit") {
        return reply.status(400).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async registerFileUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { password, ...bodyWithoutPassword } = request.body as {
        password?: string;
        [key: string]: unknown;
      };
      const fileData = UploadToReverseShareSchema.parse(bodyWithoutPassword);

      const file = await this.uploadService.registerFileUploadByAlias(alias, fileData, password);
      return reply.status(201).send({ file });
    } catch (error: unknown) {
      request.log.error({ err: error }, "Register File Upload by Alias Error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Reverse share is inactive") {
        return reply.status(403).send({ error: message });
      }
      if (message === "Reverse share has expired") {
        return reply.status(410).send({ error: message });
      }
      if (message === "Password required" || message === "Invalid password") {
        return reply.status(401).send({ error: message });
      }
      if (message === "Maximum number of files reached") {
        return reply.status(403).send({ error: message });
      }
      if (message.includes("File type") && message.includes("not allowed")) {
        return reply.status(400).send({ error: message });
      }
      if (message === "File size exceeds limit") {
        return reply.status(400).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async downloadFile(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { fileId } = request.params as { fileId: string };

      // Pass request context for internal storage proxy URLs
      const requestContext = { protocol: "https", host: "localhost" }; // Simplified - frontend will handle the real URL

      const result = await this.reverseShareService.downloadReverseShareFile(
        fileId,
        userId,
        requestContext,
      );

      return reply.send(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "File not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to download this file") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async deleteFile(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { fileId } = request.params as { fileId: string };
      const file = await this.reverseShareService.deleteReverseShareFile(fileId, userId);
      return reply.send({ file });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "File not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to delete this file") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async checkPassword(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const { password } = ReverseSharePasswordSchema.parse(request.body);

      const result = await this.reverseShareService.checkPassword(id, password);
      return reply.send(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async activateReverseShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { id } = request.params as { id: string };
      const reverseShare = await this.reverseShareService.activateReverseShare(id, userId);
      return reply.send({ reverseShare });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to activate this reverse share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async deactivateReverseShare(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const userId = request.user?.userId;
      if (!userId) {
        return reply
          .status(401)
          .send({ error: "Unauthorized: a valid token is required to access this resource." });
      }

      const { id } = request.params as { id: string };
      const reverseShare = await this.reverseShareService.deactivateReverseShare(id, userId);
      return reply.send({ reverseShare });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      if (message === "Unauthorized to deactivate this reverse share") {
        return reply.status(401).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }

  async createOrUpdateAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { reverseShareId } = request.params as { reverseShareId: string };
      const { alias } = request.body as { alias: string };
      const userId = request.user?.userId;

      const result = await this.reverseShareService.createOrUpdateAlias(
        reverseShareId,
        alias,
        userId,
      );
      return reply.send({ alias: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async updateFile(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();
      const { fileId } = request.params as { fileId: string };
      const body = request.body as { name?: string; description?: string | null };
      const userId = request.user?.userId;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const file = await this.reverseShareService.updateReverseShareFile(fileId, body, userId);
      return reply.send({ file });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "File not found") {
        return reply.status(404).send({ error: "File not found" });
      }
      if (message === "Unauthorized to edit this file") {
        return reply.status(403).send({ error: "Unauthorized to edit this file" });
      }
      request.log.error({ err: error }, "Error in updateFile");
      return reply.status(500).send({ error: "Internal server error" });
    }
  }

  async copyFileToUserFiles(request: FastifyRequest, reply: FastifyReply) {
    try {
      await request.jwtVerify();

      const { fileId } = request.params as { fileId: string };
      const userId = request.user?.userId;

      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const file = await this.uploadService.copyReverseShareFileToUserFiles(fileId, userId);

      return reply.send({ file, message: "File copied to your files successfully" });
    } catch (error: unknown) {
      request.log.error({ err: error }, "Copy to my files: Error");
      const message = error instanceof Error ? error.message : String(error);
      if (message === "File not found") {
        return reply.status(404).send({ error: "File not found" });
      }
      if (message === "Unauthorized to copy this file") {
        return reply.status(403).send({ error: "Unauthorized to copy this file" });
      }
      if (message.includes("File size exceeds") || message.includes("Insufficient storage")) {
        return reply.status(400).send({ error: message });
      }
      return reply.status(500).send({ error: "Internal server error" });
    }
  }

  async getReverseShareMetadataByAlias(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { alias } = request.params as { alias: string };
      const metadata = await this.reverseShareService.getReverseShareMetadataByAlias(alias);
      return reply.send(metadata);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "Reverse share not found") {
        return reply.status(404).send({ error: message });
      }
      return reply.status(400).send({ error: message });
    }
  }
}
