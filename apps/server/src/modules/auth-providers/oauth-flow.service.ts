import crypto from "node:crypto";

import { UnauthorizedError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import {
  DISCOVERY_PATHS,
  detectProviderType,
  getFallbackEndpoints,
  getProviderScopes,
  providersConfig,
  shouldSupportDiscovery,
} from "./providers.config.js";
import type {
  AuthProviderModel,
  ProviderConfig,
  ProviderEndpoints,
  ProviderUserInfo,
  RequestContextService,
  TokenResponse,
} from "./types.js";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_PROVIDER_TYPE = "oidc";

export class OAuthFlowService {
  buildBaseUrl(requestContext?: RequestContextService): string {
    return requestContext
      ? `${requestContext.protocol}://${requestContext.host}`
      : DEFAULT_BASE_URL;
  }

  generateState(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  generateCodeVerifier(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  generateCodeChallenge(codeVerifier: string): string {
    return crypto.createHash("sha256").update(codeVerifier).digest("base64url");
  }

  getProviderConfig(provider: AuthProviderModel): ProviderConfig {
    const officialConfig = providersConfig.officialProviders[provider.name];
    if (officialConfig) {
      return officialConfig;
    }

    const detectedType = detectProviderType(provider.issuerUrl || "");
    const providerType = provider.type || detectedType;

    return {
      ...providersConfig.genericProviderTemplate,
      name: provider.name,
      supportsDiscovery: shouldSupportDiscovery(providerType),
      discoveryEndpoint: "/.well-known/openid_configuration",
      fallbackEndpoints: getFallbackEndpoints(providerType),
      authMethod: "body",
      fieldMappings: providersConfig.genericProviderTemplate.fieldMappings,
      specialHandling: providersConfig.genericProviderTemplate.specialHandling,
    };
  }

  async resolveEndpoints(
    provider: AuthProviderModel,
    config: ProviderConfig,
  ): Promise<ProviderEndpoints> {
    if (provider.authorizationEndpoint && provider.tokenEndpoint && provider.userInfoEndpoint) {
      return {
        authorizationEndpoint: this.resolveEndpointUrl(
          provider.authorizationEndpoint,
          provider.issuerUrl ?? undefined,
        ),
        tokenEndpoint: this.resolveEndpointUrl(
          provider.tokenEndpoint,
          provider.issuerUrl ?? undefined,
        ),
        userInfoEndpoint: this.resolveEndpointUrl(
          provider.userInfoEndpoint,
          provider.issuerUrl ?? undefined,
        ),
      };
    }

    if (config.supportsDiscovery && provider.issuerUrl) {
      const discoveredEndpoints = await this.attemptDiscovery(provider.issuerUrl);
      if (discoveredEndpoints) {
        return discoveredEndpoints;
      }
    }

    const baseUrl = provider.issuerUrl?.replace(/\/$/, "") || "";
    const detectedType = detectProviderType(provider.issuerUrl || "");
    const fallbackPattern = getFallbackEndpoints(detectedType);

    return {
      authorizationEndpoint: `${baseUrl}${fallbackPattern.authorizationEndpoint}`,
      tokenEndpoint: `${baseUrl}${fallbackPattern.tokenEndpoint}`,
      userInfoEndpoint: `${baseUrl}${fallbackPattern.userInfoEndpoint}`,
    };
  }

  private resolveEndpointUrl(endpoint: string, issuerUrl?: string): string {
    if (endpoint.startsWith("http://") || endpoint.startsWith("https://")) {
      return endpoint;
    }

    if (!issuerUrl) {
      return endpoint;
    }

    const baseUrl = issuerUrl.replace(/\/$/, "");
    const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
    return `${baseUrl}${path}`;
  }

  private async attemptDiscovery(issuerUrl: string): Promise<ProviderEndpoints | null> {
    for (const discoveryPath of DISCOVERY_PATHS) {
      try {
        const discoveryUrl = `${issuerUrl}${discoveryPath}`;
        const response = await fetch(discoveryUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) continue;

        const discoveryData = (await response.json()) as {
          authorization_endpoint?: string;
          token_endpoint?: string;
          userinfo_endpoint?: string;
        };
        const endpoints = {
          authorizationEndpoint: discoveryData.authorization_endpoint || "",
          tokenEndpoint: discoveryData.token_endpoint || "",
          userInfoEndpoint: discoveryData.userinfo_endpoint || "",
        };

        if (endpoints.authorizationEndpoint && endpoints.tokenEndpoint) {
          return endpoints;
        }
      } catch {}
    }
    return null;
  }

  setupPkceIfNeeded(provider: AuthProviderModel): {
    codeVerifier?: string;
    codeChallenge?: string;
  } {
    const needsPkce = provider.type === DEFAULT_PROVIDER_TYPE;

    if (needsPkce) {
      const codeVerifier = this.generateCodeVerifier();
      const codeChallenge = this.generateCodeChallenge(codeVerifier);
      return { codeVerifier, codeChallenge };
    }

    return {};
  }

  async buildAuthorizationUrl(
    provider: AuthProviderModel,
    endpoints: ProviderEndpoints,
    callbackUrl: string,
    state: string,
    codeChallenge?: string,
    providerName?: string,
  ): Promise<string> {
    if (!provider.clientId) {
      throw new ValidationError(
        `Client ID not configured for provider: ${providerName || provider.name}`,
      );
    }

    const authUrl = new URL(endpoints.authorizationEndpoint);
    const scopes = getProviderScopes(provider);
    authUrl.searchParams.set("client_id", provider.clientId);
    authUrl.searchParams.set("redirect_uri", callbackUrl);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes.join(" "));
    authUrl.searchParams.set("state", state);

    if (codeChallenge) {
      authUrl.searchParams.set("code_challenge", codeChallenge);
      authUrl.searchParams.set("code_challenge_method", "S256");
    }

    return authUrl.toString();
  }

  async executeTokenRequest(
    provider: AuthProviderModel,
    code: string,
    callbackUrl: string,
    codeVerifier: string,
    authMethod: string,
    endpoints: ProviderEndpoints,
  ): Promise<TokenResponse> {
    const body = new URLSearchParams();
    body.append("client_id", provider.clientId ?? "");
    body.append("code", code);
    body.append("redirect_uri", callbackUrl);
    body.append("grant_type", "authorization_code");

    if (authMethod === "body" && provider.clientSecret) {
      body.append("client_secret", provider.clientSecret);
    }

    if (codeVerifier) {
      body.append("code_verifier", codeVerifier);
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (authMethod === "basic" && provider.clientSecret) {
      const auth = Buffer.from(`${provider.clientId}:${provider.clientSecret}`).toString("base64");
      headers.Authorization = `Basic ${auth}`;
    }

    const tokenResponse = await fetch(endpoints.tokenEndpoint, {
      method: "POST",
      headers,
      body,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      throw new UnauthorizedError(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
    }

    const tokens = (await tokenResponse.json()) as TokenResponse;

    if (!tokens.access_token) {
      throw new UnauthorizedError("No access token received");
    }

    return tokens;
  }

  async fetchUserInfo(
    tokens: TokenResponse,
    endpoints: ProviderEndpoints,
  ): Promise<Record<string, unknown>> {
    const userInfoResponse = await fetch(endpoints.userInfoEndpoint, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json",
      },
    });

    if (!userInfoResponse.ok) {
      const errorText = await userInfoResponse.text();
      throw new UnauthorizedError(
        `UserInfo request failed: ${userInfoResponse.status} - ${errorText}`,
      );
    }

    return (await userInfoResponse.json()) as Record<string, unknown>;
  }

  async processUserInfo(
    rawUserInfo: Record<string, unknown>,
    tokens: TokenResponse,
    config: ProviderConfig,
  ): Promise<ProviderUserInfo> {
    const userInfo = this.extractUserInfo(rawUserInfo, config);

    if (!userInfo.email && this.requiresEmailFetch(config)) {
      const emailEndpoint = this.getEmailEndpoint(config);
      if (emailEndpoint) {
        const email = await this.fetchEmailFromEndpoint(emailEndpoint, tokens.access_token);
        if (email) {
          userInfo.email = email;
        }
      }
    }

    if (!userInfo.email) {
      throw new ValidationError(`No email address found in ${config.name} account`);
    }

    return userInfo;
  }

  getAuthMethod(config: ProviderConfig): "body" | "basic" | "header" {
    return config.authMethod || "body";
  }

  private extractUserInfo(
    rawUserInfo: Record<string, unknown>,
    config: ProviderConfig,
  ): ProviderUserInfo {
    const userInfo: ProviderUserInfo = { id: "", email: "" };
    const mappings = config.fieldMappings;

    userInfo.id = this.extractField(rawUserInfo, mappings.id) || "";
    userInfo.email = this.extractField(rawUserInfo, mappings.email) || "";
    userInfo.name = this.extractField(rawUserInfo, mappings.name);
    userInfo.firstName = this.extractField(rawUserInfo, mappings.firstName);
    userInfo.lastName = this.extractField(rawUserInfo, mappings.lastName);
    userInfo.avatar = this.extractField(rawUserInfo, mappings.avatar);

    return userInfo;
  }

  private extractField(obj: Record<string, unknown>, fieldNames: string[]): string | undefined {
    if (!obj || !fieldNames.length) return undefined;

    for (const fieldName of fieldNames) {
      if (obj[fieldName] !== undefined && obj[fieldName] !== null) {
        return String(obj[fieldName]);
      }
    }

    return undefined;
  }

  private requiresEmailFetch(config: ProviderConfig): boolean {
    return config.specialHandling?.emailFetchRequired || false;
  }

  private getEmailEndpoint(config: ProviderConfig): string | null {
    return config.specialHandling?.emailEndpoint || null;
  }

  private async fetchEmailFromEndpoint(
    endpoint: string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const response = await fetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const data = (await response.json()) as
          | Array<{ primary?: boolean; verified?: boolean; email?: string }>
          | { email?: string };

        if (Array.isArray(data)) {
          const primaryEmail = data.find((e) => e.primary && e.verified);
          if (primaryEmail) return primaryEmail.email ?? null;

          const verifiedEmail = data.find((e) => e.verified);
          if (verifiedEmail) return verifiedEmail.email ?? null;

          if (data.length > 0 && data[0].email) return data[0].email;
        }

        if ((data as { email?: string }).email) return (data as { email: string }).email;
      }
    } catch (error) {
      getLogger().error({ err: error }, "Error fetching email from endpoint");
    }

    return null;
  }
}
