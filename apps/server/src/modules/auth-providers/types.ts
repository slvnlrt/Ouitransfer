import type { AuthProvider } from "../../generated/prisma/client.js";

export interface ProviderConfig {
  name?: string;
  issuerUrl?: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userInfoEndpoint?: string;
  supportsDiscovery: boolean;
  discoveryEndpoint?: string;
  fallbackEndpoints?: {
    authorizationEndpoint: string;
    tokenEndpoint: string;
    userInfoEndpoint: string;
  };
  authMethod: "body" | "basic" | "header";
  specialHandling?: {
    emailEndpoint?: string;
    emailFetchRequired?: boolean;
    responseFormat?: string;
  };
  fieldMappings: {
    id: string[];
    email: string[];
    name: string[];
    firstName: string[];
    lastName: string[];
    avatar: string[];
  };
}

export interface ProvidersConfigFile {
  officialProviders: Record<string, ProviderConfig>;
  genericProviderTemplate: ProviderConfig;
}

export interface ProviderEndpoints {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
  /**
   * OIDC `jwks_uri` (from discovery) — the URL of the provider's public signing
   * keys, used to verify the id_token (A5-01). Absent for non-OIDC oauth2
   * providers and for manually-configured endpoints without discovery.
   */
  jwksUri?: string;
  /**
   * The issuer (`iss`) the provider claims in its discovery document. When
   * present this is the value the id_token `iss` MUST equal; otherwise the
   * configured `issuerUrl` is used.
   */
  issuer?: string;
}

export interface ProviderUserInfo {
  id: string;
  email: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  avatar?: string;
  /**
   * Whether the IdP proved the user owns `email`:
   *   - OIDC: the `email_verified` claim from the VERIFIED id_token.
   *   - oauth2 (e.g. GitHub): only true when the provider's email endpoint marks
   *     the address verified.
   * Gates auto-linking to a pre-existing local account (A5-02).
   */
  emailVerified?: boolean;
  [key: string]: string | boolean | undefined;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

/**
 * Alias for the Prisma-generated AuthProvider type.
 */
export type AuthProviderModel = AuthProvider;
