import type { FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../env.js";
import { FieldRequirement } from "../../generated/prisma/client.js";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { prisma } from "../../shared/prisma.js";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import {
  CreateShareSchema,
  ShareAliasResponseSchema,
  ShareResponseSchema,
  UpdateShareItemsSchema,
  UpdateSharePasswordSchema,
  UpdateShareRecipientsSchema,
  UpdateShareSchema,
} from "./dto.js";
import { type ShareAccessContext, ShareService } from "./service.js";

/** Zod schema for the signed visitor identification cookie payload. */
const VisitorCookiePayload = z.object({
  alias: z.string(),
  name: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
});

/**
 * Parse a signed visitor identification cookie for the given alias.
 * Returns the parsed payload if valid, undefined otherwise.
 */
function parseVisitorCookie(
  request: FastifyRequest,
  alias: string,
): { name?: string; email?: string; alias: string } | undefined {
  const raw = request.cookies[`sv_${alias}`];
  if (!raw) return undefined;
  const unsigned = request.unsignCookie(raw);
  if (!unsigned.valid || !unsigned.value) return undefined;
  try {
    const parsed = VisitorCookiePayload.safeParse(JSON.parse(unsigned.value));
    if (!parsed.success) return undefined;
    const payload = parsed.data;
    if (payload.alias !== alias) return undefined;
    // Treat empty-content cookies as absent — both fields blank is the same as no identification
    if (!payload.name && !payload.email) return undefined;
    return {
      alias: payload.alias,
      name: payload.name ?? undefined,
      email: payload.email ?? undefined,
    };
  } catch {
    return undefined;
  }
}

const ShareAccessQuery = z.object({
  t: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .min(20)
    .max(64)
    .optional()
    .describe("Tracking token"),
});

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
      logAuditEvent({
        action: "SHARE_CREATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: share.id,
        metadata: {
          name: request.body.name ?? null,
          fileCount: request.body.files?.length ?? 0,
          folderCount: request.body.folders?.length ?? 0,
          hasPassword: !!request.body.password,
          expiration: request.body.expiration ?? null,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
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
      querystring: ShareAccessQuery,
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
      const context: ShareAccessContext = {
        trackingToken: request.query.t,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      };
      const share = await shareService.getShare(request.params.shareId, undefined, userId, context);
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
      querystring: ShareAccessQuery,
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
      const context: ShareAccessContext = {
        trackingToken: request.query.t,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      };
      const share = await shareService.getShare(
        request.params.shareId,
        request.body.password,
        userId,
        context,
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
      logAuditEvent({
        action: "SHARE_UPDATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: id,
        metadata: { fields: Object.keys(updateData) },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
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
      logAuditEvent({
        action: "SHARE_DELETE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: request.params.id,
        metadata: { name: share.name },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
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
      logAuditEvent({
        action: "SHARE_PASSWORD_UPDATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: request.params.shareId,
        metadata: { passwordCleared: !request.body.password },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
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
      logAuditEvent({
        action: "SHARE_ITEMS_ADD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: request.params.shareId,
        metadata: { fileCount: files?.length ?? 0, folderCount: folders?.length ?? 0 },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
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
      logAuditEvent({
        action: "SHARE_ITEMS_REMOVE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: request.params.shareId,
        metadata: { fileCount: files?.length ?? 0, folderCount: folders?.length ?? 0 },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
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
      // Normalize: accept either `emails` (legacy) or `recipients` (with optional name)
      const recipientList: Array<{ email: string; name?: string | null }> = request.body.recipients
        ? request.body.recipients
        : (request.body.emails ?? []).map((email: string) => ({ email }));

      const share = await shareService.addRecipients(request.params.shareId, userId, recipientList);
      const emailList = recipientList.map((r) => r.email);
      // NOTE: Recipient emails are stored in the audit log for forensics. PII retention follows
      // auditRetentionDays (default 365). If privacy requirements change, hash or redact emails here.
      logAuditEvent({
        action: "SHARE_RECIPIENT_ADD",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: request.params.shareId,
        metadata: { count: emailList.length, emails: emailList },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
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
      // For removal, extract emails from either `emails` or `recipients` fields
      const emailsToRemove: string[] =
        request.body.emails ??
        (request.body.recipients ?? []).map((r: { email: string }) => r.email);
      const share = await shareService.removeRecipients(
        request.params.shareId,
        userId,
        emailsToRemove,
      );
      // NOTE: Recipient emails are stored in the audit log for forensics. PII retention follows
      // auditRetentionDays (default 365). If privacy requirements change, hash or redact emails here.
      logAuditEvent({
        action: "SHARE_RECIPIENT_REMOVE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: request.params.shareId,
        metadata: { count: emailsToRemove.length, emails: emailsToRemove },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
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
      querystring: ShareAccessQuery,
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
        request.log.debug({ err }, "JWT verification skipped (anonymous access)");
      }
      const visitorCookie = parseVisitorCookie(request, request.params.alias);
      const context: ShareAccessContext = {
        trackingToken: request.query.t,
        visitorCookie,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      };
      const share = await shareService.getShareByAlias(
        request.params.alias,
        undefined,
        userId,
        context,
      );
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
      querystring: ShareAccessQuery,
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
        request.log.debug({ err }, "JWT verification skipped (anonymous access)");
      }
      const visitorCookie = parseVisitorCookie(request, request.params.alias);
      const context: ShareAccessContext = {
        trackingToken: request.query.t,
        visitorCookie,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      };
      const share = await shareService.getShareByAlias(
        request.params.alias,
        request.body.password,
        userId,
        context,
      );
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
        emails: z
          .array(
            z
              .string()
              .email()
              .transform((s) => s.trim().toLowerCase()),
          )
          .optional()
          .describe("Optional list of recipient emails to notify (notifies all if omitted)"),
      }),
      response: {
        200: z.object({
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
        request.body.emails,
      );
      // NOTE: Recipient emails are stored in the audit log for forensics. PII retention follows
      // auditRetentionDays (default 365). If privacy requirements change, hash or redact emails here.
      logAuditEvent({
        action: "SHARE_RECIPIENT_NOTIFY",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId,
        targetType: "share",
        targetId: request.params.shareId,
        metadata: {
          recipientCount: result.notifiedRecipients.length,
          emails: result.notifiedRecipients,
        },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      return reply.send(result);
    },
  });

  // Design note: nameFieldRequired / emailFieldRequired are intentionally included in this
  // public metadata endpoint. The frontend identification form reads them BEFORE attempting
  // access, so it can show (or skip) the name/email fields without triggering the 403
  // IDENTIFICATION_REQUIRED gate. This is intentional per spec (Section 5).
  app.route({
    method: "GET",
    url: "/shares/alias/:alias/metadata",
    config: {
      rateLimit: { max: 60, timeWindow: "1 minute" },
    },
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
          nameFieldRequired: z.nativeEnum(FieldRequirement),
          emailFieldRequired: z.nativeEnum(FieldRequirement),
        }),
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const metadata = await shareService.getShareMetadataByAlias(request.params.alias);
      return reply.send(metadata);
    },
  });

  app.route({
    method: "POST",
    url: "/shares/alias/:alias/identify",
    config: {
      csrfExempt: true,
      rateLimit: {
        max: 30,
        timeWindow: "1 hour",
        keyGenerator: (req: FastifyRequest) =>
          `${req.ip}:${(req.params as { alias: string }).alias}`,
      },
    },
    schema: {
      tags: ["Share"],
      operationId: "identifyVisitor",
      summary: "Identify visitor for a share",
      description:
        "Submit visitor name/email for shares that require identification before access. Sets a signed httpOnly cookie.",
      params: z.object({
        alias: z.string().describe("The share alias"),
      }),
      body: z
        .object({
          name: z.string().max(100).optional().describe("Visitor name"),
          email: z.string().email().max(254).optional().describe("Visitor email"),
        })
        .refine((data) => !!(data.name?.trim() || data.email?.trim()), {
          message: "At least one of name or email must be provided",
        }),
      response: {
        200: z.object({
          success: z.boolean(),
        }),
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { alias } = request.params;

      // Look up the share to check field requirements
      const metadata = await shareService.getShareMetadataByAlias(alias);

      // Validate required fields
      if (metadata.nameFieldRequired === "REQUIRED" && !request.body.name) {
        throw new ValidationError("Name is required");
      }
      if (metadata.emailFieldRequired === "REQUIRED" && !request.body.email) {
        throw new ValidationError("Email is required");
      }

      const payload = JSON.stringify({
        alias,
        name: request.body.name ?? null,
        email: request.body.email ?? null,
      });

      reply.setCookie(`sv_${alias}`, payload, {
        path: "/api",
        httpOnly: true,
        sameSite: "strict",
        secure: env.SECURE_SITE === "true",
        signed: true,
        maxAge: 86400, // 24h
      });

      return reply.send({ success: true });
    },
  });

  app.route({
    method: "GET",
    url: "/shares/:shareId/visits",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "getShareVisits",
      summary: "Get visits for a share",
      description:
        "Returns paginated visit records for a share. Only accessible by the share creator.",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      querystring: z.object({
        action: z.enum(["access", "download"]).optional().describe("Filter by visit action"),
        page: z.coerce.number().int().positive().default(1).describe("Page number"),
        limit: z.coerce.number().int().positive().max(100).default(20).describe("Results per page"),
      }),
      response: {
        200: z.object({
          visits: z.array(
            z.object({
              id: z.string(),
              shareId: z.string(),
              recipientId: z.string().nullable(),
              visitorName: z.string().nullable(),
              visitorEmail: z.string().nullable(),
              ipAddress: z.string().nullable(),
              userAgent: z.string().nullable(),
              action: z.string(),
              fileId: z.string().nullable(),
              createdAt: z.date(),
              recipient: z
                .object({
                  email: z.string(),
                  name: z.string().nullable(),
                })
                .nullable(),
              identificationSource: z
                .enum(["tracking_token", "cookie", "anonymous"])
                .describe(
                  "How the visitor was identified: tracking_token (recipient link), cookie (identification form), anonymous",
                ),
            }),
          ),
          total: z.number(),
          page: z.number(),
          limit: z.number(),
        }),
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
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

      const { shareId } = request.params;
      const { action, page, limit } = request.query;

      // Verify the requester is the share creator
      const share = await prisma.share.findUnique({ where: { id: shareId } });
      if (!share) {
        throw new NotFoundError("Share not found");
      }
      if (share.creatorId !== userId) {
        throw new ForbiddenError("Not share creator");
      }

      const where = {
        shareId,
        ...(action ? { action } : {}),
      };

      const [visits, total] = await Promise.all([
        prisma.shareVisit.findMany({
          where,
          include: { recipient: { select: { email: true, name: true } } },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
        prisma.shareVisit.count({ where }),
      ]);

      // Derive identificationSource for each visit:
      // - "tracking_token": recipientId is set (visitor arrived via a personalized link)
      // - "cookie": no recipientId, but visitorEmail or visitorName is set (identification form)
      // - "anonymous": no identification at all
      const enrichedVisits = visits.map((visit) => ({
        ...visit,
        identificationSource: visit.recipientId
          ? ("tracking_token" as const)
          : visit.visitorEmail || visit.visitorName
            ? ("cookie" as const)
            : ("anonymous" as const),
      }));

      return reply.send({ visits: enrichedVisits, total, page, limit });
    },
  });
};
