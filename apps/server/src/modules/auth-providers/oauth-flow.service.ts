import crypto from "node:crypto";

import { UnauthorizedError, ValidationError } from "../../utils/app-error.js";
import { getLogger } from "../../utils/logger.js";
import { verifyIdToken } from "./id-token.service.js";
import { ssrfSafeFetch } from "./oauth-ssrf.js";
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
  TokenResponse,
} from "./types.js";

const DEFAULT_PROVIDER_TYPE = "oidc";

export class OAuthFlowService {
  generateState(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  generateNonce(): string {
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
        // SSRF-guarded: rejects metadata/private/loopback hosts (A5-05 OAuth).
        const response = await ssrfSafeFetch(discoveryUrl, {
          method: "GET",
          headers: { Accept: "application/json" },
        });

        if (!response.ok) continue;

        const discoveryData = (await response.json()) as {
          issuer?: string;
          authorization_endpoint?: string;
          token_endpoint?: string;
          userinfo_endpoint?: string;
          jwks_uri?: string;
        };
        const endpoints: ProviderEndpoints = {
          authorizationEndpoint: discoveryData.authorization_endpoint || "",
          tokenEndpoint: discoveryData.token_endpoint || "",
          userInfoEndpoint: discoveryData.userinfo_endpoint || "",
          jwksUri: discoveryData.jwks_uri || undefined,
          issuer: discoveryData.issuer || undefined,
        };

        if (endpoints.authorizationEndpoint && endpoints.tokenEndpoint) {
          return endpoints;
        }
      } catch (err) {
        // Never log the discovery response body (it could be an internal-service
        // response leaked via SSRF). Status/name only (A5-10).
        getLogger().warn(
          { reason: err instanceof Error ? err.name : "unknown" },
          "OIDC discovery attempt failed",
        );
      }
    }
    return null;
  }

  /**
   * Generate the PKCE pair. PKCE (S256) is ALWAYS used for the authorization-code
   * flow regardless of provider type (A5-06) — it is harmless even where the IdP
   * also requires a client secret, and it closes code-interception for oauth2
   * providers that previously skipped it.
   */
  setupPkce(): { codeVerifier: string; codeChallenge: string } {
    const codeVerifier = this.generateCodeVerifier();
    const codeChallenge = this.generateCodeChallenge(codeVerifier);
    return { codeVerifier, codeChallenge };
  }

  /** True when the provider is an OIDC provider (id_token verification applies). */
  isOidc(provider: AuthProviderModel): boolean {
    return (provider.type ?? DEFAULT_PROVIDER_TYPE) === DEFAULT_PROVIDER_TYPE;
  }

  async buildAuthorizationUrl(
    provider: AuthProviderModel,
    endpoints: ProviderEndpoints,
    callbackUrl: string,
    state: string,
    codeChallenge: string,
    nonce: string,
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
    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    // Bind the OIDC nonce so the id_token can be tied back to this exact flow.
    if (this.isOidc(provider)) {
      authUrl.searchParams.set("nonce", nonce);
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

    // SSRF-guarded (A5-05 OAuth): the token endpoint may come from discovery or
    // admin config, so it must pass the host policy before any connection.
    const tokenResponse = await ssrfSafeFetch(endpoints.tokenEndpoint, {
      method: "POST",
      headers,
      body,
    });

    if (!tokenResponse.ok) {
      // A5-10: never log the raw IdP body — it may contain tokens, codes, PII, or
      // (combined with SSRF) an internal-service response. Status only.
      getLogger().error({ status: tokenResponse.status }, "OAuth token exchange failed");
      throw new UnauthorizedError("Token exchange failed");
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
    // SSRF-guarded (A5-05 OAuth): the userinfo endpoint may come from discovery
    // or admin config and must pass the host policy before connecting.
    const userInfoResponse = await ssrfSafeFetch(endpoints.userInfoEndpoint, {
      headers: {
        Authorization: `Bearer ${tokens.access_token}`,
        Accept: "application/json",
      },
    });

    if (!userInfoResponse.ok) {
      // A5-10: status only — never the raw IdP/userinfo body.
      getLogger().error({ status: userInfoResponse.status }, "OAuth UserInfo request failed");
      throw new UnauthorizedError("Failed to fetch user info");
    }

    return (await userInfoResponse.json()) as Record<string, unknown>;
  }

  /**
   * Resolve the authoritative federated identity (A5-01).
   *
   * OIDC providers: the signed `id_token` is the source of truth. Its signature,
   * `iss`, `aud`, `exp`/`iat`, and `nonce` are verified against the provider JWKS,
   * and `sub` / `email` / `email_verified` are taken from the VERIFIED claims.
   * The userinfo endpoint is consulted only to enrich non-identity profile fields
   * (name, avatar) — never to establish `sub`, `email`, or verification status.
   *
   * oauth2 providers (no id_token contract, e.g. GitHub/Discord): fall back to the
   * SSRF-guarded userinfo endpoint, deriving `email_verified` from the provider's
   * own verified-email signal where available.
   */
  async resolveIdentity(
    provider: AuthProviderModel,
    config: ProviderConfig,
    tokens: TokenResponse,
    endpoints: ProviderEndpoints,
    expectedNonce: string,
  ): Promise<ProviderUserInfo> {
    if (this.isOidc(provider)) {
      return this.resolveOidcIdentity(provider, config, tokens, endpoints, expectedNonce);
    }
    return this.resolveOauth2Identity(config, tokens, endpoints);
  }

  private async resolveOidcIdentity(
    provider: AuthProviderModel,
    config: ProviderConfig,
    tokens: TokenResponse,
    endpoints: ProviderEndpoints,
    expectedNonce: string,
  ): Promise<ProviderUserInfo> {
    if (!tokens.id_token) {
      throw new UnauthorizedError("OIDC provider returned no id_token");
    }
    if (!endpoints.jwksUri) {
      // Without a JWKS endpoint the id_token signature cannot be verified, so we
      // refuse rather than silently trust it (A5-01).
      throw new UnauthorizedError("OIDC provider exposes no JWKS endpoint; cannot verify id_token");
    }

    const issuer = endpoints.issuer || provider.issuerUrl || "";
    if (!issuer) {
      throw new UnauthorizedError("OIDC issuer is not configured");
    }
    if (!provider.clientId) {
      throw new UnauthorizedError("OIDC client_id is not configured");
    }

    const verified = await verifyIdToken({
      idToken: tokens.id_token,
      issuer,
      audience: provider.clientId,
      jwksUri: endpoints.jwksUri,
      expectedNonce,
    });

    if (!verified.email) {
      throw new ValidationError(`No email found in ${config.name} id_token`);
    }

    // Identity fields come from the VERIFIED claims. Profile fields (name/avatar)
    // are enriched from the claims via the provider's field mappings; these are
    // cosmetic only and never override the verified sub/email.
    const profile = this.extractUserInfo(verified.claims, config);

    return {
      id: verified.sub,
      email: verified.email,
      emailVerified: verified.emailVerified,
      name: profile.name,
      firstName: profile.firstName,
      lastName: profile.lastName,
      avatar: profile.avatar,
    };
  }

  private async resolveOauth2Identity(
    config: ProviderConfig,
    tokens: TokenResponse,
    endpoints: ProviderEndpoints,
  ): Promise<ProviderUserInfo> {
    const rawUserInfo = await this.fetchUserInfo(tokens, endpoints);
    const userInfo = this.extractUserInfo(rawUserInfo, config);

    // Some oauth2 userinfo payloads carry an email_verified flag.
    userInfo.emailVerified =
      rawUserInfo.email_verified === true || rawUserInfo.email_verified === "true";

    if (!userInfo.email && this.requiresEmailFetch(config)) {
      const emailEndpoint = this.getEmailEndpoint(config);
      if (emailEndpoint) {
        const fetched = await this.fetchEmailFromEndpoint(emailEndpoint, tokens.access_token);
        if (fetched) {
          userInfo.email = fetched.email;
          // Only the provider-asserted verified flag counts toward auto-linking.
          userInfo.emailVerified = fetched.verified;
        }
      }
    }

    if (!userInfo.email) {
      throw new ValidationError(`No email found in ${config.name} account`);
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
  ): Promise<{ email: string; verified: boolean } | null> {
    try {
      // SSRF-guarded (A5-05 OAuth): the email endpoint is provider-config-derived.
      const response = await ssrfSafeFetch(endpoint, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (response.ok) {
        const data = (await response.json()) as
          | Array<{ primary?: boolean; verified?: boolean; email?: string }>
          | { email?: string; verified?: boolean };

        if (Array.isArray(data)) {
          const primaryEmail = data.find((e) => e.primary && e.verified);
          if (primaryEmail?.email) return { email: primaryEmail.email, verified: true };

          const verifiedEmail = data.find((e) => e.verified);
          if (verifiedEmail?.email) return { email: verifiedEmail.email, verified: true };

          // Fall back to the first address but mark it UNVERIFIED so it can never
          // auto-link to a pre-existing local account (A5-02).
          if (data.length > 0 && data[0].email) {
            return { email: data[0].email, verified: false };
          }
        } else if (data.email) {
          return { email: data.email, verified: data.verified === true };
        }
      }
    } catch (error) {
      // A5-10: do not log the raw body; name only.
      getLogger().error(
        { reason: error instanceof Error ? error.name : "unknown" },
        "Error fetching email from endpoint",
      );
    }

    return null;
  }
}
