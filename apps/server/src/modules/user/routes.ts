import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { createJwtPreValidation } from "../../middleware/jwt-prevalidation.js";
import { UnauthorizedError, ValidationError } from "../../utils/app-error.js";
import { signAndSetCookies } from "../../utils/auth-cookies.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { logAuditEvent } from "../audit/service.js";
import { createPasswordSchema } from "../auth/dto.js";
import { AvatarService } from "./avatar.service.js";
import { UpdateUserSchema } from "./dto.js";
import { validatePasswordMiddleware } from "./middleware.js";
import { UserService } from "./service.js";

const userService = new UserService();
const avatarService = new AvatarService();

// ── Module-level helpers ─────────────────────────────────────

/** Convert Prisma User BigInt fields to JSON-safe strings and extract group info */
function serializeUser<
  T extends {
    maxFileSizeOverride?: bigint | null;
    maxTotalStorageOverride?: bigint | null;
    group?: { id: string; name: string } | null;
  },
>(user: T) {
  const { group, ...rest } = user;
  return {
    ...rest,
    maxFileSizeOverride: user.maxFileSizeOverride != null ? String(user.maxFileSizeOverride) : null,
    maxTotalStorageOverride:
      user.maxTotalStorageOverride != null ? String(user.maxTotalStorageOverride) : null,
    groupName: group?.name ?? null,
  };
}

// ── Pre-validation hooks ─────────────────────────────────────

const adminPreValidation = createAdminPreValidation({ allowSetupBypass: true });
const jwtPreValidation = createJwtPreValidation();

// ── Shared response schemas ──────────────────────────────────

const UserResponseFields = {
  id: z.string().describe("User ID"),
  firstName: z.string().describe("User first name"),
  lastName: z.string().describe("User last name"),
  username: z.string().describe("User username"),
  email: z.string().email().describe("User email"),
  image: z.string().nullable().describe("User profile image URL"),
  isAdmin: z.boolean().describe("User is admin"),
  isActive: z.boolean().describe("User is active"),
  createdAt: z.date().describe("User creation date"),
  updatedAt: z.date().describe("User last update date"),
  groupId: z.union([z.string(), z.null()]).describe("Group ID the user belongs to"),
  groupName: z.union([z.string(), z.null()]).describe("Group name (for display)"),
  maxFileSizeOverride: z
    .union([z.string(), z.null()])
    .describe("Per-user max file size override in bytes"),
  maxTotalStorageOverride: z
    .union([z.string(), z.null()])
    .describe("Per-user max total storage override in bytes"),
};

const UserResponseSchema = z.object(UserResponseFields);

const AvatarUserResponseSchema = z.object({
  ...UserResponseFields,
  tokenVersion: z.number(),
});

// ── Routes ───────────────────────────────────────────────────

