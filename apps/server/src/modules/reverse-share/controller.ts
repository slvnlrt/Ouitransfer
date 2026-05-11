import type { FastifyReply, FastifyRequest } from "fastify";

import {
  AppError,
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import {
  CreateReverseShareSchema,
  ReverseSharePasswordSchema,
  UpdateReverseSharePasswordSchema,
  UpdateReverseShareSchema,
  UploadToReverseShareSchema,
} from "./dto.js";
import { ReverseShareService } from "./service.js";
import { ReverseShareUploadService } from "./upload.service.js";

/**
 * Maps common reverse-share service errors (thrown as plain Error with specific messages)
 * to appropriate AppError subclasses. If the error doesn't match any known pattern,
 * re-throws the original error to let the global handler produce a 500.
 */
function mapReverseShareError(error: unknown): never {
  if (error instanceof AppError) throw error;
  const message = error instanceof Error ? error.message : String(error);

  if (message === "Reverse share not found") throw new NotFoundError(message);
  if (message === "Reverse share is inactive") throw new ForbiddenError(message);
  if (message === "Reverse share has expired") throw new GoneError(message);
  if (message === "Password required" || message === "Invalid password") {
    throw new UnauthorizedError(message);
  }
  if (message === "Maximum number of files reached") throw new ForbiddenError(message);
  if (message.includes("File type") && message.includes("not allowed")) {
    throw new ValidationError(message);
  }
  if (message === "File size exceeds limit") throw new ValidationError(message);
  if (message === "File not found") throw new NotFoundError(message);
  if (message.includes("Unauthorized to")) throw new UnauthorizedError(message);
  if (message.includes("File size exceeds") || message.includes("Insufficient storage")) {
    throw new ValidationError(message);
  }

  throw error;
}

export class ReverseShareController {
  private reverseShareService = new ReverseShareService();
  private uploadService = new ReverseShareUploadService();

  async createReverseShare(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const input = CreateReverseShareSchema.parse(request.body);
    const reverseShare = await this.reverseShareService.createReverseShare(input, userId);
    return reply.status(201).send({ reverseShare });
  }

  async listUserReverseShares(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const reverseShares = await this.reverseShareService.listUserReverseShares(userId);
    return reply.send({ reverseShares });
  }

  async getReverseShare(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };
    try {
      const reverseShare = await this.reverseShareService.getReverseShareById(id, userId);
      return reply.send({ reverseShare });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async getReverseShareForUpload(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const password = (request.body as { password?: string } | null)?.password;

    try {
      const reverseShare = await this.reverseShareService.getReverseShareForUpload(id, password);
      return reply.send({ reverseShare });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async getReverseShareForUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    const password = (request.body as { password?: string } | null)?.password;

    try {
      const reverseShare = await this.reverseShareService.getReverseShareForUploadByAlias(
        alias,
        password,
      );
      return reply.send({ reverseShare });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async updateReverseShare(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id, ...updateData } = UpdateReverseShareSchema.parse(request.body);
    try {
      const reverseShare = await this.reverseShareService.updateReverseShare(
        id,
        updateData,
        userId,
      );
      return reply.send({ reverseShare });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async updatePassword(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };
    const { password } = UpdateReverseSharePasswordSchema.parse(request.body);

    const updateData: { password?: string | null } = { password };
    try {
      const reverseShare = await this.reverseShareService.updateReverseShare(
        id,
        updateData,
        userId,
      );
      return reply.send({ reverseShare });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async deleteReverseShare(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };
    try {
      const reverseShare = await this.reverseShareService.deleteReverseShare(id, userId);
      return reply.send({ reverseShare });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async getPresignedUrl(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    // Password moved from query param to request body (security: passwords must not appear in URLs)
    const { filename, extension, password } = request.body as {
      filename: string;
      extension: string;
      password?: string;
    };

    try {
      const result = await this.uploadService.getPresignedUrl(id, filename, extension, password);
      return reply.send(result);
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async getPresignedUrlByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    // Password moved from query param to request body (security: passwords must not appear in URLs)
    const { filename, extension, password } = request.body as {
      filename: string;
      extension: string;
      password?: string;
    };

    try {
      const result = await this.uploadService.getPresignedUrlByAlias(
        alias,
        filename,
        extension,
        password,
      );
      return reply.send(result);
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async registerFileUpload(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    // Password moved from query param to request body (security: passwords must not appear in URLs)
    const { password, ...bodyWithoutPassword } = request.body as {
      password?: string;
      [key: string]: unknown;
    };
    const fileData = UploadToReverseShareSchema.parse(bodyWithoutPassword);

    try {
      const file = await this.uploadService.registerFileUpload(id, fileData, password);
      return reply.status(201).send({ file });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async registerFileUploadByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    // Password moved from query param to request body (security: passwords must not appear in URLs)
    const { password, ...bodyWithoutPassword } = request.body as {
      password?: string;
      [key: string]: unknown;
    };
    const fileData = UploadToReverseShareSchema.parse(bodyWithoutPassword);

    try {
      const file = await this.uploadService.registerFileUploadByAlias(alias, fileData, password);
      return reply.status(201).send({ file });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async downloadFile(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { fileId } = request.params as { fileId: string };

    // Pass request context for internal storage proxy URLs
    const requestContext = { protocol: "https", host: "localhost" }; // Simplified - frontend will handle the real URL

    try {
      const result = await this.reverseShareService.downloadReverseShareFile(
        fileId,
        userId,
        requestContext,
      );
      return reply.send(result);
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async deleteFile(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { fileId } = request.params as { fileId: string };
    try {
      const file = await this.reverseShareService.deleteReverseShareFile(fileId, userId);
      return reply.send({ file });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async checkPassword(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const { password } = ReverseSharePasswordSchema.parse(request.body);

    try {
      const result = await this.reverseShareService.checkPassword(id, password);
      return reply.send(result);
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async activateReverseShare(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };
    try {
      const reverseShare = await this.reverseShareService.activateReverseShare(id, userId);
      return reply.send({ reverseShare });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async deactivateReverseShare(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError(
        "Unauthorized: a valid token is required to access this resource.",
      );
    }

    const { id } = request.params as { id: string };
    try {
      const reverseShare = await this.reverseShareService.deactivateReverseShare(id, userId);
      return reply.send({ reverseShare });
    } catch (error) {
      mapReverseShareError(error);
    }
  }

  async createOrUpdateAlias(request: FastifyRequest, reply: FastifyReply) {
    const { reverseShareId } = request.params as { reverseShareId: string };
    const { alias } = request.body as { alias: string };
    const userId = request.user?.userId;

    const result = await this.reverseShareService.createOrUpdateAlias(
      reverseShareId,
      alias,
      userId,
    );
    return reply.send({ alias: result });
  }

  async updateFile(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const { fileId } = request.params as { fileId: string };
    const body = request.body as { name?: string; description?: string | null };
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError();
    }

    try {
      const file = await this.reverseShareService.updateReverseShareFile(fileId, body, userId);
      return reply.send({ file });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "File not found") {
        throw new NotFoundError("File not found");
      }
      if (message === "Unauthorized to edit this file") {
        throw new ForbiddenError("Unauthorized to edit this file");
      }
      throw error;
    }
  }

  async copyFileToUserFiles(request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();

    const { fileId } = request.params as { fileId: string };
    const userId = request.user?.userId;

    if (!userId) {
      throw new UnauthorizedError();
    }

    try {
      const file = await this.uploadService.copyReverseShareFileToUserFiles(fileId, userId);
      return reply.send({ file, message: "File copied to your files successfully" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === "File not found") {
        throw new NotFoundError("File not found");
      }
      if (message === "Unauthorized to copy this file") {
        throw new ForbiddenError("Unauthorized to copy this file");
      }
      if (message.includes("File size exceeds") || message.includes("Insufficient storage")) {
        throw new ValidationError(message);
      }
      throw error;
    }
  }

  async getReverseShareMetadataByAlias(request: FastifyRequest, reply: FastifyReply) {
    const { alias } = request.params as { alias: string };
    try {
      const metadata = await this.reverseShareService.getReverseShareMetadataByAlias(alias);
      return reply.send(metadata);
    } catch (error) {
      mapReverseShareError(error);
    }
  }
}
