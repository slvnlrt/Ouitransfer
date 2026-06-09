import type { FastifyPluginAsyncZod } from "@fastify/type-provider-zod";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

import { createAdminPreValidation } from "../../middleware/admin-prevalidation.js";
import { NotFoundError, ValidationError } from "../../utils/app-error.js";
import { signAndSetCookies } from "../../utils/auth-cookies.js";
import { ErrorResponseSchema } from "../../utils/error-response-schema.js";
import { getLogger } from "../../utils/logger.js";
import { isAllowedRedirectUrl } from "../../utils/redirect-validation.js";
import { logAuditEvent } from "../audit/service.js";
import { validateAllProvidersDisable } from "../config/service.js";
import {
  CreateAuthProviderSchema,
  UpdateAuthProviderSchema,
  UpdateOfficialProviderSchema,
  UpdateProvidersOrderSchema,
} from "./dto.js";
import { AuthProvidersService } from "./service.js";
import type { RequestContext } from "./types.js";

// ── Constants ─────────────────────────────────────────────────

const ERROR_MESSAGES = {
  ENDPOINTS_INCOMPLETE:
    "When using manual endpoints, all three endpoints (authorization, token, userInfo) are required",
  MISSING_CONFIG: "Either provide issuerUrl for automatic discovery OR all three custom endpoints",
  PROVIDER_NOT_FOUND: "Provider not found",
  INVALID_URL: "Invalid Provider URL format",
  INVALID_DATA: "Invalid data provided",
  OFFICIAL_CANNOT_DELETE: "Official providers cannot be deleted",
  INVALID_PROVIDERS_ARRAY: "Invalid providers array",
  AUTHORIZATION_FAILED: "Authorization failed",
  AUTHENTICATION_FAILED: "Authentication failed",
} as const;

// ── Module-level singleton ────────────────────────────────────

const authProvidersService = new AuthProvidersService();

// ── Module-level helper functions ─────────────────────────────

function buildRequestContext(request: FastifyRequest): RequestContext {
  return {
    protocol: request.protocol,
    host: request.hostname,
    headers: request.headers,
  };
}

function buildBaseUrl(requestContext: RequestContext): string {
  return `${requestContext.protocol}://${requestContext.host}`;
}

function sendSuccessResponse(reply: FastifyReply, data?: unknown, message?: string) {
  const responseBody: Record<string, unknown> = { success: true };
  if (data !== undefined) responseBody.data = data;
  if (message) responseBody.message = message;
  return reply.send(responseBody);
}

function validateCustomEndpoints(data: {
  issuerUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
}): string | null {
  const hasAnyCustomEndpoint = !!(
    data.authorizationEndpoint ||
    data.tokenEndpoint ||
    data.userInfoEndpoint
  );
  const hasAllCustomEndpoints = !!(
    data.authorizationEndpoint &&
    data.tokenEndpoint &&
    data.userInfoEndpoint
  );

  if (hasAnyCustomEndpoint && !hasAllCustomEndpoints) {
    return ERROR_MESSAGES.ENDPOINTS_INCOMPLETE;
  }

  if (!data.issuerUrl && !hasAllCustomEndpoints) {
    return ERROR_MESSAGES.MISSING_CONFIG;
  }

  return null;
}

function validateIssuerUrl(issuerUrl: string): boolean {
  try {
    new URL(issuerUrl);
    return true;
  } catch {
    return false;
  }
}

function determineCallbackError(error: Error, provider: string): { type: string; message: string } {
  const errorMessage = error.message;

  if (errorMessage.includes("registration via") && errorMessage.includes("disabled")) {
    return {
      type: "registration_disabled",
      message: `Registration via ${provider} is disabled. Contact your administrator.`,
    };
  }

  if (errorMessage.includes("not enabled")) {
    return {
      type: "provider_disabled",
      message: `${provider} authentication is currently disabled.`,
    };
  }

  if (errorMessage.includes("expired")) {
    return {
      type: "state_expired",
      message: "Authentication session expired. Please try again.",
    };
  }

  if (errorMessage.includes("No email found")) {
    return {
      type: "no_email",
      message: `No email address found in your ${provider} account.`,
    };
  }

  if (errorMessage.includes("Token exchange failed")) {
    return {
      type: "token_exchange_failed",
      message: `Failed to authenticate with ${provider}. Please try again.`,
    };
  }

  if (errorMessage.includes("Missing required user information")) {
    return {
      type: "missing_user_info",
      message: `Incomplete user information from ${provider}.`,
    };
  }

  return {
    type: "unknown_error",
    message: ERROR_MESSAGES.AUTHENTICATION_FAILED,
  };
}

