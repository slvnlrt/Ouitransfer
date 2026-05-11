import type { FastifyReply, FastifyRequest } from "fastify";

import {
  ConflictError,
  ForbiddenError,
  GoneError,
  ValidationError,
} from "../../utils/app-error.js";
import { InviteService } from "./service.js";

export class InviteController {
  private inviteService = new InviteService();

  async generateInviteToken(request: FastifyRequest, reply: FastifyReply) {
    if (!request.user?.isAdmin) {
      throw new ForbiddenError("Forbidden: admin access required");
    }

    const { token, expiresAt } = await this.inviteService.generateInviteToken(request.user.userId);
    return reply.send({ token, expiresAt });
  }

  async validateInviteToken(
    request: FastifyRequest<{ Params: { token: string } }>,
    reply: FastifyReply,
  ) {
    const { token } = request.params;
    const validation = await this.inviteService.validateInviteToken(token);

    return reply.send(validation);
  }

  async registerWithInvite(
    request: FastifyRequest<{
      Body: {
        token: string;
        firstName: string;
        lastName: string;
        username: string;
        email: string;
        password: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { token, firstName, lastName, username, email, password } = request.body;

    try {
      const user = await this.inviteService.registerWithInvite({
        token,
        firstName,
        lastName,
        username,
        email,
        password,
      });

      return reply.send({
        message: "User registered successfully",
        user,
      });
    } catch (error: unknown) {
      // Map specific service errors to appropriate AppErrors
      const message = error instanceof Error ? error.message : String(error);

      if (message.includes("already been used")) {
        throw new ValidationError("This invite link has already been used");
      }
      if (message.includes("expired")) {
        throw new GoneError("This invite link has expired");
      }
      if (message.includes("Invalid invite")) {
        throw new ValidationError("Invalid invite link");
      }
      if (message.includes("Username already exists")) {
        throw new ConflictError("Username already exists");
      }
      if (message.includes("Email already exists")) {
        throw new ConflictError("Email already exists");
      }

      // Unknown error — let the global handler deal with it as 500
      throw error;
    }
  }
}
