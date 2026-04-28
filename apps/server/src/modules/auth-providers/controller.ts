import type { FastifyReply, FastifyRequest } from "fastify";

import { getLogger } from "../../utils/logger.js";
import { ConfigService } from "../config/service.js";
import type { CreateAuthProviderInput } from "./dto.js";
import { UpdateAuthProviderSchema, UpdateOfficialProviderSchema } from "./dto.js";
import { AuthProvidersService } from "./service.js";
import type {
  AuthorizeRequest,
  CallbackRequest,
  DeleteProviderRequest,
  RequestContext,
  UpdateProviderRequest,
  UpdateProvidersOrderRequest,
} from "./types.js";

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

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

export class AuthProvidersController {
  private authProvidersService: AuthProvidersService;
  private configService: ConfigService;

  constructor() {
    this.authProvidersService = new AuthProvidersService();
    this.configService = new ConfigService();
  }

  private buildRequestContext(request: FastifyRequest): RequestContext {
    return {
      protocol: (request.headers["x-forwarded-proto"] as string) || request.protocol,
      host: (request.headers["x-forwarded-host"] as string) || (request.headers.host as string),
      headers: request.headers,
    };
  }

  private buildBaseUrl(requestContext: RequestContext): string {
    return `${requestContext.protocol}://${requestContext.host}`;
  }

  private sendSuccessResponse(reply: FastifyReply, data?: unknown, message?: string) {
    const responseBody: Record<string, unknown> = { success: true };
    if (data !== undefined) responseBody.data = data;
    if (message) responseBody.message = message;
    return reply.send(responseBody);
  }

  private sendErrorResponse(reply: FastifyReply, status: number, error: string) {
    return reply.status(status).send({
      success: false,
      error,
    });
  }

  private async handleControllerError(reply: FastifyReply, error: unknown, defaultMessage: string) {
    getLogger().error({ err: error }, `Controller error: ${defaultMessage}`);

    if (error instanceof Error && error.message.includes("Either provide issuerUrl")) {
      return this.sendErrorResponse(reply, 400, error.message);
    }

    return this.sendErrorResponse(reply, 500, defaultMessage);
  }

