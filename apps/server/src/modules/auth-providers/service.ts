import { getLogger } from "../../utils/logger.js";
import { prisma } from "../../shared/prisma.js";
import { providersConfig } from "./providers.config.js";
import { OAuthFlowService } from "./oauth-flow.service.js";
import { UserLinkingService } from "./user-linking.service.js";
import type { Prisma } from "@prisma/client";
import type {
  AuthProviderModel,
  PendingState,
  ProviderConfig,
  RequestContextService,
} from "./types.js";

const STATE_EXPIRY_TIME = 600000; // 10 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
const DEFAULT_PROVIDER_TYPE = "oidc";

const ERROR_MESSAGES = {
  PROVIDER_NOT_FOUND: "Provider not found or disabled",
  CONFIG_NOT_FOUND: "Configuration not found for provider",
  INVALID_STATE: "Invalid or expired state",
} as const;

export class AuthProvidersService {
  private pendingStates = new Map<string, PendingState>();
  private oauthFlow = new OAuthFlowService();
  private userLinking = new UserLinkingService();

  constructor() {
    setInterval(() => this.cleanupExpiredStates(), CLEANUP_INTERVAL);
  }

  private createPendingState(
    providerId: string,
    codeVerifier: string,
    redirectUrl: string,
  ): PendingState {
    return {
      codeVerifier,
      redirectUrl,
      expiresAt: Date.now() + STATE_EXPIRY_TIME,
      providerId,
    };
  }

  private validateProvider(provider: AuthProviderModel | null, providerName: string): void {
    if (!provider?.enabled) {
      throw new Error(`${ERROR_MESSAGES.PROVIDER_NOT_FOUND}: ${providerName}`);
    }
  }

  private validateConfig(config: ProviderConfig | null | undefined, providerName: string): void {
    if (!config) {
      throw new Error(`${ERROR_MESSAGES.CONFIG_NOT_FOUND}: ${providerName}`);
    }
  }

  private isOfficial(providerName: string): boolean {
    return providerName in providersConfig.officialProviders;
  }

  private validateAndGetPendingState(state: string): PendingState {
    const pendingState = this.pendingStates.get(state);

    if (!pendingState) {
      throw new Error(ERROR_MESSAGES.INVALID_STATE);
    }

    return pendingState;
  }

  async getEnabledProviders(requestContext?: RequestContextService) {
    const providers = await prisma.authProvider.findMany({
      where: { enabled: true },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        name: true,
        displayName: true,
        type: true,
        enabled: true,
        issuerUrl: true,
        icon: true,
        sortOrder: true,
      },
    });

