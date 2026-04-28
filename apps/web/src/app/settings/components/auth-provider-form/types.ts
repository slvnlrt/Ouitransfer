/** Form data shape for a single auth provider being edited. */
export interface ProviderFormData {
  name: string;
  displayName: string;
  type: "oidc" | "oauth2";
  icon: string;
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  scope: string;
  autoRegister: boolean;
  adminEmailDomains: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  userInfoEndpoint: string;
}

/** Map of provider ID → form data for providers currently being edited. */
export type ProviderFormDataMap = Record<string, ProviderFormData>;
