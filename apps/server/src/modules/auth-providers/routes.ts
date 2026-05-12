import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { AuthProvidersController } from "./controller.js";
import {
  CreateAuthProviderSchema,
  UpdateAuthProviderSchema,
  UpdateProvidersOrderSchema,
} from "./dto.js";

const AuthProviderResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  displayName: z.string(),
  type: z.string(),
  icon: z.string().nullable(),
  enabled: z.boolean(),
  autoRegister: z.boolean(),
  scope: z.string().nullable(),
  adminEmailDomains: z.string().nullable(),
  clientId: z.string(),
  issuerUrl: z.string().nullable(),
  authorizationEndpoint: z.string().nullable(),
  tokenEndpoint: z.string().nullable(),
  userInfoEndpoint: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export async function authProvidersRoutes(fastify: FastifyInstance) {
  const authProvidersController = new AuthProvidersController();

  const adminPreValidation = createAdminPreValidation({ allowSetupBypass: true });

  fastify.get(
    "/providers",
    {
      schema: {
        tags: ["Auth Providers"],
        operationId: "getAuthProviders",
        summary: "Get enabled authentication providers",
        description: "Retrieve all enabled authentication providers available for login",
        response: {
          200: z.object({
            success: z.boolean(),
            data: z.array(
              z.object({
                id: z.string(),
                name: z.string(),
                displayName: z.string(),
                type: z.string(),
                icon: z.string().optional(),
                authUrl: z.string().optional(),
              }),
            ),
          }),
          500: ErrorResponseSchema,
        },
      },
    },
    authProvidersController.getProviders.bind(authProvidersController),
  );

  fastify.get(
    "/providers/all",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Auth Providers"],
        operationId: "getAllAuthProviders",
        summary: "Get all authentication providers",
        description: "Retrieve all authentication providers for admin configuration",
        response: {
          200: z.object({
            success: z.boolean(),
            data: z.array(AuthProviderResponseSchema),
          }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    authProvidersController.getAllProviders.bind(authProvidersController),
  );

  fastify.post(
    "/providers",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Auth Providers"],
        operationId: "createAuthProvider",
        summary: "Create authentication provider",
        description:
          "Create a new authentication provider. Use either issuerUrl for automatic discovery OR provide all three custom endpoints.",
        body: CreateAuthProviderSchema,
        response: {
          200: z.object({
            success: z.boolean(),
            data: AuthProviderResponseSchema,
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    authProvidersController.createProvider.bind(authProvidersController),
  );

  fastify.put(
    "/providers/order",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Auth Providers"],
        operationId: "updateProvidersOrder",
        summary: "Update providers order",
        description: "Update the display order of authentication providers",
        body: UpdateProvidersOrderSchema,
        response: {
          200: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    authProvidersController.updateProvidersOrder.bind(authProvidersController),
  );

  fastify.put(
    "/providers/:id",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Auth Providers"],
        operationId: "updateAuthProvider",
        summary: "Update authentication provider",
        description:
          "Update configuration for a specific authentication provider. Use either issuerUrl for automatic discovery OR provide all three custom endpoints.",
        params: z.object({
          id: z.string(),
        }),
        body: UpdateAuthProviderSchema,
        response: {
          200: z.object({
            success: z.boolean(),
            data: AuthProviderResponseSchema,
          }),
          400: ErrorResponseSchema,
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    authProvidersController.updateProvider.bind(authProvidersController),
  );

  fastify.delete(
    "/providers/:id",
    {
      preValidation: adminPreValidation,
      schema: {
        tags: ["Auth Providers"],
        operationId: "deleteAuthProvider",
        summary: "Delete authentication provider",
        description: "Delete a specific authentication provider",
        params: z.object({
          id: z.string(),
        }),
        response: {
          200: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
          401: ErrorResponseSchema,
          403: ErrorResponseSchema,
          500: ErrorResponseSchema,
        },
      },
    },
    authProvidersController.deleteProvider.bind(authProvidersController),
  );

  fastify.get(
    "/providers/:provider/authorize",
    {
      schema: {
        tags: ["Auth Providers"],
        operationId: "authorizeWithProvider",
        summary: "Initiate authentication with provider",
        description: "Start the authentication flow with a specific provider",
        params: z.object({
          provider: z.string(),
        }),
        querystring: z
          .object({
            state: z.string().optional(),
            redirect_uri: z.string().optional(),
          })
          .optional(),
        response: {
          302: z.object({
            message: z.string(),
          }),
          400: ErrorResponseSchema,
        },
      },
    },
    authProvidersController.authorize.bind(authProvidersController),
  );

  fastify.get(
    "/providers/:provider/callback",
    {
      schema: {
        tags: ["Auth Providers"],
        operationId: "handleProviderCallback",
        summary: "Handle authentication callback",
        description: "Handle the callback from authentication provider",
        params: z.object({
          provider: z.string(),
        }),
        querystring: z
          .object({
            code: z.string().optional(),
            state: z.string().optional(),
            error: z.string().optional(),
          })
          .optional(),
        response: {
          302: z.object({
            message: z.string(),
          }),
        },
      },
    },
    authProvidersController.callback.bind(authProvidersController),
  );
}
