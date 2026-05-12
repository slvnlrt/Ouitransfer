import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";

import { prisma } from "../../shared/prisma.js";
import { ForbiddenError, UnauthorizedError } from "../../utils/app-error.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { createPasswordSchema } from "../auth/dto.js";
import { UserController } from "./controller.js";
import { UpdateUserSchema, UserResponseSchema } from "./dto.js";
import { validatePasswordMiddleware } from "./middleware.js";

export async function userRoutes(app: FastifyInstance) {
  const userController = new UserController();

  const preValidation = async (request: FastifyRequest) => {
    // DB errors propagate to globalErrorHandler as 500 automatically.
    const usersCount = await prisma.user.count();

    if (usersCount > 0) {
      try {
        await request.jwtVerify();
      } catch (authErr) {
        request.log.error({ err: authErr }, "JWT verification failed");
        throw new UnauthorizedError(
          "Unauthorized: a valid token is required to access this resource.",
        );
      }
      if (!request.user.isAdmin) {
        throw new ForbiddenError("Access restricted to administrators");
      }
    }
  };

  const createRegisterSchema = async () => {
    const passwordSchema = await createPasswordSchema();
    return z.object({
      firstName: z.string().min(1).describe("User first name"),
      lastName: z.string().min(1).describe("User last name"),
      username: z.string().min(3).describe("User username"),
      email: z.string().email().describe("User email"),
      image: z.string().optional().describe("User profile image URL"),
      password: passwordSchema.describe("User password"),
    });
  };

  const createUpdateSchema = async () => {
    const passwordSchema = await createPasswordSchema();
    return UpdateUserSchema.extend({
      password: passwordSchema.optional(),
    });
  };

  app.post(
    "/auth/register",
    {
      preValidation: [preValidation, validatePasswordMiddleware],
      schema: {
        tags: ["User"],
        operationId: "registerUser",
        summary: "Register New User",
        description: "Register a new user (admin only)",
        body: await createRegisterSchema(),
        response: {
          201: z.object({
            user: z.object({
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
            }),
            message: z.string().describe("User registration message"),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    userController.register.bind(userController),
  );

  app.get(
    "/users",
    {
      preValidation,
      schema: {
        tags: ["User"],
        operationId: "listUsers",
        summary: "List All Users",
        description: "List all users (admin only)",
        response: {
          200: z.array(
            z.object({
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
            }),
          ),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    userController.listUsers.bind(userController),
  );

  app.get(
    "/users/:id",
    {
      preValidation,
      schema: {
        tags: ["User"],
        operationId: "getUserById",
        summary: "Get User by ID",
        description: "Get a user by ID (admin only)",
        params: z.object({ id: z.string().describe("User ID") }),
        response: {
          200: z.object({
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
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          404: ErrorResponseSchema,
        },
      },
    },
    userController.getUserById.bind(userController),
  );

  app.put(
    "/users",
    {
      preValidation,
      schema: {
        tags: ["User"],
        operationId: "updateUser",
        summary: "Update User Data",
        description: "Update user data (admin only)",
        body: await createUpdateSchema(),
        response: {
          200: z.object({
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
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    userController.updateUser.bind(userController),
  );

  app.patch(
    "/users/:id/activate",
    {
      preValidation,
      schema: {
        tags: ["User"],
        operationId: "activateUser",
        summary: "Activate User",
        description: "Activate a user (admin only)",
        params: z.object({ id: z.string().describe("User ID") }),
        response: {
          200: z.object({
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
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    userController.activateUser.bind(userController),
  );

  app.patch(
    "/users/:id/deactivate",
    {
      preValidation,
      schema: {
        tags: ["User"],
        operationId: "deactivateUser",
        summary: "Deactivate User",
        description: "Deactivate a user (admin only)",
        params: z.object({ id: z.string().describe("User ID") }),
        response: {
          200: z.object({
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
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    userController.deactivateUser.bind(userController),
  );

  app.delete(
    "/users/:id",
    {
      preValidation,
      schema: {
        tags: ["User"],
        operationId: "deleteUser",
        summary: "Delete User",
        description: "Delete a user (admin only)",
        params: z.object({ id: z.string().describe("User ID") }),
        response: {
          200: z.object({
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
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    userController.deleteUser.bind(userController),
  );

  app.patch(
    "/users/:id/image",
    {
      preValidation,
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
          200: z.object({
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
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
        },
      },
    },
    userController.updateUserImage.bind(userController),
  );

  app.post(
    "/users/avatar",
    {
      preValidation: async (request: FastifyRequest) => {
        try {
          await request.jwtVerify();
        } catch (err) {
          request.log.error({ err }, "JWT verification failed");
          throw new UnauthorizedError("Unauthorized");
        }
      },
      schema: {
        tags: ["User"],
        operationId: "uploadAvatar",
        summary: "Upload user avatar",
        description: "Upload and update user profile image",
        consumes: ["multipart/form-data"],
        response: {
          200: UserResponseSchema,
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    userController.uploadAvatar.bind(userController),
  );

  app.delete(
    "/users/avatar",
    {
      preValidation: async (request: FastifyRequest) => {
        try {
          await request.jwtVerify();
        } catch (err) {
          request.log.error({ err }, "JWT verification failed");
          throw new UnauthorizedError("Unauthorized");
        }
      },
      schema: {
        tags: ["User"],
        operationId: "removeAvatar",
        summary: "Remove user avatar",
        description: "Remove user profile image",
        response: {
          200: UserResponseSchema,
          401: ErrorResponseSchema,
        },
      },
    },
    userController.removeAvatar.bind(userController),
  );
}
