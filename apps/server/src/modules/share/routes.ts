import type { FastifyReply, FastifyRequest } from "fastify";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../env.js";
import { FieldRequirement } from "../../generated/prisma/client.js";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { aliasSchema } from "../../shared/alias-schema.js";
import { prisma } from "../../shared/prisma.js";
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "../../utils/app-error.js";
import { getClientInfo } from "../../utils/auth-cookies.js";
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
import {
  buildVisitorCookiePayload,
  parseVisitorCookie,
  type VisitorIdentity,
} from "./visitor-cookie.js";

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

/**
 * Signed visitor identification cookie options. Kept in one place so the identification form
 * (`/identify`) and the access-time recipientId refresh stay byte-for-byte consistent.
 * Path is "/api" per spec (Section 8): the browser always sees /api/* URLs (dev proxy +
 * production Traefik), and the cookie path is matched against the browser-sent URL.
 */
function visitorCookieOptions() {
  return {
    path: "/api",
    httpOnly: true,
    sameSite: "strict",
    secure: env.SECURE_SITE === "true",
    signed: true,
    maxAge: 86400, // 24h
  } as const;
}

/**
 * After a share access resolved a token-verified recipient, refresh the signed visitor cookie so
 * the verified `recipientId` is carried to later downloads (which never see the ?t= token).
 * No-op when nothing was resolved. Preserves any existing self-declared name/email in the cookie.
 */