  private validateCustomEndpoints(data: {
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

  private validateIssuerUrl(issuerUrl: string): boolean {
    try {
      new URL(issuerUrl);
      return true;
    } catch {
      return false;
    }
  }

  private setAuthCookie(reply: FastifyReply, token: string, isSecure: boolean) {
    reply.setCookie("token", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      maxAge: COOKIE_MAX_AGE,
      path: "/",
    });
  }

  private determineCallbackError(
    error: Error,
    provider: string,
  ): { type: string; message: string } {
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

  async getProviders(request: FastifyRequest, reply: FastifyReply) {
    try {
      const requestContext = this.buildRequestContext(request);
      const providers = await this.authProvidersService.getEnabledProviders(requestContext);

      return this.sendSuccessResponse(reply, providers);
    } catch (error) {
      return this.handleControllerError(reply, error, "Failed to get auth providers");
    }
  }

  async getAllProviders(_request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    try {
      const providers = await this.authProvidersService.getAllProviders();
      return this.sendSuccessResponse(reply, providers);
    } catch (error) {
      return this.handleControllerError(reply, error, "Failed to get providers");
    }
  }

  async createProvider(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    try {
      // Body is validated by Fastify's schema (CreateAuthProviderSchema in routes.ts)
      const data = request.body as CreateAuthProviderInput;

      const validationError = this.validateCustomEndpoints(data);
      if (validationError) {
        return this.sendErrorResponse(reply, 400, validationError);
      }

      const provider = await this.authProvidersService.createProvider(data);
      return this.sendSuccessResponse(reply, provider);
    } catch (error) {
      return this.handleControllerError(reply, error, "Failed to create provider");
    }
  }

  async updateProvider(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    try {
      const { id } = request.params as UpdateProviderRequest["Params"];
      const data = request.body as Record<string, unknown>;

      const existingProvider = await this.authProvidersService.getProviderById(id);
      if (!existingProvider) {
        return this.sendErrorResponse(reply, 404, ERROR_MESSAGES.PROVIDER_NOT_FOUND);
      }

      if (data.enabled === false && existingProvider.enabled === true) {
        const canDisable = await this.configService.validateAllProvidersDisable();
        if (!canDisable) {
          return this.sendErrorResponse(
            reply,
            400,
            "Cannot disable the last authentication provider when password authentication is disabled",
          );
        }
      }

      const isOfficial = this.authProvidersService.isOfficialProvider(existingProvider.name);

      if (isOfficial) {
        return this.updateOfficialProvider(reply, id, data);
      }

      return this.updateCustomProvider(reply, id, data);
    } catch (error) {
      return this.handleControllerError(reply, error, "Failed to update provider");
    }
  }

  private async updateOfficialProvider(
    reply: FastifyReply,
    id: string,
    data: Record<string, unknown>,
  ) {
    try {
      // Parse with the official provider schema — this both validates and
      // strips any fields that aren't allowed for official providers.
      const validatedData = UpdateOfficialProviderSchema.parse(data);

      if (validatedData.issuerUrl && !this.validateIssuerUrl(validatedData.issuerUrl)) {
        return this.sendErrorResponse(reply, 400, ERROR_MESSAGES.INVALID_URL);
      }

      const provider = await this.authProvidersService.updateProvider(id, validatedData);
      return this.sendSuccessResponse(reply, provider);
    } catch (validationError) {
      getLogger().error({ err: validationError, data }, "Validation error for official provider");
      return this.sendErrorResponse(reply, 400, ERROR_MESSAGES.INVALID_DATA);
    }
  }

  private async updateCustomProvider(
    reply: FastifyReply,
    id: string,
    data: Record<string, unknown>,
  ) {
    try {
      const validatedData = UpdateAuthProviderSchema.parse(data);
      const provider = await this.authProvidersService.updateProvider(id, validatedData);
      return this.sendSuccessResponse(reply, provider);
    } catch (validationError) {
      getLogger().error({ err: validationError, data }, "Validation error for custom provider");
      return this.sendErrorResponse(reply, 400, ERROR_MESSAGES.INVALID_DATA);
    }
  }

  async updateProvidersOrder(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    try {
      const { providers } = request.body as UpdateProvidersOrderRequest["Body"];

      if (!Array.isArray(providers)) {
        return this.sendErrorResponse(reply, 400, ERROR_MESSAGES.INVALID_PROVIDERS_ARRAY);
      }

      await this.authProvidersService.updateProvidersOrder(providers);
      return this.sendSuccessResponse(reply, undefined, "Providers order updated successfully");
    } catch (error) {
      return this.handleControllerError(reply, error, "Failed to update providers order");
    }
  }

  async deleteProvider(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    try {
      const { id } = request.params as DeleteProviderRequest["Params"];

      const provider = await this.authProvidersService.getProviderById(id);
      if (!provider) {
        return this.sendErrorResponse(reply, 404, ERROR_MESSAGES.PROVIDER_NOT_FOUND);
      }

      const isOfficial = this.authProvidersService.isOfficialProvider(provider.name);
      if (isOfficial) {
        return this.sendErrorResponse(reply, 400, ERROR_MESSAGES.OFFICIAL_CANNOT_DELETE);
      }

      if (provider.enabled) {
        const canDisable = await this.configService.validateAllProvidersDisable();
        if (!canDisable) {
          return this.sendErrorResponse(
            reply,
            400,
            "Cannot delete the last authentication provider when password authentication is disabled",
          );
        }
      }

      await this.authProvidersService.deleteProvider(id);
      return this.sendSuccessResponse(reply, undefined, "Provider deleted successfully");
    } catch (error) {
      return this.handleControllerError(reply, error, "Failed to delete provider");
    }
  }

  async authorize(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { provider: providerName } = request.params as AuthorizeRequest["Params"];
      const { state, redirect_uri } = (request.query as AuthorizeRequest["Querystring"]) || {};

      const requestContext = this.buildRequestContext(request);
      const authUrl = await this.authProvidersService.getAuthorizationUrl(
        providerName,
        state,
        redirect_uri,
        requestContext,
      );

      return reply.redirect(authUrl);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : ERROR_MESSAGES.AUTHORIZATION_FAILED;
      return this.sendErrorResponse(reply, 400, errorMessage);
    }
  }

  async callback(request: FastifyRequest<CallbackRequest>, reply: FastifyReply) {
    try {
      const { provider: providerName } = request.params;
      const { code, state, error } = request.query;

      const requestContext = this.buildRequestContext(request);
      const baseUrl = this.buildBaseUrl(requestContext);

      if (error) {
        return reply.redirect(`${baseUrl}/login?error=oauth_error&provider=${providerName}`);
      }

      if (!code) {
        return reply.redirect(`${baseUrl}/login?error=missing_code&provider=${providerName}`);
      }

      if (!state) {
        return reply.redirect(`${baseUrl}/login?error=missing_parameters&provider=${providerName}`);
      }

      const result = await this.authProvidersService.handleCallback(
        providerName,
        code,
        state,
        requestContext,
      );

      const jwt = await reply.jwtSign({
        userId: result.user.id,
        isAdmin: result.user.isAdmin,
      });

      this.setAuthCookie(reply, jwt, request.protocol === "https");

      const redirectUrl = result.redirectUrl || "/dashboard";
      const fullRedirectUrl = redirectUrl.startsWith("http")
        ? redirectUrl
        : `${baseUrl}${redirectUrl}`;

      return reply.redirect(fullRedirectUrl);
    } catch (error) {
      return this.handleCallbackError(request, reply, error);
    }
  }

  private handleCallbackError(
    request: FastifyRequest<CallbackRequest>,
    reply: FastifyReply,
    error: unknown,
  ) {
    // Log error for debugging
    request.log.error({ err: error, provider: request.params.provider }, "Auth callback error");

    const { type: errorType, message: errorMessage } =
      error instanceof Error
        ? this.determineCallbackError(error, request.params.provider)
        : { type: "unknown_error", message: ERROR_MESSAGES.AUTHENTICATION_FAILED };

    const requestContext = this.buildRequestContext(request);
    const baseUrl = this.buildBaseUrl(requestContext);
    const encodedMessage = encodeURIComponent(errorMessage);

    return reply.redirect(
      `${baseUrl}/login?error=${errorType}&provider=${request.params.provider}&message=${encodedMessage}`,
    );
  }
}
