import type { FastifyReply, FastifyRequest } from "fastify";

import {
  REFRESH_TOKEN_COOKIE_NAME,
  REFRESH_TOKEN_COOKIE_PATH,
  REFRESH_TOKEN_MAX_AGE,
} from "../../config/auth.config.js";
import { env } from "../../env.js";
import { UnauthorizedError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { createRefreshToken } from "../auth/refresh-token.service.js";
import { AvatarService } from "./avatar.service.js";
import { createRegisterUserSchema, UpdateUserSchema } from "./dto.js";
import { UserService } from "./service.js";

export class UserController {
  private userService = new UserService();
  private avatarService = new AvatarService();

  async register(request: FastifyRequest, reply: FastifyReply) {
    const schema = await createRegisterUserSchema();
    const input = schema.parse(request.body);
    const result = await this.userService.register(input);
    const { isFirstUser, ...user } = result;

    // Audit user creation (fire-and-forget)
    logAuditEvent({
      userId: request.user?.userId ?? user.id,
      action: "USER_CREATE",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { createdUserId: user.id, email: user.email },
    }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

    // Auto-login the first user so they're immediately authenticated
    // after registration. Subsequent users are created by an admin who
    // is already logged in, so no auto-login is needed for them.
    if (isFirstUser) {
      const isSecure = env.SECURE_SITE === "true";

      const token = await reply.jwtSign({
        userId: user.id,
        isAdmin: user.isAdmin,
        tokenVersion: user.tokenVersion,
      });

      reply.setCookie("token", token, {
        httpOnly: true,
        path: "/",
        secure: isSecure,
        sameSite: isSecure ? "lax" : "strict",
        signed: true,
      });

      const refreshToken = await createRefreshToken(
        user.id,
        request.headers["user-agent"] ?? "",
        request.ip,
      );
      reply.setCookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        path: REFRESH_TOKEN_COOKIE_PATH,
        maxAge: REFRESH_TOKEN_MAX_AGE,
        signed: false,
      });
    }

    return reply.status(201).send({ user, message: "User created successfully" });
  }

  async listUsers(_request: FastifyRequest, reply: FastifyReply) {
    const users = await this.userService.listUsers();
    return reply.send(users);
  }

  async getUserById(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const user = await this.userService.getUserById(id);
    return reply.send(user);
  }

  async updateUser(request: FastifyRequest, reply: FastifyReply) {
    const input = UpdateUserSchema.parse(request.body);
    const { id, ...updateData } = input;
    const updatedUser = await this.userService.updateUser(id, updateData);

    // Audit password change if password was in the update (fire-and-forget)
    if (updateData.password) {
      logAuditEvent({
        userId: id,
        action: "PASSWORD_CHANGE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));
    }

    return reply.send(updatedUser);
  }

  async activateUser(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const user = await this.userService.activateUser(id);
    return reply.send(user);
  }

  async deactivateUser(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const user = await this.userService.deactivateUser(id);
    return reply.send(user);
  }

  async deleteUser(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string };
    const user = await this.userService.deleteUser(id);

    // Audit user deletion (fire-and-forget)
    logAuditEvent({
      userId: request.user?.userId,
      action: "USER_DELETE",
      ipAddress: request.ip,
      userAgent: request.headers["user-agent"],
      metadata: { deletedUserId: id, email: user.email },
    }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

    return reply.send(user);
  }

  async updateUserImage(request: FastifyRequest, reply: FastifyReply) {
    const input = UpdateUserSchema.parse(request.body);
    const { id, ...updateData } = input;
    const updatedUser = await this.userService.updateUser(id, updateData);
    return reply.send(updatedUser);
  }

  async uploadAvatar(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    const file = await request.file();
    if (!file) {
      throw new ValidationError("No file uploaded");
    }

    if (!file.mimetype.startsWith("image/")) {
      throw new ValidationError("Only images are allowed");
    }

    // Avatar files should be small (max 5MB), so we can safely use streaming to buffer
    const chunks: Buffer[] = [];
    const maxAvatarSize = 5 * 1024 * 1024; // 5MB
    let totalSize = 0;

    for await (const chunk of file.file) {
      totalSize += chunk.length;
      if (totalSize > maxAvatarSize) {
        throw new ValidationError("Avatar file too large. Maximum size is 5MB.");
      }
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    const base64Image = await this.avatarService.uploadAvatar(buffer);
    const updatedUser = await this.userService.updateUserImage(userId, base64Image);

    return reply.send(updatedUser);
  }

  async removeAvatar(request: FastifyRequest, reply: FastifyReply) {
    const userId = request.user?.userId;
    if (!userId) {
      throw new UnauthorizedError();
    }

    await this.avatarService.deleteAvatar(userId);
    const updatedUser = await this.userService.getUserById(userId);
    return reply.send(updatedUser);
  }
}
