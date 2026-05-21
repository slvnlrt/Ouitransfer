import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ValidationError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import {
  BackgroundImageResponseSchema,
  ReorderBackgroundImagesSchema,
  UpdateBackgroundImageSchema,
} from "./dto.js";
import { BackgroundImageService } from "./service.js";

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

  // GET /background-images/:id/image — Public redirect to presigned URL
  app.route({
    method: "GET",
    url: "/background-images/:id/image",
    schema: {
      tags: ["BackgroundImages"],
      operationId: "getBackgroundImage",
      summary: "Get background image (redirect to S3)",
      params: z.object({ id: z.string() }),
      querystring: z.object({
        type: z.enum(["full", "thumb"]).default("full"),
      }),
      response: {
        302: z.never(),
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const url = await service.getImageUrl(request.params.id, request.query.type);
      return reply.redirect(url);
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
      const maxSize = 10 * 1024 * 1024;
      let totalSize = 0;

      for await (const chunk of file.file) {
        totalSize += chunk.length;
        if (totalSize > maxSize) {
          throw new ValidationError("Image file too large. Maximum size is 10MB.");
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const image = await service.upload(buffer, file.filename, name);
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
      const image = await service.rename(request.params.id, request.body.name ?? "");
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
      await service.delete(request.params.id);
      return reply.send({ success: true });
    },
  });
};
