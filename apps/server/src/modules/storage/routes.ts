import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { UnauthorizedError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { StorageService } from "./service.js";

const storageService = new StorageService();

export const storageRoutes: FastifyPluginAsyncZod = async (app) => {
  const preValidation = async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch (_err) {
      throw new UnauthorizedError("Unauthorized: a valid token is required.");
    }
  };

  app.route({
    method: "GET",
    url: "/storage/disk-space",
    schema: {
      tags: ["Storage"],
      operationId: "getDiskSpace",
      summary: "Get server disk space information",
      description: "Get server disk space information",
      response: {
        200: z.object({
          kind: z.enum(["admin", "user"]).describe("Discriminator: 'admin' or 'user' disk space"),
          diskSizeGB: z
            .number()
            .describe("Total storage in GB (quota limit for users, disk for admins)"),
          diskUsedGB: z.number().describe("Storage used in GB"),
          diskAvailableGB: z.number().describe("Storage available in GB (-1 = unlimited)"),
          uploadAllowed: z.boolean().describe("Whether file upload is allowed"),
          warningLevel: z
            .enum(["none", "warning", "critical", "exceeded"])
            .optional()
            .describe("Quota warning level (users only)"),
          maxFileSize: z
            .number()
            .optional()
            .describe("Max single file size in bytes (0 = unlimited, users only)"),
          percentage: z.number().optional().describe("Percentage of quota used (users only)"),
        }),
        401: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    preValidation,
    handler: async (request, reply) => {
      const diskSpace = await storageService.getDiskSpace(
        request.user.userId,
        request.user.isAdmin || false,
      );
      return reply.send(diskSpace);
    },
  });

  app.route({
    method: "GET",
    url: "/storage/check-upload",
    schema: {
      tags: ["Storage"],
      operationId: "checkUploadAllowed",
      summary: "Check if file upload is allowed",
      description: "Check if file upload is allowed based on available space (fileSize in bytes)",
      querystring: z.object({
        fileSize: z.string().describe("The file size in bytes"),
      }),
      response: {
        200: z.object({
          kind: z.enum(["admin", "user"]).describe("Discriminator: 'admin' or 'user' disk space"),
          diskSizeGB: z
            .number()
            .describe("Total storage in GB (quota limit for users, disk for admins)"),
          diskUsedGB: z.number().describe("Storage used in GB"),
          diskAvailableGB: z.number().describe("Storage available in GB (-1 = unlimited)"),
          uploadAllowed: z.boolean().describe("Whether file upload is allowed"),
          warningLevel: z
            .enum(["none", "warning", "critical", "exceeded"])
            .optional()
            .describe("Quota warning level (users only)"),
          maxFileSize: z
            .number()
            .optional()
            .describe("Max single file size in bytes (0 = unlimited, users only)"),
          percentage: z.number().optional().describe("Percentage of quota used (users only)"),
          fileSizeInfo: z.object({
            bytes: z.number(),
            kb: z.number(),
            mb: z.number(),
            gb: z.number(),
          }),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    preValidation,
    handler: async (request, reply) => {
      const result = await storageService.checkUploadAllowed(
        Number(request.query.fileSize),
        request.user.userId,
      );
      return reply.send(result);
    },
  });
};
