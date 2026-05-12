import type { FastifyReply, FastifyRequest } from "fastify";

import { InviteService } from "./service.js";

export class InviteController {
  private inviteService = new InviteService();

  async generateInviteToken(request: FastifyRequest, reply: FastifyReply) {
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
  }
}
