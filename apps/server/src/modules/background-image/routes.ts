import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ValidationError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import {
  BackgroundImageResponseSchema,
  ReorderBackgroundImagesSchema,
  UpdateBackgroundImageSchema,
} from "./dto.js";
import { BackgroundImageService, MAX_RAW_SIZE } from "./service.js";

const service = new BackgroundImageService();
const adminPreValidation = createAdminPreValidation({ allowSetupBypass: false });

export const backgroundImageRoutes: FastifyPluginAsyncZod = async (app) => {
  // GET /background-images — Public list with presigned thumbnail URLs
  app.route({
    method: "GET",
    url: "/background-images",
    schema: {
      tags: ["BackgroundImages"],
      operationId: "listBackgroundImages",
      summary: "List all background images",
      response: {
        200: z.object({ images: z.array(BackgroundImageResponseSchema) }),
        400: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const images = await service.listAll();
      return reply.send({ images });
    },
  });

  // POST /background-images — Admin upload
  app.route({
    method: "POST",
    url: "/background-images",
    preValidation: adminPreValidation,
    schema: {
      tags: ["BackgroundImages"],
      operationId: "uploadBackgroundImage",
      summary: "Upload a background image (admin only)",
      response: {
        200: z.object({ image: BackgroundImageResponseSchema }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    // NOTE: Multipart fields must be sent BEFORE the file field.
    // The 'name' field is read from file.fields, which only contains
    // fields that appeared before the file in the multipart stream.
    handler: async (request, reply) => {
      const file = await request.file();
      if (!file) {
        throw new ValidationError("No file uploaded");
      }

      if (!file.mimetype.startsWith("image/")) {
        throw new ValidationError("Only image files are allowed");
      }

      // Read the optional 'name' field from multipart
      const nameField = file.fields?.name;
      const name =
        nameField && "value" in nameField ? (nameField.value as string) || undefined : undefined;

      const chunks: Buffer[] = [];
      const maxSize = MAX_RAW_SIZE;
      let totalSize = 0;

      for await (const chunk of file.file) {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          throw new ValidationError(
            `Image file too large. Maximum size is ${MAX_RAW_SIZE / 1024 / 1024}MB.`,
          );
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const image = await service.upload(buffer, file.filename, name);
      logAuditEvent({
        userId: request.user?.userId,
        action: "BACKGROUND_IMAGE_UPLOAD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "background_image",
        targetId: image.id,
        metadata: { name: image.name },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ image });
    },
  });

  // PATCH /background-images/order — Admin reorder (must be registered before :id to avoid route conflict)
  app.route({
    method: "PATCH",
    url: "/background-images/order",
    preValidation: adminPreValidation,
    schema: {
      tags: ["BackgroundImages"],
      operationId: "reorderBackgroundImages",
      summary: "Reorder background images (admin only)",
      body: ReorderBackgroundImagesSchema,
      response: {
        200: z.object({ success: z.boolean() }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      await service.reorder(request.body.ids);
      return reply.send({ success: true });
    },
  });

  // PATCH /background-images/:id — Admin rename
  app.route({
    method: "PATCH",
    url: "/background-images/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["BackgroundImages"],
      operationId: "updateBackgroundImage",
      summary: "Update background image name (admin only)",
      params: z.object({ id: z.string() }),
      body: UpdateBackgroundImageSchema,
      response: {
        200: z.object({ image: BackgroundImageResponseSchema }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const image = await service.rename(request.params.id, request.body.name);
      return reply.send({ image });
    },
  });

  // DELETE /background-images/:id — Admin delete
  app.route({
    method: "DELETE",
    url: "/background-images/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["BackgroundImages"],
      operationId: "deleteBackgroundImage",
      summary: "Delete a background image (admin only)",
      params: z.object({ id: z.string() }),
      response: {
        200: z.object({ success: z.boolean() }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      // Fetch the image record before deletion to capture its name for audit metadata
      const image = await service.findById(request.params.id);
      await service.delete(request.params.id);
      logAuditEvent({
        userId: request.user?.userId,
        action: "BACKGROUND_IMAGE_DELETE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "background_image",
        targetId: request.params.id,
        metadata: { fileName: image?.name ?? null },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send({ success: true });
    },
  });
};