    return providers.map((provider) => {
      const authUrl = this.generateAuthUrl(provider, requestContext);

      return {
        id: provider.id,
        name: provider.name,
        displayName: provider.displayName || provider.name,
        type: provider.type,
        icon: provider.icon || "generic",
        authUrl,
        isOfficial: this.isOfficial(provider.name),
        sortOrder: provider.sortOrder,
      };
    });
  }

  private static readonly SAFE_PROVIDER_SELECT = {
    id: true,
    name: true,
    displayName: true,
    type: true,
    icon: true,
    enabled: true,
    autoRegister: true,
    scope: true,
    adminEmailDomains: true,
    clientId: true,
    issuerUrl: true,
    authorizationEndpoint: true,
    tokenEndpoint: true,
    userInfoEndpoint: true,
    sortOrder: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async getAllProviders() {
    const providers = await prisma.authProvider.findMany({
      orderBy: { sortOrder: "asc" },
      select: AuthProvidersService.SAFE_PROVIDER_SELECT,
    });

    return providers.map((provider) => ({
      ...provider,
      isOfficial: this.isOfficial(provider.name),
    }));
  }

  async getProviderByName(name: string) {
    return await prisma.authProvider.findFirst({
      where: { name },
    });
  }

  async getProviderById(id: string) {
    return await prisma.authProvider.findUnique({
      where: { id },
    });
  }

  isOfficialProvider(providerName: string): boolean {
    return this.isOfficial(providerName);
  }

  async createProvider(data: Prisma.AuthProviderCreateInput) {
    return await prisma.authProvider.create({
      data: {
        ...data,
        type: (typeof data.type === "string" && data.type) ? data.type : DEFAULT_PROVIDER_TYPE,
        displayName: (typeof data.displayName === "string" && data.displayName)
          ? data.displayName
          : (typeof data.name === "string" ? data.name : ""),
      },
      select: AuthProvidersService.SAFE_PROVIDER_SELECT,
    });
  }

  async updateProvider(id: string, data: Prisma.AuthProviderUpdateInput) {
    return await prisma.authProvider.update({
      where: { id },
      data,
      select: AuthProvidersService.SAFE_PROVIDER_SELECT,
    });
  }

  async deleteProvider(id: string) {
    return await prisma.authProvider.delete({
      where: { id },
    });
  }

  private generateAuthUrl(provider: Pick<AuthProviderModel, "name">, requestContext?: RequestContextService) {
    const baseUrl = this.oauthFlow.buildBaseUrl(requestContext);
    return `${baseUrl}/api/auth/providers/${provider.name}/authorize`;
  }

  async getAuthorizationUrl(
    providerName: string,
    state?: string,
    redirectUri?: string,
    requestContext?: RequestContextService,
  ) {
    const provider = await this.getProviderByName(providerName);
    this.validateProvider(provider, providerName);
    const validatedProvider = provider!;

    const config = this.oauthFlow.getProviderConfig(validatedProvider);
    this.validateConfig(config, providerName);

    const finalState = state || this.oauthFlow.generateState();
    const baseUrl = this.oauthFlow.buildBaseUrl(requestContext);
    const callbackUrl = redirectUri || `${baseUrl}/api/auth/providers/${providerName}/callback`;

    const { codeVerifier, codeChallenge } = this.oauthFlow.setupPkceIfNeeded(validatedProvider);

    const pendingState = this.createPendingState(
      validatedProvider.id,
      codeVerifier || "",
      redirectUri || `${baseUrl}/dashboard`,
    );
    this.pendingStates.set(finalState, pendingState);

    const endpoints = await this.oauthFlow.resolveEndpoints(validatedProvider, config);

    const finalAuthUrl = await this.oauthFlow.buildAuthorizationUrl(
      validatedProvider,
      endpoints,
      callbackUrl,
      finalState,
      codeChallenge,
      providerName,
    );

    return finalAuthUrl;
  }

  async handleCallback(
    providerName: string,
    code: string,
    state: string,
    requestContext?: RequestContextService,
  ) {
    try {
      const pendingState = this.validateAndGetPendingState(state);

      const provider = await this.getProviderByName(providerName);
      this.validateProvider(provider, providerName);
      const validatedProvider = provider!;

      const config = this.oauthFlow.getProviderConfig(validatedProvider);
      this.validateConfig(config, providerName);

      const authResult = await this.performTokenExchange(
        validatedProvider,
        config,
        code,
        pendingState.codeVerifier,
        requestContext,
      );

      const userInfo = await this.oauthFlow.processUserInfo(
        authResult.userInfo,
        authResult.tokens,
        config,
      );
      const user = await this.userLinking.findOrCreateUser(userInfo, validatedProvider);

      return {
        user,
        isNewUser: false,
        redirectUrl: pendingState.redirectUrl,
      };
    } catch (error) {
      getLogger().error({ err: error }, "Error in handleCallback");
      throw error;
    }
  }

  private async performTokenExchange(
    provider: AuthProviderModel,
    config: ProviderConfig,
    code: string,
    codeVerifier: string,
    requestContext?: RequestContextService,
  ) {
    const endpoints = await this.oauthFlow.resolveEndpoints(provider, config);
    const authMethod = this.oauthFlow.getAuthMethod(config);

    const baseUrl = this.oauthFlow.buildBaseUrl(requestContext);
    const callbackUrl =
      provider.redirectUri || `${baseUrl}/api/auth/providers/${provider.name}/callback`;

    const tokens = await this.oauthFlow.executeTokenRequest(
      provider,
      code,
      callbackUrl,
      codeVerifier,
      authMethod,
      endpoints,
    );
    const rawUserInfo = await this.oauthFlow.fetchUserInfo(tokens, endpoints);

    return {
      userInfo: rawUserInfo,
      tokens,
    };
  }

  private cleanupExpiredStates() {
    const now = Date.now();
    for (const [state, data] of this.pendingStates.entries()) {
      if (data.expiresAt < now) {
        this.pendingStates.delete(state);
      }
    }
  }

  async updateProvidersOrder(providersOrder: { id: string; sortOrder: number }[]) {
    const updatePromises = providersOrder.map((provider) =>
      prisma.authProvider.update({
        where: { id: provider.id },
        data: { sortOrder: provider.sortOrder },
      }),
    );

    await prisma.$transaction(updatePromises);
    return { success: true };
  }
}
