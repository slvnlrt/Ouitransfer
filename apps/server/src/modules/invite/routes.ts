import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import {
  CreateInviteTokenResponseSchema,
  RegisterWithInviteResponseSchema,
  RegisterWithInviteSchema,
  ValidateInviteTokenResponseSchema,
} from "./dto.js";
import { InviteService } from "./service.js";

const inviteService = new InviteService();

export const inviteRoutes: FastifyPluginAsyncZod = async (app) => {
  app.route({
    method: "POST",
    url: "/invite-tokens",
    schema: {
      tags: ["Invite"],
      operationId: "generateInviteToken",
      summary: "Generate Invite Token",
      description: "Generate a one-time use invite token for user registration (admin only)",
      response: {
        200: CreateInviteTokenResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    preValidation: createAdminPreValidation({ allowSetupBypass: false }),
    handler: async (request, reply) => {
      const { id, token, expiresAt } = await inviteService.generateInviteToken(request.user.userId);

      // Audit invite token creation (fire-and-forget)
      logAuditEvent({
        action: "INVITE_TOKEN_CREATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId: request.user.userId,
        targetType: "invite_token",
        targetId: id,
        metadata: { expiresAt: expiresAt.toISOString() },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send({ token, expiresAt });
    },
  });

  app.route({
    method: "GET",
    url: "/invite-tokens/:token",
    schema: {
      tags: ["Invite"],
      operationId: "validateInviteToken",
      summary: "Validate Invite Token",
      description: "Check if an invite token is valid and can be used",
      params: z.object({
        token: z.string().describe("Invite token"),
      }),
      response: {
        200: ValidateInviteTokenResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const validation = await inviteService.validateInviteToken(request.params.token);
      return reply.send(validation);
    },
  });

  app.route({
    method: "POST",
    url: "/register-with-invite",
    config: { csrfExempt: true },
    schema: {
      tags: ["Invite"],
      operationId: "registerWithInvite",
      summary: "Register with Invite",
      description: "Create a new user account using an invite token",
      body: RegisterWithInviteSchema,
      response: {
        200: RegisterWithInviteResponseSchema,
        400: ErrorResponseSchema,
        404: ErrorResponseSchema,
        409: ErrorResponseSchema,
        410: ErrorResponseSchema,
        500: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { token, firstName, lastName, username, email, password } = request.body;
      const user = await inviteService.registerWithInvite({
        token,
        firstName,
        lastName,
        username,
        email,
        password,
      });

      // Audit invite token use (fire-and-forget)
      logAuditEvent({
        action: "INVITE_TOKEN_USED",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "invite_token",
        targetId: user.inviteTokenId,
        metadata: { email: user.email, userId: user.id },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return reply.send({
        message: "User registered successfully",
        user,
      });
    },
  });
};