async function updateOfficialProvider(
  reply: FastifyReply,
  id: string,
  data: Record<string, unknown>,
) {
  try {
    // Parse with the official provider schema — this both validates and
    // strips any fields that aren't allowed for official providers.
    const validatedData = UpdateOfficialProviderSchema.parse(data);

    if (validatedData.issuerUrl && !validateIssuerUrl(validatedData.issuerUrl)) {
      throw new ValidationError(ERROR_MESSAGES.INVALID_URL);
    }

    const provider = await authProvidersService.updateProvider(id, validatedData);
    return sendSuccessResponse(reply, provider);
  } catch (error) {
    // Re-throw AppErrors (including ValidationError thrown above)
    if (error instanceof ValidationError) throw error;
    // Zod parse errors → validation error
    getLogger().error({ err: error, data }, "Validation error for official provider");
    throw new ValidationError(ERROR_MESSAGES.INVALID_DATA);
  }
}

async function updateCustomProvider(
  reply: FastifyReply,
  id: string,
  data: Record<string, unknown>,
) {
  try {
    const validatedData = UpdateAuthProviderSchema.parse(data);
    const provider = await authProvidersService.updateProvider(id, validatedData);
    return sendSuccessResponse(reply, provider);
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    // Zod parse errors → validation error
    getLogger().error({ err: error, data }, "Validation error for custom provider");
    throw new ValidationError(ERROR_MESSAGES.INVALID_DATA);
  }
}

// ── Response Schemas ──────────────────────────────────────────

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
  clientId: z.string().nullable(),
  issuerUrl: z.string().nullable(),
  authorizationEndpoint: z.string().nullable(),
  tokenEndpoint: z.string().nullable(),
  userInfoEndpoint: z.string().nullable(),
  sortOrder: z.number(),
  createdAt: z.date(),
  updatedAt: z.date(),
  isOfficial: z.boolean(),
});

// ── Plugin ────────────────────────────────────────────────────

