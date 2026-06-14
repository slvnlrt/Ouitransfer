import type { ProviderConfig, ProvidersConfigFile } from "./types.js";

const PROVIDER_PATTERNS = [
  { pattern: "frontegg.com", type: "frontegg" },
  { pattern: "discord.com", type: "discord" },
  { pattern: "github.com", type: "github" },
  { pattern: "gitlab.com", type: "gitlab" },
  { pattern: "google.com", type: "google" },
  { pattern: "microsoft.com", type: "microsoft" },
  { pattern: "authentik", type: "authentik" },
  { pattern: "keycloak", type: "keycloak" },
  { pattern: "auth0.com", type: "auth0" },
  { pattern: "okta.com", type: "okta" },
  { pattern: "kinde.com", type: "kinde" },
  { pattern: "zitadel.com", type: "zitadel" },
  { pattern: "pocketid", type: "pocketid" },
] as const;

const DEFAULT_SCOPES_BY_TYPE: Record<string, string[]> = {
  frontegg: ["openid", "profile", "email"],
  discord: ["identify", "email"],
  github: ["read:user", "user:email"],
  gitlab: ["read_user", "read_api"],
  google: ["openid", "profile", "email"],
  microsoft: ["openid", "profile", "email", "User.Read"],
  authentik: ["openid", "profile", "email"],
  keycloak: ["openid", "profile", "email"],
  auth0: ["openid", "profile", "email"],
  okta: ["openid", "profile", "email"],
  kinde: ["openid", "profile", "email"],
  zitadel: ["openid", "profile", "email"],
  pocketid: ["openid", "profile", "email"],
} as const;

const DISCOVERY_SUPPORTED_PROVIDERS = [
  "frontegg",
  "oidc",
  "authentik",
  "keycloak",
  "auth0",
  "okta",
  "google",
  "microsoft",
  "kinde",
  "zitadel",
  "pocketid",
] as const;

export const DISCOVERY_PATHS = [
  "/.well-known/openid_configuration",
  "/.well-known/openid-configuration",
  "/.well-known/oauth-authorization-server",
] as const;

const FALLBACK_ENDPOINTS: Record<
  string,
  { authorizationEndpoint: string; tokenEndpoint: string; userInfoEndpoint: string }
> = {
  frontegg: {
    authorizationEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    userInfoEndpoint: "/api/oauth/userinfo",
  },
  github: {
    authorizationEndpoint: "/login/oauth/authorize",
    tokenEndpoint: "/login/oauth/access_token",
    userInfoEndpoint: "/user",
  },
  gitlab: {
    authorizationEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    userInfoEndpoint: "/api/v4/user",
  },
  discord: {
    authorizationEndpoint: "/oauth2/authorize",
    tokenEndpoint: "/oauth2/token",
    userInfoEndpoint: "/users/@me",
  },
  oidc: {
    authorizationEndpoint: "/oauth2/authorize",
    tokenEndpoint: "/oauth2/token",
    userInfoEndpoint: "/oauth2/userinfo",
  },
  pocketid: {
    authorizationEndpoint: "/authorize",
    tokenEndpoint: "/api/oidc/token",
    userInfoEndpoint: "/api/oidc/userinfo",
  },
} as const;

/**
 * Official technical configuration for Discord
 * OAuth2 with Discord-specific field mappings
 * Endpoints come from the database
 */
const discordConfig: ProviderConfig = {
  supportsDiscovery: false,
  authMethod: "body",
  fieldMappings: {
    id: ["id"],
    email: ["email"],
    name: ["global_name", "username"],
    firstName: ["global_name"],
    lastName: [],
    avatar: ["avatar"],
  },
};

/**
 * Official technical configuration for Google
 * OAuth2 with automatic OIDC discovery
 * Endpoints come from the database
 */
const googleConfig: ProviderConfig = {
  supportsDiscovery: true,
  discoveryEndpoint: "/.well-known/openid_configuration",
  authMethod: "body",
  fieldMappings: {
    id: ["sub"],
    email: ["email"],
    name: ["name"],
    firstName: ["given_name"],
    lastName: ["family_name"],
    avatar: ["picture"],
  },
};

/**
 * Official technical configuration for GitHub
 * OAuth2 with separate email fetch
 * Endpoints come from the database
 */
const githubConfig: ProviderConfig = {
  supportsDiscovery: false,
  authMethod: "body",
  specialHandling: {
    emailEndpoint: "https://api.github.com/user/emails",
    emailFetchRequired: true,
    responseFormat: "json",
  },
  fieldMappings: {
    // A5-12: bind identity to the immutable numeric `id` ONLY. `login` is a
    // mutable, recyclable username and must never be the external subject.
    id: ["id"],
    email: ["email"],
    name: ["name", "login"],
    firstName: ["name"],
    lastName: [],
    avatar: ["avatar_url"],
  },
};

/**
 * Official technical configuration for Auth0
 * OIDC with automatic discovery
 * Endpoints come from the database
 */
const auth0Config: ProviderConfig = {
  supportsDiscovery: true,
  discoveryEndpoint: "/.well-known/openid_configuration",
  authMethod: "body",
  fieldMappings: {
    id: ["sub"],
    email: ["email"],
    name: ["name"],
    firstName: ["given_name"],
    lastName: ["family_name"],
    avatar: ["picture"],
  },
};

/**
 * Official technical configuration for Kinde
 * OIDC with custom field mappings
 * Endpoints come from the database
 */
const kindeConfig: ProviderConfig = {
  supportsDiscovery: true,
  discoveryEndpoint: "/.well-known/openid_configuration",
  authMethod: "body",
  fieldMappings: {
    id: ["id"],
    email: ["preferred_email"],
    name: ["first_name", "last_name"],
    firstName: ["first_name"],
    lastName: ["last_name"],
    avatar: ["picture"],
  },
};

