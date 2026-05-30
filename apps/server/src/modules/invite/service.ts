import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

import { prisma } from "../../shared/prisma.js";
import { ConflictError, GoneError, NotFoundError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { emailService } from "../email/service.js";

export class InviteService {
  async generateInviteToken(
    adminUserId: string,
  ): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 15);

    const inviteToken = await prisma.inviteToken.create({
      data: {
        token,
        expiresAt,
        createdBy: adminUserId,
      },
    });

    return { id: inviteToken.id, token, expiresAt };
  }

  async validateInviteToken(
    token: string,
  ): Promise<{ valid: boolean; used?: boolean; expired?: boolean }> {
    const inviteToken = await prisma.inviteToken.findUnique({
      where: { token },
    });

    if (!inviteToken) {
      return { valid: false };
    }

    if (inviteToken.usedAt) {
      return { valid: false, used: true };
    }

    if (new Date() > inviteToken.expiresAt) {
      return { valid: false, expired: true };
    }

    return { valid: true };
  }

  async registerWithInvite(data: {
    token: string;
    firstName: string;
    lastName: string;
    username: string;
    email: string;
    password: string;
  }): Promise<{ id: string; username: string; email: string; inviteTokenId: string }> {
    const validation = await this.validateInviteToken(data.token);

    if (!validation.valid) {
      if (validation.used) {
        throw new ConflictError("This invite link has already been used");
      }
      if (validation.expired) {
        throw new GoneError("This invite link has expired");
      }
      throw new NotFoundError("Invalid invite link");
    }

    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [{ username: data.username }, { email: data.email }],
      },
    });

    if (existingUser) {
      if (existingUser.username === data.username) {
        throw new ConflictError("Username already exists");
      }
      if (existingUser.email === data.email) {
        throw new ConflictError("Email already exists");
      }
    }

    const hashedPassword = await bcrypt.hash(data.password, 10);
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          firstName: data.firstName,
          lastName: data.lastName,
          username: data.username,
          email: data.email,
          password: hashedPassword,
          isAdmin: false,
          isActive: true,
        },
        select: {
          id: true,
          username: true,
          email: true,
        },
      });

      const inviteToken = await tx.inviteToken.update({
        where: { token: data.token },
        data: { usedAt: new Date() },
      });

      return { ...user, inviteTokenId: inviteToken.id };
    });

    // Notify admins about new invite-based registration (fire-and-forget).
    // An admin created the invite, so there's always at least one user — but guard anyway.
    emailService
      .sendToAdmins("admin_user_registered", {
        userName: `${data.firstName} ${data.lastName}`.trim(),
        userEmail: data.email,
        registrationMethod: "invite",
      })
      .catch((err) =>
        getLogger().error({ err }, "Failed to send admin_user_registered email for invited user"),
      );

    return result;
  }
}