export const authProvidersRoutes: FastifyPluginAsyncZod = async (app) => {
  const adminPreValidation = createAdminPreValidation({ allowSetupBypass: true });

  // ── GET /providers ──────────────────────────────────────────
  app.route({
    method: "GET",
    url: "/providers",
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
    handler: async (request, reply) => {
      const requestContext = buildRequestContext(request);
      const providers = await authProvidersService.getEnabledProviders(requestContext);
      return sendSuccessResponse(reply, providers);
    },
  });

  // ── GET /providers/all ──────────────────────────────────────
  app.route({
    method: "GET",
    url: "/providers/all",
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
    handler: async (_request, reply) => {
      const providers = await authProvidersService.getAllProviders();
      return sendSuccessResponse(reply, providers);
    },
  });

  // ── POST /providers ─────────────────────────────────────────
  app.route({
    method: "POST",
    url: "/providers",
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
    handler: async (request, reply) => {
      // Body is validated by Fastify's schema (CreateAuthProviderSchema)
      const data = request.body;

      const validationError = validateCustomEndpoints(data);
      if (validationError) {
        throw new ValidationError(validationError);
      }

      const provider = await authProvidersService.createProvider(data);

      // Audit provider creation (fire-and-forget)
      logAuditEvent({
        action: "AUTH_PROVIDER_CREATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId: request.user?.userId,
        targetType: "auth_provider",
        targetId: provider.id,
        metadata: { name: provider.name, type: provider.type },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return sendSuccessResponse(reply, provider);
    },
  });

  // ── PUT /providers/order ────────────────────────────────────
  app.route({
    method: "PUT",
    url: "/providers/order",
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
    handler: async (request, reply) => {
      const { providers } = request.body;

      if (!Array.isArray(providers)) {
        throw new ValidationError(ERROR_MESSAGES.INVALID_PROVIDERS_ARRAY);
      }

      await authProvidersService.updateProvidersOrder(providers);
      return sendSuccessResponse(reply, undefined, "Providers order updated successfully");
    },
  });

  // ── PUT /providers/:id ──────────────────────────────────────
  app.route({
    method: "PUT",
    url: "/providers/:id",
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
    handler: async (request, reply) => {
      const { id } = request.params;
      // Widening cast: the handler branches to updateOfficialProvider or updateCustomProvider,
      // each of which re-validates with its own stricter Zod schema. The route-level schema
      // accepts the union of both.
      const data = request.body as Record<string, unknown>;

      const existingProvider = await authProvidersService.getProviderById(id);
      if (!existingProvider) {
        throw new NotFoundError(ERROR_MESSAGES.PROVIDER_NOT_FOUND);
      }

      if (data.enabled === false && existingProvider.enabled === true) {
        const canDisable = await validateAllProvidersDisable();
        if (!canDisable) {
          throw new ValidationError(
            "Cannot disable the last authentication provider when password authentication is disabled",
          );
        }
      }

      // Audit provider update (fire-and-forget) — log before delegating to helper
      logAuditEvent({
        action: "AUTH_PROVIDER_UPDATE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId: request.user?.userId,
        targetType: "auth_provider",
        targetId: id,
        metadata: { name: existingProvider.name },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      const isOfficial = authProvidersService.isOfficialProvider(existingProvider.name);

      if (isOfficial) {
        return updateOfficialProvider(reply, id, data);
      }

      return updateCustomProvider(reply, id, data);
    },
  });

  // ── DELETE /providers/:id ───────────────────────────────────
  app.route({
    method: "DELETE",
    url: "/providers/:id",
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
    handler: async (request, reply) => {
      const { id } = request.params;

      const provider = await authProvidersService.getProviderById(id);
      if (!provider) {
        throw new NotFoundError(ERROR_MESSAGES.PROVIDER_NOT_FOUND);
      }

      const isOfficial = authProvidersService.isOfficialProvider(provider.name);
      if (isOfficial) {
        throw new ValidationError(ERROR_MESSAGES.OFFICIAL_CANNOT_DELETE);
      }

      if (provider.enabled) {
        const canDisable = await validateAllProvidersDisable();
        if (!canDisable) {
          throw new ValidationError(
            "Cannot delete the last authentication provider when password authentication is disabled",
          );
        }
      }

      await authProvidersService.deleteProvider(id);

      // Audit provider deletion (fire-and-forget)
      logAuditEvent({
        action: "AUTH_PROVIDER_DELETE",
        ipAddress: request.ip,
        userAgent: request.headers["user-agent"],
        userId: request.user?.userId,
        targetType: "auth_provider",
        targetId: id,
        metadata: { name: provider.name },
      }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

      return sendSuccessResponse(reply, undefined, "Provider deleted successfully");
    },
  });

  // ── GET /providers/:provider/authorize ──────────────────────
  app.route({
    method: "GET",
    url: "/providers/:provider/authorize",
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
    handler: async (request, reply) => {
      const { provider: providerName } = request.params;
      const { state, redirect_uri } = request.query || {};

      const requestContext = buildRequestContext(request);
      const authUrl = await authProvidersService.getAuthorizationUrl(
        providerName,
        state,
        redirect_uri,
        requestContext,
      );

      return reply.redirect(authUrl);
    },
  });

  // ── GET /providers/:provider/callback ───────────────────────
  app.route({
    method: "GET",
    url: "/providers/:provider/callback",
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
    handler: async (request, reply) => {
      const { provider: providerName } = request.params;
      const { code, state, error } = request.query || {};

      const requestContext = buildRequestContext(request);
      const baseUrl = buildBaseUrl(requestContext);

      // Keep try/catch: callback errors redirect to login page with error params,
      // they don't return JSON error responses.
      try {
        if (error) {
          return reply.redirect(`${baseUrl}/login?error=oauth_error&provider=${providerName}`);
        }

        if (!code) {
          return reply.redirect(`${baseUrl}/login?error=missing_code&provider=${providerName}`);
        }

        if (!state) {
          return reply.redirect(
            `${baseUrl}/login?error=missing_parameters&provider=${providerName}`,
          );
        }

        const result = await authProvidersService.handleCallback(
          providerName,
          code,
          state,
          requestContext,
        );

        // Issue JWT + refresh token so OIDC users can renew their 15-minute access token
        // without re-authenticating.
        const userAgent = request.headers["user-agent"] || "";
        const ipAddress = request.ip || request.socket.remoteAddress || "";
        await signAndSetCookies(reply, result.user, userAgent, ipAddress);

        // Fetch provider for accurate id and type in audit metadata
        const provider = await authProvidersService.getProviderByName(providerName);

        // Audit SSO login (fire-and-forget)
        logAuditEvent({
          action: "AUTH_PROVIDER_LOGIN",
          ipAddress,
          userAgent,
          userId: result.user.id,
          targetType: "auth_provider",
          targetId: provider?.id ?? providerName,
          metadata: { providerName, providerType: provider?.type ?? null },
        }).catch((err) => getLogger().error({ err }, "Failed to log audit event"));

        const redirectUrl = result.redirectUrl || "/dashboard";
        const fullRedirectUrl = redirectUrl.startsWith("http")
          ? redirectUrl
          : `${baseUrl}${redirectUrl}`;

        // Validate redirect URL to prevent open redirect attacks (S-2)
        const requestOrigin = `${requestContext.protocol}://${requestContext.host}`;
        if (!isAllowedRedirectUrl(fullRedirectUrl, requestOrigin)) {
          request.log.warn({ redirectUrl: fullRedirectUrl }, "Blocked unsafe redirect URL");
          return reply.redirect(`${baseUrl}/dashboard`);
        }

        return reply.redirect(fullRedirectUrl);
      } catch (callbackError) {
        // Log error for debugging
        request.log.error({ err: callbackError, provider: providerName }, "Auth callback error");

        const { type: errorType, message: errorMessage } =
          callbackError instanceof Error
            ? determineCallbackError(callbackError, providerName)
            : { type: "unknown_error", message: ERROR_MESSAGES.AUTHENTICATION_FAILED };

        const encodedMessage = encodeURIComponent(errorMessage);

        return reply.redirect(
          `${baseUrl}/login?error=${errorType}&provider=${providerName}&message=${encodedMessage}`,
        );
      }
    },
  });
};
