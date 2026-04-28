import { getContentType } from "@ouitransfer/shared/mime-types";
import bcrypt from "bcryptjs";
import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../../env.js";
import { prisma } from "../../shared/prisma.js";
import { FileService } from "./service.js";

export class FileDownloadController {
  private fileService = new FileService();

  async getDownloadUrl(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { objectName, password } = request.body as {
        objectName: string;
        password?: string;
      };

      if (!objectName) {
        return reply.status(400).send({ error: "The 'objectName' parameter is required." });
      }

      const fileRecord = await prisma.file.findFirst({ where: { objectName } });

      if (!fileRecord) {
        return reply.status(404).send({ error: "File not found." });
      }

      let hasAccess = false;

      const shares = await prisma.share.findMany({
        where: {
          files: {
            some: {
              id: fileRecord.id,
            },
          },
        },
        include: {
          security: true,
        },
      });

      for (const share of shares) {
        if (!share.security.password) {
          hasAccess = true;
          break;
        } else if (password) {
          const isPasswordValid = await bcrypt.compare(password, share.security.password);
          if (isPasswordValid) {
            hasAccess = true;
            break;
          }
        }
      }

      if (!hasAccess) {
        try {
          await request.jwtVerify();
          const userId = request.user?.userId;
          if (userId && fileRecord.userId === userId) {
            hasAccess = true;
          }
        } catch (_err) {
          // Expected: anonymous access for public shares — JWT verification is optional
          request.log.debug("Optional JWT verification skipped — anonymous access");
        }
      }

      if (!hasAccess) {
        return reply.status(401).send({ error: "Unauthorized access to file." });
      }

      const fileName = fileRecord.name;
      const expires = parseInt(env.PRESIGNED_URL_EXPIRATION, 10);

      // Always use presigned URLs (works for both internal and external storage)
      const url = await this.fileService.getPresignedGetUrl(objectName, expires, fileName);
      return reply.send({ url, expiresIn: expires });
    } catch (error) {
      request.log.error({ err: error }, "Error in getDownloadUrl");
      return reply.status(500).send({ error: "Internal server error." });
    }
  }

  async downloadFile(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Password moved from query param to request body (security: passwords must not appear in URLs)
      const { objectName, password } = request.body as {
        objectName: string;
        password?: string;
      };

      if (!objectName) {
        return reply.status(400).send({ error: "The 'objectName' parameter is required." });
      }

      const fileRecord = await prisma.file.findFirst({ where: { objectName } });

      if (!fileRecord) {
        if (objectName.startsWith("reverse-shares/")) {
          const reverseShareFile = await prisma.reverseShareFile.findFirst({
            where: { objectName },
            include: {
              reverseShare: true,
            },
          });

          if (!reverseShareFile) {
            return reply.status(404).send({ error: "File not found." });
          }

          try {
            await request.jwtVerify();
            const userId = request.user?.userId;

            if (!userId || reverseShareFile.reverseShare.creatorId !== userId) {
              return reply.status(401).send({ error: "Unauthorized access to file." });
            }
          } catch (err) {
            request.log.debug({ err }, "JWT verification failed for reverse-share download");
            return reply.status(401).send({ error: "Unauthorized access to file." });
          }

          // Stream from S3/storage system
          const stream = await this.fileService.getObjectStream(objectName);
          const contentType = getContentType(reverseShareFile.name);
          const fileName = reverseShareFile.name;

          reply.header("Content-Type", contentType);
          reply.header(
            "Content-Disposition",
            `inline; filename="${encodeURIComponent(fileName)}"`,
          );
          reply.header("Content-Length", reverseShareFile.size.toString());

          return reply.send(stream);
        }

        return reply.status(404).send({ error: "File not found." });
      }

      let hasAccess = false;

      const shares = await prisma.share.findMany({
        where: {
          files: {
            some: {
              id: fileRecord.id,
            },
          },
        },
        include: {
          security: true,
        },
      });

      for (const share of shares) {
        if (!share.security.password) {
          hasAccess = true;
          break;
        } else if (password) {
          const isPasswordValid = await bcrypt.compare(password, share.security.password);
          if (isPasswordValid) {
            hasAccess = true;
            break;
          }
        }
      }

      if (!hasAccess) {
        try {
          await request.jwtVerify();
          const userId = request.user?.userId;
          if (userId && fileRecord.userId === userId) {
            hasAccess = true;
          }
        } catch (_err) {
          // Expected: anonymous access for public shares — JWT verification is optional
          request.log.debug("Optional JWT verification skipped — anonymous access");
        }
      }

      if (!hasAccess) {
        return reply.status(401).send({ error: "Unauthorized access to file." });
      }

      // Stream from S3/MinIO
      const stream = await this.fileService.getObjectStream(objectName);
      const contentType = getContentType(fileRecord.name);
      const fileName = fileRecord.name;

      reply.header("Content-Type", contentType);
      reply.header("Content-Disposition", `inline; filename="${encodeURIComponent(fileName)}"`);
      reply.header("Content-Length", fileRecord.size.toString());

      return reply.send(stream);
    } catch (error) {
      request.log.error({ err: error }, "Error in downloadFile");
      return reply.status(500).send({ error: "Internal server error." });
    }
  }
}