export const userRoutes: FastifyPluginAsyncZod = async (app) => {
  // Dynamic schemas (created once at plugin registration time)
  const createRegisterSchema = async () => {
    const passwordSchema = await createPasswordSchema();
    return z.object({
      firstName: z.string().min(1).describe("User first name"),
      lastName: z.string().min(1).describe("User last name"),
      username: z.string().min(3).describe("User username"),
      email: z.string().email().describe("User email"),
      image: z.string().optional().describe("User profile image URL"),
      password: passwordSchema.describe("User password"),
      isAdmin: z.boolean().optional().default(false).describe("Whether the user is an admin"),
    });
  };

  const createUpdateSchema = async () => {
    const passwordSchema = await createPasswordSchema();
    return UpdateUserSchema.extend({
      password: passwordSchema.optional(),
    });
  };

  // POST /auth/register — register new user
  app.route({
    method: "POST",
    url: "/auth/register",
    preValidation: [adminPreValidation, validatePasswordMiddleware],
    schema: {
      tags: ["User"],
      operationId: "registerUser",
      summary: "Register New User",
      description: "Register a new user (admin only)",
      body: await createRegisterSchema(),
      response: {
        201: z.object({
          user: UserResponseSchema,
          message: z.string().describe("User registration message"),
        }),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const result = await userService.register(request.body);
      const { isFirstUser, ...user } = result;

      // Audit user creation (fire-and-forget)
      logAuditEvent({
        userId: request.user?.userId ?? user.id,
        action: "USER_CREATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "user",
        targetId: user.id,
        metadata: { via: "admin", createdUserId: user.id, email: user.email },
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      // Auto-login the first user so they're immediately authenticated
      // after registration. Subsequent users are created by an admin who
      // is already logged in, so no auto-login is needed for them.
      if (isFirstUser) {
        await signAndSetCookies(
          reply,
          { id: user.id, isAdmin: user.isAdmin, tokenVersion: user.tokenVersion },
          request.headers["user-agent"] ?? "",
          request.ip,
        );
      }

      return reply
        .status(201)
        .send({ user: serializeUser(user), message: "User created successfully" });
    },
  });

  // GET /users — list all users
  app.route({
    method: "GET",
    url: "/users",
    preValidation: adminPreValidation,
    schema: {
      tags: ["User"],
      operationId: "listUsers",
      summary: "List All Users",
      description: "List all users (admin only)",
      response: {
        200: z.array(UserResponseSchema),
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (_request, reply) => {
      const users = await userService.listUsers();
      return reply.send(users.map(serializeUser));
    },
  });

  // GET /users/:id — get user by ID
  app.route({
    method: "GET",
    url: "/users/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["User"],
      operationId: "getUserById",
      summary: "Get User by ID",
      description: "Get a user by ID (admin only)",
      params: z.object({ id: z.string().describe("User ID") }),
      response: {
        200: UserResponseSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
        404: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const user = await userService.getUserById(request.params.id);
      return reply.send(serializeUser(user));
    },
  });

  // PUT /users — update user
  app.route({
    method: "PUT",
    url: "/users",
    preValidation: adminPreValidation,
    schema: {
      tags: ["User"],
      operationId: "updateUser",
      summary: "Update User Data",
      description: "Update user data (admin only)",
      body: await createUpdateSchema(),
      response: {
        200: UserResponseSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const input = request.body;
      const { id, ...updateData } = input;

      // Fetch old user state for audit comparison (role change detection)
      const oldUser = await userService.getUserById(id);

      const updatedUser = await userService.updateUser(id, updateData);

      // Audit password change if password was in the update (fire-and-forget)
      if (updateData.password) {
        logAuditEvent({
          userId: id,
          action: "PASSWORD_CHANGE",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          targetType: "user",
          targetId: id,
        }).catch((err) => getLogger().error({ err }, "Audit log write failed"));
      }

      // Audit role change if isAdmin was changed (fire-and-forget)
      if (updateData.isAdmin !== undefined && oldUser.isAdmin !== updatedUser.isAdmin) {
        logAuditEvent({
          userId: request.user?.userId,
          action: "USER_ROLE_CHANGE",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          targetType: "user",
          targetId: id,
          metadata: {
            oldRole: oldUser.isAdmin ? "admin" : "user",
            newRole: updatedUser.isAdmin ? "admin" : "user",
          },
        }).catch((err) => getLogger().error({ err }, "Audit log write failed"));
      }

      // Audit general user update for non-password fields (fire-and-forget)
      const changedFields = Object.keys(updateData).filter((k) => k !== "password");
      if (changedFields.length > 0) {
        logAuditEvent({
          userId: request.user?.userId,
          action: "USER_UPDATE",
          ipAddress: request.ip,
          userAgent: request.headers["user-agent"],
          targetType: "user",
          targetId: id,
          metadata: { changedFields },
        }).catch((err) => getLogger().error({ err }, "Audit log write failed"));
      }

      return reply.send(serializeUser(updatedUser));
    },
  });

  // PATCH /users/:id/activate — activate user
  app.route({
    method: "PATCH",
    url: "/users/:id/activate",
    preValidation: adminPreValidation,
    schema: {
      tags: ["User"],
      operationId: "activateUser",
      summary: "Activate User",
      description: "Activate a user (admin only)",
      params: z.object({ id: z.string().describe("User ID") }),
      response: {
        200: UserResponseSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const user = await userService.activateUser(request.params.id);

      // Audit user activation (fire-and-forget)
      logAuditEvent({
        userId: request.user?.userId,
        action: "USER_ACTIVATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "user",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return reply.send(serializeUser(user));
    },
  });

  // PATCH /users/:id/deactivate — deactivate user
  app.route({
    method: "PATCH",
    url: "/users/:id/deactivate",
    preValidation: adminPreValidation,
    schema: {
      tags: ["User"],
      operationId: "deactivateUser",
      summary: "Deactivate User",
      description: "Deactivate a user (admin only)",
      params: z.object({ id: z.string().describe("User ID") }),
      response: {
        200: UserResponseSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const user = await userService.deactivateUser(request.params.id);

      // Audit user deactivation (fire-and-forget)
      logAuditEvent({
        userId: request.user?.userId,
        action: "USER_DEACTIVATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "user",
        targetId: request.params.id,
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return reply.send(serializeUser(user));
    },
  });

  // DELETE /users/:id — delete user
  app.route({
    method: "DELETE",
    url: "/users/:id",
    preValidation: adminPreValidation,
    schema: {
      tags: ["User"],
      operationId: "deleteUser",
      summary: "Delete User",
      description: "Delete a user (admin only)",
      params: z.object({ id: z.string().describe("User ID") }),
      response: {
        200: UserResponseSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const user = await userService.deleteUser(request.params.id);

      // Audit user deletion (fire-and-forget)
      logAuditEvent({
        userId: request.user?.userId,
        action: "USER_DELETE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        targetType: "user",
        targetId: request.params.id,
        metadata: { deletedUserId: request.params.id, email: user.email },
      }).catch((err) => getLogger().error({ err }, "Audit log write failed"));

      return reply.send(serializeUser(user));
    },
  });

  // PATCH /users/:id/image — update user image
  app.route({
    method: "PATCH",
    url: "/users/:id/image",
    preValidation: adminPreValidation,
    schema: {
      tags: ["User"],
      operationId: "updateUserImage",
      summary: "Update User Image",
      description: "Update user profile image (admin only)",
      params: z.object({ id: z.string().describe("User ID") }),
      body: z.object({
        image: z.string().url().describe("User profile image URL"),
      }),
      response: {
        200: UserResponseSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
        403: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const updatedUser = await userService.updateUserImage(id, request.body.image);
      return reply.send(serializeUser(updatedUser));
    },
  });

  // POST /users/avatar — upload user avatar
  app.route({
    method: "POST",
    url: "/users/avatar",
    preValidation: jwtPreValidation,
    schema: {
      tags: ["User"],
      operationId: "uploadAvatar",
      summary: "Upload user avatar",
      description: "Upload and update user profile image",
      consumes: ["multipart/form-data"],
      response: {
        200: AvatarUserResponseSchema,
        400: ErrorResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
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
      const base64Image = await avatarService.uploadAvatar(buffer);
      const updatedUser = await userService.updateUserImage(userId, base64Image);

      return reply.send(serializeUser(updatedUser));
    },
  });

  // DELETE /users/avatar — remove user avatar
  app.route({
    method: "DELETE",
    url: "/users/avatar",
    preValidation: jwtPreValidation,
    schema: {
      tags: ["User"],
      operationId: "removeAvatar",
      summary: "Remove user avatar",
      description: "Remove user profile image",
      response: {
        200: AvatarUserResponseSchema,
        401: ErrorResponseSchema,
      },
    },
    handler: async (request, reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new UnauthorizedError();
      }

      await avatarService.deleteAvatar(userId);
      const updatedUser = await userService.getUserById(userId);
      return reply.send(serializeUser(updatedUser));
    },
  });
};
