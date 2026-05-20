import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { NotFoundError, UnauthorizedError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import {
  CreateShareSchema,
  ShareAliasResponseSchema,
  ShareResponseSchema,
  UpdateShareItemsSchema,
  UpdateSharePasswordSchema,
  UpdateShareRecipientsSchema,
  UpdateShareSchema,
} from "./dto.js";
import { ShareService } from "./service.js";

const shareService = new ShareService();

const preValidation = createJwtPreValidation();

export const shareRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "POST",
    url: "/shares",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "createShare",
      summary: "Create a new share",
      description: "Create a new share with files and/or folders",
      body: CreateShareSchema,
      response: {
        201: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const share = await shareService.createShare(request.body, userId);
      return reply.status(201).send({ share });
    },
  });

  app.route({
    method: "GET",
    url: "/shares/me",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "listUserShares",
      summary: "List all shares created by the authenticated user",
      description: "List all shares created by the authenticated user",
      response: {
        200: z.object({
          shares: z.array(ShareResponseSchema),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const shares = await shareService.listUserShares(userId);
      return reply.send({ shares });
    },
  });

  app.route({
    method: "GET",
    url: "/shares/:shareId",
    schema: {
      tags: ["Share"],
      operationId: "getShare",
      summary: "Get a share by ID",
      description:
        "Get a share by ID. For password-protected shares use POST /shares/:shareId/access instead.",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      let userId: string | undefined;
      try {
        await request.jwtVerify();
        userId = request.user?.userId;
      } catch (err) {
        // JWT verification failure is expected for unauthenticated share access
        request.log.debug({ err }, "JWT verification skipped (anonymous access)");
      }
      const share = await shareService.getShare(request.params.shareId, undefined, userId);
      return reply.send({ share });
    },
  });

  app.route({
    method: "POST",
    url: "/shares/:shareId/access",
    config: { csrfExempt: true },
    schema: {
      tags: ["Share"],
      operationId: "accessShareWithPassword",
      summary: "Access a password-protected share",
      description:
        "Access a password-protected share by providing the password in the request body. Passwords must never be sent as query parameters.",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      body: z.object({
        password: z.string().min(1, "Password is required").describe("The share password"),
      }),
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      let userId: string | undefined;
      try {
        await request.jwtVerify();
        userId = request.user?.userId;
      } catch (err) {
        // JWT verification failure is expected for unauthenticated share access
        request.log.debug({ err }, "JWT verification skipped (anonymous access)");
      }
      const share = await shareService.getShare(
        request.params.shareId,
        request.body.password,
        userId,
      );
      return reply.send({ share });
    },
  });

  app.route({
    method: "PUT",
    url: "/shares",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "updateShare",
      summary: "Update a share",
      description: "Update a share",
      body: UpdateShareSchema,
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }
      const { id, ...updateData } = request.body;
      const share = await shareService.updateShare(id, updateData, userId);
      return reply.send({ share });
    },
  });

  app.route({
    method: "DELETE",
    url: "/shares/:id",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "deleteShare",
      summary: "Delete a share",
      description: "Delete a share",
      params: z.object({
        id: z.string().describe("The share ID"),
      }),
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const share = await shareService.findShareById(request.params.id);
      if (!share) {
        throw new NotFoundError("Share not found");
      }
      if (share.creatorId !== userId) {
        throw new UnauthorizedError("Unauthorized to delete this share");
      }
      const deleted = await shareService.deleteShare(request.params.id);
      return reply.send({ share: deleted });
    },
  });

  app.route({
    method: "PATCH",
    url: "/shares/:shareId/password",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "updateSharePassword",
      summary: "Update share password",
      params: z.object({
        shareId: z.string(),
      }),
      body: UpdateSharePasswordSchema,
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const share = await shareService.updateSharePassword(
        request.params.shareId,
        userId,
        request.body.password,
      );
      return reply.send({ share });
    },
  });

  app.route({
    method: "POST",
    url: "/shares/:shareId/items",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "addItems",
      summary: "Add files and/or folders to share",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      body: UpdateShareItemsSchema,
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const { files, folders } = request.body;
      const share = await shareService.addItemsToShare(
        request.params.shareId,
        userId,
        files || [],
        folders || [],
      );
      return reply.send({ share });
    },
  });

  app.route({
    method: "DELETE",
    url: "/shares/:shareId/items",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "removeItems",
      summary: "Remove files and/or folders from share",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      body: UpdateShareItemsSchema,
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const { files, folders } = request.body;
      const share = await shareService.removeItemsFromShare(
        request.params.shareId,
        userId,
        files || [],
        folders || [],
      );
      return reply.send({ share });
    },
  });

  app.route({
    method: "POST",
    url: "/shares/:shareId/recipients",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "addRecipients",
      summary: "Add recipients to a share",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      body: UpdateShareRecipientsSchema,
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const share = await shareService.addRecipients(
        request.params.shareId,
        userId,
        request.body.emails,
      );
      return reply.send({ share });
    },
  });

  app.route({
    method: "DELETE",
    url: "/shares/:shareId/recipients",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "removeRecipients",
      summary: "Remove recipients from a share",
      description: "Remove recipients from a share",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      body: UpdateShareRecipientsSchema,
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const share = await shareService.removeRecipients(
        request.params.shareId,
        userId,
        request.body.emails,
      );
      return reply.send({ share });
    },
  });

  app.route({
    method: "POST",
    url: "/shares/:shareId/alias",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "createShareAlias",
      summary: "Create or update share alias",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      body: z.object({
        alias: z
          .string()
          .regex(/^[a-zA-Z0-9]+$/, "Alias must contain only letters and numbers")
          .min(3, "Alias must be at least 3 characters long")
          .max(30, "Alias must not exceed 30 characters"),
      }),
      response: {
        200: z.object({
          alias: ShareAliasResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await shareService.createOrUpdateAlias(
        request.params.shareId,
        request.body.alias,
        request.user?.userId,
      );
      return reply.send({ alias: result });
    },
  });

  app.route({
    method: "GET",
    url: "/shares/alias/:alias",
    schema: {
      tags: ["Share"],
      operationId: "getShareByAlias",
      summary: "Get share by alias",
      description:
        "Get a share by alias. For password-protected shares use POST /shares/alias/:alias/access instead.",
      params: z.object({
        alias: z.string().describe("The share alias"),
      }),
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const share = await shareService.getShareByAlias(request.params.alias, undefined);
      return reply.send({ share });
    },
  });

  app.route({
    method: "POST",
    url: "/shares/alias/:alias/access",
    config: { csrfExempt: true },
    schema: {
      tags: ["Share"],
      operationId: "accessShareByAliasWithPassword",
      summary: "Access a password-protected share by alias",
      description:
        "Access a password-protected share by alias, providing the password in the request body. Passwords must never be sent as query parameters.",
      params: z.object({
        alias: z.string().describe("The share alias"),
      }),
      body: z.object({
        password: z.string().min(1, "Password is required").describe("The share password"),
      }),
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const share = await shareService.getShareByAlias(request.params.alias, request.body.password);
      return reply.send({ share });
    },
  });

  app.route({
    method: "POST",
    url: "/shares/:shareId/notify",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "notifyRecipients",
      summary: "Send email notification to share recipients",
      description: "Send email notification with share link to all recipients",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      body: z.object({
        shareLink: z.string().url().describe("The frontend share URL"),
      }),
      response: {
        200: z.object({
          message: z.string().describe("Success message"),
          notifiedRecipients: z.array(z.string()).describe("List of notified email addresses"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      const result = await shareService.notifyRecipients(
        request.params.shareId,
        userId,
        request.body.shareLink,
      );
      return reply.send(result);
    },
  });

  app.route({
    method: "GET",
    url: "/shares/alias/:alias/metadata",
    schema: {
      tags: ["Share"],
      operationId: "getShareMetadataByAlias",
      summary: "Get share metadata by alias for Open Graph",
      description: "Get lightweight metadata for a share by alias, used for social media previews",
      params: z.object({
        alias: z.string().describe("The share alias"),
      }),
      response: {
        200: z.object({
          name: z.string().nullable(),
          description: z.string().nullable(),
          totalFiles: z.number(),
          totalFolders: z.number(),
          hasPassword: z.boolean(),
          isExpired: z.boolean(),
          isMaxViewsReached: z.boolean(),
        }),
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const metadata = await shareService.getShareMetadataByAlias(request.params.alias);
      return reply.send(metadata);
    },
  });
};