/**
 * Official technical configuration for Zitadel
 * OIDC with Basic Auth
 * Endpoints come from the database
 */
const zitadelConfig: ProviderConfig = {
  supportsDiscovery: true,
  discoveryEndpoint: "/.well-known/openid_configuration",
  authMethod: "basic",
  fieldMappings: {
    id: ["sub"],
    email: ["email"],
    name: ["name"],
    firstName: ["given_name"],
    lastName: ["family_name"],
    avatar: ["picture"],
  },
};

/**
 * Official technical configuration for Authentik
 * Self-hosted OIDC with discovery
 * Endpoints come from the database
 */
const authentikConfig: ProviderConfig = {
  supportsDiscovery: true,
  discoveryEndpoint: "/.well-known/openid_configuration",
  authMethod: "body",
  fieldMappings: {
    id: ["sub"],
    email: ["email"],
    name: ["name"],
    firstName: ["given_name"],
    lastName: ["family_name"],
    avatar: ["picture"],
  },
};

/**
 * Official technical configuration for Frontegg
 * Multi-tenant OIDC with automatic discovery
 * Endpoints come from the database
 */
const fronteggConfig: ProviderConfig = {
  supportsDiscovery: true,
  discoveryEndpoint: "/.well-known/openid-configuration",
  authMethod: "body",
  fieldMappings: {
    id: ["sub", "id", "user_id"],
    email: ["email", "preferred_username"],
    name: ["name", "preferred_username"],
    firstName: ["given_name", "name"],
    lastName: ["family_name"],
    avatar: ["picture"],
  },
};

/**
 * Official technical configuration for Pocket ID
 * OIDC with automatic discovery
 * Endpoints come from the database
 */
const pocketidConfig: ProviderConfig = {
  supportsDiscovery: true,
  discoveryEndpoint: "/.well-known/openid-configuration",
  authMethod: "body",
  fieldMappings: {
    id: ["sub"],
    email: ["email"],
    name: ["name", "preferred_username"],
    firstName: ["given_name"],
    lastName: ["family_name"],
    avatar: ["picture"],
  },
  specialHandling: {
    emailFetchRequired: false,
    responseFormat: "json",
  },
};

/**
 * Generic template for custom providers
 * Automatically detects common patterns and adapts accordingly
 */
const genericProviderTemplate: ProviderConfig = {
  supportsDiscovery: true,
  discoveryEndpoint: "/.well-known/openid_configuration",
  fallbackEndpoints: {
    authorizationEndpoint: "/oauth2/authorize",
    tokenEndpoint: "/oauth2/token",
    userInfoEndpoint: "/oauth2/userinfo",
  },
  authMethod: "body",
  specialHandling: {
    emailEndpoint: "",
    emailFetchRequired: false,
    responseFormat: "json",
  },

  fieldMappings: {
    // A5-12: identity binds to an immutable subject claim only — `sub` (OIDC) and
    // a small set of stable provider-specific id claims. Mutable usernames
    // (`login`, `username`, etc.) are deliberately excluded so a recycled username
    // can never collide with an existing external-id linkage.
    id: ["sub", "user_id", "uid", "account_id"],
    email: ["email", "mail", "email_address", "preferred_email", "primary_email"],
    name: [
      "name",
      "display_name",
      "full_name",
      "username",
      "login",
      "first_name last_name",
      "given_name family_name",
    ],
    firstName: ["given_name", "first_name", "firstname", "first", "name"],
    lastName: ["family_name", "last_name", "lastname", "last", "surname"],
    avatar: ["picture", "avatar", "avatar_url", "profile_picture", "photo", "image", "thumbnail"],
  },
};

/**
 * Complete providers configuration
 * Exports all official providers and the generic template
 */
export const providersConfig: ProvidersConfigFile = {
  officialProviders: {
    google: googleConfig,
    discord: discordConfig,
    github: githubConfig,
    auth0: auth0Config,
    kinde: kindeConfig,
    zitadel: zitadelConfig,
    authentik: authentikConfig,
    frontegg: fronteggConfig,
    pocketid: pocketidConfig,
  },
  genericProviderTemplate,
};

export function detectProviderType(issuerUrl: string): string {
  const url = issuerUrl.toLowerCase();

  for (const { pattern, type } of PROVIDER_PATTERNS) {
    if (url.includes(pattern)) {
      return type;
    }
  }

  try {
    return new URL(issuerUrl).hostname.replace("www.", "");
  } catch {
    return "custom";
  }
}

export function getProviderScopes(
  provider: Pick<
    { scope?: string | null; issuerUrl?: string | null; type?: string },
    "scope" | "issuerUrl" | "type"
  >,
): string[] {
  if (provider.scope) {
    return provider.scope.split(" ").filter((s: string) => s.trim());
  }

  const detectedType = detectProviderType(provider.issuerUrl || "");
  return (
    DEFAULT_SCOPES_BY_TYPE[detectedType] ||
    (provider.type ? DEFAULT_SCOPES_BY_TYPE[provider.type] : undefined) || [
      "openid",
      "profile",
      "email",
    ]
  );
}

export function shouldSupportDiscovery(providerType: string): boolean {
  return DISCOVERY_SUPPORTED_PROVIDERS.includes(
    providerType as (typeof DISCOVERY_SUPPORTED_PROVIDERS)[number],
  );
}

export function getFallbackEndpoints(providerType: string): {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
} {
  return FALLBACK_ENDPOINTS[providerType] || FALLBACK_ENDPOINTS.oidc;
}
