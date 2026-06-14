import { prisma } from "../../shared/prisma.js";
import { NotFoundError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { getAppUrl } from "../email/url-builder.js";
import type {
  CreateAuthProviderInput,
  UpdateAuthProviderInput,
  UpdateOfficialProviderInput,
} from "./dto.js";
import { getOAuthCallbackUrl } from "./oauth-callback-url.js";
import { OAuthFlowService } from "./oauth-flow.service.js";
import type { OAuthFlowState } from "./oauth-state.js";
import { providersConfig } from "./providers.config.js";
import type { AuthProviderModel, ProviderConfig } from "./types.js";
import { UserLinkingService } from "./user-linking.service.js";

const DEFAULT_PROVIDER_TYPE = "oidc";

const ERROR_MESSAGES = {
  PROVIDER_NOT_FOUND: "Provider not found or disabled",
  CONFIG_NOT_FOUND: "Configuration not found for provider",
} as const;

/**
 * Material the route needs to set the browser-bound flow cookie after the
 * authorization URL is built (A5-03). The `state`, `nonce`, `codeVerifier`, and
 * `returnPath` are all generated server-side.
 */
export interface AuthorizationResult {
  authUrl: string;
  flowState: OAuthFlowState;
}

export class AuthProvidersService {
  private oauthFlow = new OAuthFlowService();
  private userLinking = new UserLinkingService();

  private validateProvider(provider: AuthProviderModel | null, providerName: string): void {
    if (!provider?.enabled) {
      throw new NotFoundError(`${ERROR_MESSAGES.PROVIDER_NOT_FOUND}: ${providerName}`);
    }
  }

  private validateConfig(config: ProviderConfig | null | undefined, providerName: string): void {
    if (!config) {
      throw new NotFoundError(`${ERROR_MESSAGES.CONFIG_NOT_FOUND}: ${providerName}`);
    }
  }

  private isOfficial(providerName: string): boolean {
    return providerName in providersConfig.officialProviders;
  }

  async getEnabledProviders() {
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

    // A6-01: the public authorize URL is built from the trusted `appUrl`, never
    // from the request Host. Resolved once for the whole list.
    const appOrigin = await this.resolveAppOrigin();

    return providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      displayName: provider.displayName || provider.name,
      type: provider.type,
      icon: provider.icon || "generic",
      authUrl: `${appOrigin}/api/auth/providers/${provider.name}/authorize`,
      isOfficial: this.isOfficial(provider.name),
      sortOrder: provider.sortOrder,
    }));
  }

  private async resolveAppOrigin(): Promise<string> {
    return new URL(await getAppUrl()).origin;
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

  async createProvider(data: CreateAuthProviderInput) {
    const provider = await prisma.authProvider.create({
      data: {
        name: data.name,
        displayName: data.displayName || data.name,
        type: data.type || DEFAULT_PROVIDER_TYPE,
        icon: data.icon,
        enabled: data.enabled ?? false,
        autoRegister: data.autoRegister ?? true,
        scope: data.scope,
        adminEmailDomains: data.adminEmailDomains,
        clientId: data.clientId,
        clientSecret: data.clientSecret,
        issuerUrl: data.issuerUrl,
        authorizationEndpoint: data.authorizationEndpoint,
        tokenEndpoint: data.tokenEndpoint,
        userInfoEndpoint: data.userInfoEndpoint,
      },
      select: AuthProvidersService.SAFE_PROVIDER_SELECT,
    });
    return { ...provider, isOfficial: this.isOfficial(provider.name) };
  }

  async updateProvider(id: string, data: UpdateAuthProviderInput | UpdateOfficialProviderInput) {
    const provider = await prisma.authProvider.update({
      where: { id },
      data,
      select: AuthProvidersService.SAFE_PROVIDER_SELECT,
    });
    return { ...provider, isOfficial: this.isOfficial(provider.name) };
  }

  async deleteProvider(id: string) {
    return await prisma.authProvider.delete({
      where: { id },
    });
  }

  /**
   * Build the IdP authorization URL and the browser-bound flow state.
   *
   * The `state`, `nonce`, and PKCE verifier are generated server-side (A5-03) and
   * the OAuth `redirect_uri` is the fixed, appUrl-derived callback (A5-04 / A6-01).
   * No client `state`/`redirect_uri` is accepted; the only client influence is the
   * optional post-login `returnPath`, which is sanitised to a relative path by the
   * caller before being passed in.
   */
  async getAuthorizationUrl(
    providerName: string,
    returnPath: string,
  ): Promise<AuthorizationResult> {
    const provider = await this.getProviderByName(providerName);
    this.validateProvider(provider, providerName);
    const validatedProvider = provider!;

    const config = this.oauthFlow.getProviderConfig(validatedProvider);
    this.validateConfig(config, providerName);

    const state = this.oauthFlow.generateState();
    const nonce = this.oauthFlow.generateNonce();
    const { codeVerifier, codeChallenge } = this.oauthFlow.setupPkce();

    // Server-fixed callback URL (identical at authorize-time and token-time).
    const callbackUrl = await getOAuthCallbackUrl(providerName);

    const endpoints = await this.oauthFlow.resolveEndpoints(validatedProvider, config);

    const authUrl = await this.oauthFlow.buildAuthorizationUrl(
      validatedProvider,
      endpoints,
      callbackUrl,
      state,
      codeChallenge,
      nonce,
      providerName,
    );

    return {
      authUrl,
      flowState: {
        providerName,
        state,
        nonce,
        codeVerifier,
        returnPath,
      },
    };
  }

  /**
   * Complete the callback using the already-consumed, browser-bound flow state.
   * The caller (route) is responsible for reading + verifying + single-using the
   * flow cookie (A5-03) and passing the validated state here.
   */
  async handleCallback(providerName: string, code: string, flowState: OAuthFlowState) {
    try {
      const provider = await this.getProviderByName(providerName);
      this.validateProvider(provider, providerName);
      const validatedProvider = provider!;

      const config = this.oauthFlow.getProviderConfig(validatedProvider);
      this.validateConfig(config, providerName);

      const { tokens, endpoints } = await this.performTokenExchange(
        validatedProvider,
        config,
        code,
        flowState.codeVerifier,
        providerName,
      );

      // A5-01: OIDC identity comes from the VERIFIED id_token (nonce-bound);
      // oauth2 falls back to the SSRF-guarded userinfo endpoint.
      const userInfo = await this.oauthFlow.resolveIdentity(
        validatedProvider,
        config,
        tokens,
        endpoints,
        flowState.nonce,
      );
      const user = await this.userLinking.findOrCreateUser(userInfo, validatedProvider);

      return {
        user,
        isNewUser: false,
        returnPath: flowState.returnPath,
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
    providerName: string,
  ) {
    const endpoints = await this.oauthFlow.resolveEndpoints(provider, config);
    const authMethod = this.oauthFlow.getAuthMethod(config);

    // Same server-fixed callback URL as authorize-time (A5-04).
    const callbackUrl = await getOAuthCallbackUrl(providerName);

    const tokens = await this.oauthFlow.executeTokenRequest(
      provider,
      code,
      callbackUrl,
      codeVerifier,
      authMethod,
      endpoints,
    );

    return { tokens, endpoints };
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
