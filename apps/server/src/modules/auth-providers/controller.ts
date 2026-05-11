import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../../env.js";
import { NotFoundError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { createRefreshToken } from "../auth/refresh-token.service.js";
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

const COOKIE_MAX_AGE = 7 * 24 * 60 * 60; // seconds (@fastify/cookie maxAge is in seconds)

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
    const requestContext = this.buildRequestContext(request);
    const providers = await this.authProvidersService.getEnabledProviders(requestContext);
    return this.sendSuccessResponse(reply, providers);
  }

  async getAllProviders(_request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    const providers = await this.authProvidersService.getAllProviders();
    return this.sendSuccessResponse(reply, providers);
  }

  async createProvider(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    // Body is validated by Fastify's schema (CreateAuthProviderSchema in routes.ts)
    const data = request.body as CreateAuthProviderInput;

    const validationError = this.validateCustomEndpoints(data);
    if (validationError) {
      throw new ValidationError(validationError);
    }

    const provider = await this.authProvidersService.createProvider(data);
    return this.sendSuccessResponse(reply, provider);
  }

  async updateProvider(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    const { id } = request.params as UpdateProviderRequest["Params"];
    const data = request.body as Record<string, unknown>;

    const existingProvider = await this.authProvidersService.getProviderById(id);
    if (!existingProvider) {
      throw new NotFoundError(ERROR_MESSAGES.PROVIDER_NOT_FOUND);
    }

    if (data.enabled === false && existingProvider.enabled === true) {
      const canDisable = await this.configService.validateAllProvidersDisable();
      if (!canDisable) {
        throw new ValidationError(
          "Cannot disable the last authentication provider when password authentication is disabled",
        );
      }
    }

    const isOfficial = this.authProvidersService.isOfficialProvider(existingProvider.name);

    if (isOfficial) {
      return this.updateOfficialProvider(reply, id, data);
    }

    return this.updateCustomProvider(reply, id, data);
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
        throw new ValidationError(ERROR_MESSAGES.INVALID_URL);
      }

      const provider = await this.authProvidersService.updateProvider(id, validatedData);
      return this.sendSuccessResponse(reply, provider);
    } catch (error) {
      // Re-throw AppErrors (including ValidationError thrown above)
      if (error instanceof ValidationError) throw error;
      // Zod parse errors → validation error
      getLogger().error({ err: error, data }, "Validation error for official provider");
      throw new ValidationError(ERROR_MESSAGES.INVALID_DATA);
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
    } catch (error) {
      if (error instanceof ValidationError) throw error;
      // Zod parse errors → validation error
      getLogger().error({ err: error, data }, "Validation error for custom provider");
      throw new ValidationError(ERROR_MESSAGES.INVALID_DATA);
    }
  }

  async updateProvidersOrder(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    const { providers } = request.body as UpdateProvidersOrderRequest["Body"];

    if (!Array.isArray(providers)) {
      throw new ValidationError(ERROR_MESSAGES.INVALID_PROVIDERS_ARRAY);
    }

    await this.authProvidersService.updateProvidersOrder(providers);
    return this.sendSuccessResponse(reply, undefined, "Providers order updated successfully");
  }

  async deleteProvider(request: FastifyRequest, reply: FastifyReply) {
    if (reply.sent) return;

    const { id } = request.params as DeleteProviderRequest["Params"];

    const provider = await this.authProvidersService.getProviderById(id);
    if (!provider) {
      throw new NotFoundError(ERROR_MESSAGES.PROVIDER_NOT_FOUND);
    }

    const isOfficial = this.authProvidersService.isOfficialProvider(provider.name);
    if (isOfficial) {
      throw new ValidationError(ERROR_MESSAGES.OFFICIAL_CANNOT_DELETE);
    }

    if (provider.enabled) {
      const canDisable = await this.configService.validateAllProvidersDisable();
      if (!canDisable) {
        throw new ValidationError(
          "Cannot delete the last authentication provider when password authentication is disabled",
        );
      }
    }

    await this.authProvidersService.deleteProvider(id);
    return this.sendSuccessResponse(reply, undefined, "Provider deleted successfully");
  }

  async authorize(request: FastifyRequest, reply: FastifyReply) {
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
  }

  async callback(request: FastifyRequest<CallbackRequest>, reply: FastifyReply) {
    // Keep try/catch: callback errors redirect to login page with error params,
    // they don't return JSON error responses.
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
        tokenVersion: result.user.tokenVersion,
      });

      this.setAuthCookie(reply, jwt, request.protocol === "https");

      // Issue a refresh token as an httpOnly cookie so OIDC users
      // can renew their 15-minute access token without re-authenticating.
      const userAgent = request.headers["user-agent"] || "";
      const ipAddress = request.ip || request.socket.remoteAddress || "";
      const refreshToken = await createRefreshToken(result.user.id, userAgent, ipAddress);

      const isSecure = env.SECURE_SITE === "true";
      reply.setCookie("refresh_token", refreshToken, {
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        path: "/api/auth/refresh",
        maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
      });

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
