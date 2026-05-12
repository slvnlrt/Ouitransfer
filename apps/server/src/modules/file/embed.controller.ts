import { getContentType } from "@ouitransfer/shared/mime-types";
import type { FastifyReply, FastifyRequest } from "fastify";

import { prisma } from "../../shared/prisma.js";
import {
  ForbiddenError,
  GoneError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import { createEmbedToken, verifyEmbedToken } from "./embed-token.js";
import { FileService } from "./service.js";

export class FileEmbedController {
  private fileService = new FileService();

  async embedFile(request: FastifyRequest, reply: FastifyReply) {
    const { token } = request.params as { token: string };

    if (!token) {
      throw new ValidationError("Embed token is required.");
    }

    // Verify the signed embed token
    let fileId: string, shareId: string;
    try {
      ({ fileId, shareId } = await verifyEmbedToken(token));
    } catch {
      throw new UnauthorizedError("Invalid or expired embed token.");
    }

    // Verify the share still exists and contains this file
    const share = await prisma.share.findUnique({
      where: { id: shareId },
      include: {
        files: { where: { id: fileId }, select: { id: true } },
        security: true,
      },
    });

    if (!share || share.files.length === 0) {
      throw new NotFoundError("File not found or share revoked.");
    }

    // Check share expiration
    if (share.expiration && new Date(share.expiration) < new Date()) {
      throw new GoneError("Share has expired.");
    }

    // Block embed access if the share requires a password
    if (share.security?.password) {
      throw new ForbiddenError("This share requires password access.");
    }

    // Block embed access if the share has reached its view limit
    if (share.security?.maxViews !== null && share.security?.maxViews !== undefined) {
      const result = await prisma.share.updateMany({
        where: { id: share.id, views: { lt: share.security.maxViews } },
        data: { views: { increment: 1 } },
      });
      if (result.count === 0) {
        throw new GoneError("Share view limit reached.");
      }
    }

    // Load the file record
    const fileRecord = await prisma.file.findUnique({ where: { id: fileId } });
    if (!fileRecord) {
      throw new NotFoundError("File not found.");
    }

    // Media type check
    const extension = fileRecord.extension.toLowerCase();
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "bmp", "ico", "avif"];
    const videoExts = ["mp4", "webm", "ogg", "mov", "avi", "mkv", "flv", "wmv"];
    const audioExts = ["mp3", "wav", "ogg", "m4a", "flac", "aac", "wma"];
    const isMedia =
      imageExts.includes(extension) ||
      videoExts.includes(extension) ||
      audioExts.includes(extension);

    if (!isMedia) {
      throw new ForbiddenError("Embed is only allowed for media files.");
    }

    // Stream from S3 storage
    const stream = await this.fileService.getObjectStream(fileRecord.objectName);
    const contentType = getContentType(fileRecord.name);

    reply.header("Content-Type", contentType);
    reply.header(
      "Content-Disposition",
      `inline; filename="${encodeURIComponent(fileRecord.name)}"`,
    );
    reply.header("Content-Length", fileRecord.size.toString());
    reply.header("Cache-Control", "public, max-age=86400");

    return reply.send(stream);
  }

  async generateEmbedToken(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const { fileId, shareId } = request.body as { fileId: string; shareId: string };

    // Verify the share exists, belongs to user, and contains this file
    const share = await prisma.share.findFirst({
      where: {
        id: shareId,
        creatorId: userId,
        files: { some: { id: fileId } },
      },
    });

    if (!share) {
      throw new ForbiddenError("Access denied: share not found or file not in share.");
    }

    const token = await createEmbedToken(fileId, shareId);
    return reply.send({ token, embedUrl: `/embed/${token}` });
  }
}
