import { z } from "zod";

export const BaseAuthProviderSchema = z.object({
  name: z.string().min(1, "Name is required").describe("Provider name"),
  displayName: z.string().min(1, "Display name is required").describe("Provider display name"),
  type: z.enum(["oidc", "oauth2"]).describe("Provider type"),
  icon: z.string().optional().describe("Provider icon"),
  enabled: z.boolean().default(false).describe("Whether provider is enabled"),
  autoRegister: z.boolean().default(true).describe("Auto-register new users"),
  scope: z.string().optional().describe("OAuth scopes"),
  adminEmailDomains: z.string().optional().describe("Admin email domains (comma-separated)"),
  clientId: z.string().min(1, "Client ID is required").describe("OAuth client ID"),
  clientSecret: z.string().min(1, "Client secret is required").describe("OAuth client secret"),
});

export const CreateAuthProviderSchema = BaseAuthProviderSchema.extend({
  issuerUrl: z.string().url("Invalid issuer URL").optional(),
  authorizationEndpoint: z.string().optional(),
  tokenEndpoint: z.string().optional(),
  userInfoEndpoint: z.string().optional(),
}).refine(
  (data) => {
    const hasIssuerUrl = !!data.issuerUrl;
    const hasAnyCustomEndpoint = !!(
      data.authorizationEndpoint?.trim() ||
      data.tokenEndpoint?.trim() ||
      data.userInfoEndpoint?.trim()
    );

    if (hasIssuerUrl && !hasAnyCustomEndpoint) return true;

    if (hasAnyCustomEndpoint) {
      const hasAllCustomEndpoints = !!(
        data.authorizationEndpoint?.trim() &&
        data.tokenEndpoint?.trim() &&
        data.userInfoEndpoint?.trim()
      );
      return hasAllCustomEndpoints;
    }

    return false;
  },
  {
    message:
      "Either provide issuerUrl for automatic discovery OR all three custom endpoints (authorization, token, userInfo).",
  },
);

export const UpdateAuthProviderSchema = z
  .object({
    name: z.string().min(1).optional(),
    displayName: z.string().min(1).optional(),
    type: z.enum(["oidc", "oauth2"]).optional(),
    icon: z.string().optional(),
    enabled: z.boolean().optional(),
    autoRegister: z.boolean().optional(),
    scope: z.string().optional(),
    adminEmailDomains: z.string().optional(),
    clientId: z.string().min(1).optional(),
    clientSecret: z.string().min(1).optional(),
    issuerUrl: z.string().url().optional(),
    authorizationEndpoint: z.string().optional(),
    tokenEndpoint: z.string().optional(),
    userInfoEndpoint: z.string().optional(),
  })
  .refine(
    (data) => {
      const hasIssuerUrl = !!data.issuerUrl;
      const hasAnyCustomEndpoint = !!(
        data.authorizationEndpoint?.trim() ||
        data.tokenEndpoint?.trim() ||
        data.userInfoEndpoint?.trim()
      );

      if (!hasIssuerUrl && !hasAnyCustomEndpoint) return true;

      if (hasIssuerUrl && !hasAnyCustomEndpoint) return true;

      if (hasAnyCustomEndpoint) {
        const hasAllCustomEndpoints = !!(
          data.authorizationEndpoint?.trim() &&
          data.tokenEndpoint?.trim() &&
          data.userInfoEndpoint?.trim()
        );
        return hasAllCustomEndpoints;
      }

      return true;
    },
    {
      message:
        "When providing custom endpoints, all three endpoints (authorization, token, userInfo) are required.",
    },
  );

export const UpdateOfficialProviderSchema = z.object({
  issuerUrl: z.string().url().optional(),
  clientId: z.string().min(1).optional(),
  clientSecret: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
  autoRegister: z.boolean().optional(),
  adminEmailDomains: z.string().optional(),
  icon: z.string().optional(),
});

export const UpdateProvidersOrderSchema = z.object({
  providers: z.array(
    z.object({
      id: z.string(),
      sortOrder: z.number(),
    }),
  ),
});

// --- Inferred DTO types ---

/**
 * The input type for creating an auth provider (Zod-validated body).
 * Uses z.input to capture the pre-transform shape (before .refine()).
 */
export type CreateAuthProviderInput = z.input<typeof CreateAuthProviderSchema>;

/**
 * The input type for updating a custom auth provider (Zod-validated body).
 */
export type UpdateAuthProviderInput = z.input<typeof UpdateAuthProviderSchema>;

/**
 * The input type for updating an official auth provider (Zod-validated body).
 */
export type UpdateOfficialProviderInput = z.input<typeof UpdateOfficialProviderSchema>;
