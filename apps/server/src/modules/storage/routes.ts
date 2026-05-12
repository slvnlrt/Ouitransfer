import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { UnauthorizedError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { StorageController } from "./controller.js";

export async function storageRoutes(app: FastifyInstance) {
  const storageController = new StorageController();

  const preValidation = async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch (_err) {
      throw new UnauthorizedError("Unauthorized: a valid token is required.");
    }
  };

  app.get(
    "/storage/disk-space",
    {
      preValidation,
      schema: {
        tags: ["Storage"],
        operationId: "getDiskSpace",
        summary: "Get server disk space information",
        description: "Get server disk space information",
        response: {
          200: z.object({
            diskSizeGB: z.number().describe("The server disk size in GB"),
            diskUsedGB: z.number().describe("The server disk used in GB"),
            diskAvailableGB: z.number().describe("The server disk available in GB"),
            uploadAllowed: z.boolean().describe("Whether file upload is allowed"),
          }),
          401: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    storageController.getDiskSpace.bind(storageController),
  );

  app.get(
    "/storage/check-upload",
    {
      preValidation,
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
            diskSizeGB: z.number().describe("The server disk size in GB"),
            diskUsedGB: z.number().describe("The server disk used in GB"),
            diskAvailableGB: z.number().describe("The server disk available in GB"),
            uploadAllowed: z.boolean().describe("Whether file upload is allowed"),
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
    },
    storageController.checkUploadAllowed.bind(storageController),
  );
}
