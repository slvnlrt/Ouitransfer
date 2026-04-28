import type { FastifyReply, FastifyRequest } from "fastify";

import { AvatarService } from "./avatar.service.js";
import { createRegisterUserSchema, UpdateUserSchema } from "./dto.js";
import { UserService } from "./service.js";

export class UserController {
  private userService = new UserService();
  private avatarService = new AvatarService();

  async register(request: FastifyRequest, reply: FastifyReply) {
    try {
      const schema = await createRegisterUserSchema();
      const input = schema.parse(request.body);
      const user = await this.userService.register(input);
      return reply.status(201).send({ user, message: "User created successfully" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async listUsers(_request: FastifyRequest, reply: FastifyReply) {
    try {
      const users = await this.userService.listUsers();
      return reply.send(users);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async getUserById(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const user = await this.userService.getUserById(id);
      return reply.send(user);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(404).send({ error: message });
    }
  }

  async updateUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const input = UpdateUserSchema.parse(request.body);
      const { id, ...updateData } = input;
      const updatedUser = await this.userService.updateUser(id, updateData);
      return reply.send(updatedUser);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async activateUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const user = await this.userService.activateUser(id);
      return reply.send(user);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async deactivateUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const user = await this.userService.deactivateUser(id);
      return reply.send(user);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async deleteUser(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string };
      const user = await this.userService.deleteUser(id);
      return reply.send(user);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async updateUserImage(request: FastifyRequest, reply: FastifyReply) {
    try {
      const input = UpdateUserSchema.parse(request.body);
      const { id, ...updateData } = input;
      const updatedUser = await this.userService.updateUser(id, updateData);
      return reply.send(updatedUser);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async uploadAvatar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const file = await request.file();
      if (!file) {
        return reply.status(400).send({ error: "No file uploaded" });
      }

      if (!file.mimetype.startsWith("image/")) {
        return reply.status(400).send({ error: "Only images are allowed" });
      }

      // Avatar files should be small (max 5MB), so we can safely use streaming to buffer
      const chunks: Buffer[] = [];
      const maxAvatarSize = 5 * 1024 * 1024; // 5MB
      let totalSize = 0;

      for await (const chunk of file.file) {
        totalSize += chunk.length;
        if (totalSize > maxAvatarSize) {
          throw new Error("Avatar file too large. Maximum size is 5MB.");
        }
        chunks.push(chunk);
      }

      const buffer = Buffer.concat(chunks);
      const base64Image = await this.avatarService.uploadAvatar(buffer);
      const updatedUser = await this.userService.updateUserImage(userId, base64Image);

      return reply.send(updatedUser);
    } catch (error: unknown) {
      request.log.error({ err: error }, "Upload error");
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }

  async removeAvatar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = request.user?.userId;
      if (!userId) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      await this.avatarService.deleteAvatar(userId);
      const updatedUser = await this.userService.getUserById(userId);
      return reply.send(updatedUser);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }
}