function refreshVisitorCookieWithRecipient(
  reply: FastifyReply,
  alias: string,
  recipientIdForCookie: string | undefined,
  existingCookie: VisitorIdentity | undefined,
): void {
  if (!recipientIdForCookie) return;
  // Already present with the same id — nothing to rewrite.
  if (existingCookie?.recipientId === recipientIdForCookie) return;
  reply.setCookie(
    `sv_${alias}`,
    buildVisitorCookiePayload({
      alias,
      name: existingCookie?.name ?? null,
      email: existingCookie?.email ?? null,
      recipientId: recipientIdForCookie,
    }),
    visitorCookieOptions(),
  );
}

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
      // Resolve the share's alias so we can parse the visitor identification cookie (sv_{alias}).
      // The alias lookup is indexed (unique constraint) and avoids coupling the service layer
      // to Fastify's cookie API.
      const shareAlias = await prisma.shareAlias.findUnique({
        where: { shareId: request.params.shareId },
        select: { alias: true },
      });
      const visitorCookie = shareAlias ? parseVisitorCookie(request, shareAlias.alias) : undefined;
      const context: ShareAccessContext = {
        trackingToken: request.query.t,
        visitorCookie,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        out: {},
      };
      const share = await shareService.getShare(request.params.shareId, undefined, userId, context);
      if (shareAlias) {
        refreshVisitorCookieWithRecipient(
          reply,
          shareAlias.alias,
          context.out?.recipientIdForCookie,
          visitorCookie,
        );
      }
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
      // Resolve alias for visitor cookie parsing (same pattern as GET /shares/:shareId above)
      const shareAlias = await prisma.shareAlias.findUnique({
        where: { shareId: request.params.shareId },
        select: { alias: true },
      });
      const visitorCookie = shareAlias ? parseVisitorCookie(request, shareAlias.alias) : undefined;
      const context: ShareAccessContext = {
        trackingToken: request.query.t,
        visitorCookie,
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        out: {},
      };
      const share = await shareService.getShare(
        request.params.shareId,
        request.body.password,
        userId,
        context,
      );
      if (shareAlias) {
        refreshVisitorCookieWithRecipient(
          reply,
          shareAlias.alias,
          context.out?.recipientIdForCookie,
          visitorCookie,
        );
      }
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
      const share = await shareService.updateShare(id, updateData, userId, {
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      });
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
    method: "PATCH",
    url: "/shares/:shareId/pause",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "pauseShare",
      summary: "Pause a share",
      description:
        "Manually deactivate (pause) a share so it can no longer be accessed. Only the share creator can pause it. The share is set inactive with reason `manual`; manual pauses are never auto-deleted by the cleanup sweep. Resume with PATCH /shares/:shareId/resume.",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
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
      const share = await shareService.pauseShare(
        request.params.shareId,
        userId,
        getClientInfo(request),
      );
      return reply.send({ share });
    },
  });

  app.route({
    method: "PATCH",
    url: "/shares/:shareId/resume",
    preValidation,
    schema: {
      tags: ["Share"],
      operationId: "resumeShare",
      summary: "Resume a paused share",
      description:
        "Reactivate a manually-paused share. Only the share creator can resume it. Refused with 400 if the share is still expired or has reached its view limit — extend the expiration or raise maxViews via PUT /shares instead, which also reactivates it.",
      params: z.object({
        shareId: z.string().describe("The share ID"),
      }),
      response: {
        200: z.object({
          share: ShareResponseSchema,
        }),
        400: ErrorResponseSchema,
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
      const share = await shareService.resumeShare(
        request.params.shareId,
        userId,
        getClientInfo(request),
      );
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
      // TODO: When data-subject deletion ships, sweep AuditLog.metadata.emails for deleted users.
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
        alias: aliasSchema,
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
        out: {},
      };
      const share = await shareService.getShareByAlias(
        request.params.alias,
        undefined,
        userId,
        context,
      );
      refreshVisitorCookieWithRecipient(
        reply,
        request.params.alias,
        context.out?.recipientIdForCookie,
        visitorCookie,
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
        out: {},
      };
      const share = await shareService.getShareByAlias(
        request.params.alias,
        request.body.password,
        userId,
        context,
      );
      refreshVisitorCookieWithRecipient(
        reply,
        request.params.alias,
        context.out?.recipientIdForCookie,
        visitorCookie,
      );
      return reply.send({ share });
    },
  });

  app.route({
    method: "POST",
    url: "/shares/:shareId/notify",
    preValidation,
    config: {
      rateLimit: { max: 5, timeWindow: "10 minutes" },
    },
    schema: {
      tags: ["Share"],
      operationId: "notifyRecipients",
      summary: "Send email notification to share recipients",
      description:
        "Sends share-invitation emails to recipients that already exist on the share. " +
        "Recipients (with optional names) are created via POST /shares/:shareId/recipients. " +
        "This endpoint only triggers email delivery; it does not accept recipient names. " +
        "Pass `emails` to notify a subset, or omit to notify all recipients.",
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

  app.route({
    method: "POST",
    url: "/shares/:shareId/remind",
    preValidation,
    config: {
      rateLimit: { max: 5, timeWindow: "10 minutes" },
    },
    schema: {
      tags: ["Share"],
      operationId: "remindNonDownloaders",
      summary: "Remind share recipients who have not downloaded yet",
      description:
        "Sends a download-reminder email to recipients of this share that have not yet " +
        "downloaded any file (lastDownloadedAt is null). " +
        "Pass `emails` to remind a subset — it is always intersected with the non-downloader " +
        "set, so a recipient who already downloaded is never reminded. " +
        "When no recipient is pending the call is a no-op and returns an empty list.",
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
          .describe(
            "Optional list of recipient emails to remind (reminds all non-downloaders if omitted)",
          ),
      }),
      response: {
        200: z.object({
          remindedRecipients: z
            .array(z.string())
            .describe("List of reminded email addresses (non-downloaders only)"),
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
      const result = await shareService.remindNonDownloaders(
        request.params.shareId,
        userId,
        request.body.emails,
      );
      // Only emit the audit event when at least one reminder was actually sent — a no-op
      // (nobody pending, or SMTP off) should not pollute the audit trail.
      if (result.remindedRecipients.length > 0) {
        // NOTE: Recipient emails are stored in the audit log for forensics. PII retention follows
        // auditRetentionDays (default 365). If privacy requirements change, hash or redact emails here.
        logAuditEvent({
          action: "SHARE_RECIPIENT_REMIND",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          userId,
          targetType: "share",
          targetId: request.params.shareId,
          metadata: {
            recipientCount: result.remindedRecipients.length,
            emails: result.remindedRecipients,
          },
        }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));
      }
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

      // The identification form never sets recipientId — that is written only server-side after
      // a tracking token is verified at access time (see refreshVisitorCookieWithRecipient). Form
      // input is always self-declared and therefore never carries a verified-recipient claim.
      const payload = buildVisitorCookiePayload({
        alias,
        name: request.body.name ?? null,
        email: request.body.email ?? null,
      });

      reply.setCookie(`sv_${alias}`, payload, visitorCookieOptions());

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
        identified: z
          .enum(["true", "false"])
          .optional()
          .describe(
            "Filter by identification status: true = has recipientId, visitorEmail, or visitorName; false = anonymous",
          ),
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
              action: z.string(),
              fileId: z.string().nullable(),
              createdAt: z.string().datetime(),
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
      const { action, identified, page, limit } = request.query;

      // Verify the requester is the share creator
      const share = await prisma.share.findUnique({ where: { id: shareId } });
      if (!share) {
        throw new NotFoundError("Share not found");
      }
      if (share.creatorId !== userId) {
        throw new ForbiddenError("Not share creator");
      }

      const where: Record<string, unknown> = {
        shareId,
        ...(action ? { action } : {}),
      };

      if (identified === "true") {
        // At least one identification field is set
        where.OR = [
          { recipientId: { not: null } },
          { visitorEmail: { not: null } },
          { visitorName: { not: null } },
        ];
      } else if (identified === "false") {
        // No identification at all
        where.recipientId = null;
        where.visitorEmail = null;
        where.visitorName = null;
      }

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

      // Derive the response identificationSource for each visit. Prefer the source recorded
      // at write time (8.3): since lot C now sets `recipientId` for self-declared email matches
      // too, `recipientId != null` alone no longer implies a token-verified arrival. The stored
      // column keeps the distinction honest:
      // - stored "token"        → "tracking_token" (verified personalized link)
      // - stored "self_declared"→ "cookie"         (self-identified via the form, unverified)
      // - stored null (pre-8.3 rows) → derive from the available identity for backward compat.
      // Strip ipAddress and userAgent from response — these are stored for
      // admin audit purposes only and must not be exposed to regular users.
      const enrichedVisits = visits.map(({ ipAddress: _ip, userAgent: _ua, ...visit }) => ({
        ...visit,
        createdAt: visit.createdAt.toISOString(),
        identificationSource:
          visit.identificationSource === "token"
            ? ("tracking_token" as const)
            : visit.identificationSource === "self_declared"
              ? ("cookie" as const)
              : visit.recipientId
                ? ("tracking_token" as const)
                : visit.visitorEmail || visit.visitorName
                  ? ("cookie" as const)
                  : ("anonymous" as const),
      }));

      return reply.send({ visits: enrichedVisits, total, page, limit });
    },
  });
};
