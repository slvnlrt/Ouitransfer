import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { UnauthorizedError } from "../../utils/app-error.js";
import { InviteController } from "./controller.js";
import {
  CreateInviteTokenResponseSchema,
  RegisterWithInviteResponseSchema,
  RegisterWithInviteSchema,
  ValidateInviteTokenResponseSchema,
} from "./dto.js";

export async function inviteRoutes(app: FastifyInstance) {
  const inviteController = new InviteController();

  app.post(
    "/invite-tokens",
    {
      schema: {
        tags: ["Invite"],
        operationId: "generateInviteToken",
        summary: "Generate Invite Token",
        description: "Generate a one-time use invite token for user registration (admin only)",
        response: {
          200: CreateInviteTokenResponseSchema,
          403: z.object({ error: z.string().describe("Error message") }),
          500: z.object({ error: z.string().describe("Error message") }),
        },
      },
      preValidation: async (request: FastifyRequest) => {
        try {
          await request.jwtVerify();
        } catch (err) {
          request.log.error({ err }, "JWT verification failed");
          throw new UnauthorizedError(
            "Unauthorized: a valid token is required to access this resource.",
          );
        }
      },
    },
    inviteController.generateInviteToken.bind(inviteController),
  );

  app.get(
    "/invite-tokens/:token",
    {
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
          500: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    inviteController.validateInviteToken.bind(inviteController),
  );

  app.post(
    "/register-with-invite",
    {
      config: { csrfExempt: true },
      schema: {
        tags: ["Invite"],
        operationId: "registerWithInvite",
        summary: "Register with Invite",
        description: "Create a new user account using an invite token",
        body: RegisterWithInviteSchema,
        response: {
          200: RegisterWithInviteResponseSchema,
          400: z.object({ error: z.string().describe("Error message") }),
          500: z.object({ error: z.string().describe("Error message") }),
        },
      },
    },
    inviteController.registerWithInvite.bind(inviteController),
  );
}
