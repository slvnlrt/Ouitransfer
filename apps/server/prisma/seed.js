import crypto from "node:crypto";
import dotenv from "dotenv";
import { createPrismaClient } from "../src/shared/prisma-factory.js";

dotenv.config({ path: [".env", ".env.development"] });

const prisma = createPrismaClient();

const defaultConfigs = [
  // General Configurations
  {
    key: "appName",
    value: "Ouitransfer",
    type: "string",
    group: "general",
  },
  {
    key: "showHomePage",
    value: "true",
    type: "boolean",
    group: "general",
  },
  {
    key: "hideVersion",
    value: "false",
    type: "boolean",
    group: "general",
  },
  {
    key: "appDescription",
    value: "Self-hosted file transfer platform",
    type: "string",
    group: "general",
  },
  {
    key: "appLogo",
    value: "",
    type: "string",
    group: "general",
  },
  {
    key: "firstUserAccess",
    value: "true",
    type: "boolean",
    group: "general",
  },
  {
    key: "footerEnabled",
    value: "true",
    type: "boolean",
    group: "general",
  },
  {
    key: "footerText",
    value: "My Organization",
    type: "string",
    group: "general",
  },
  {
    key: "footerUrl",
    value: "https://example.com",
    type: "string",
    group: "general",
  },
  // Storage Configurations
  {
    key: "maxFileSize",
    value: "1073741824", // default 1GiB in bytes
    type: "bigint",
    group: "storage",
  },
  {
    key: "maxTotalStoragePerUser",
    value: "10737418240", // 10GB in bytes
    type: "bigint",
    group: "storage",
  },
  // Security Configurations
  {
    key: "embedSecret",
    value: crypto.randomBytes(32).toString("hex"),
    type: "string",
    group: "security",
  },
  {
    key: "maxLoginAttempts",
    value: "5",
    type: "number",
    group: "security",
  },
  {
    key: "loginBlockDuration",
    value: "600", // 10 minutes in seconds
    type: "number",
    group: "security",
  },
  {
    key: "passwordMinLength",
    value: "8",
    type: "number",
    group: "security",
  },
  {
    key: "auditRetentionDays",
    value: "365",
    type: "number",
    group: "security",
  },
  // Email Configurations
  {
    key: "smtpEnabled",
    value: "false",
    type: "boolean",
    group: "email",
  },
  {
    key: "smtpHost",
    value: "",
    type: "string",
    group: "email",
  },
  {
    key: "smtpPort",
    value: "587",
    type: "number",
    group: "email",
  },
  {
    key: "smtpUser",
    value: "",
    type: "string",
    group: "email",
  },
  {
    key: "smtpPass",
    value: "",
    type: "string",
    group: "email",
  },
  {
    key: "smtpFromName",
    value: "Ouitransfer",
    type: "string",
    group: "email",
  },
  {
    key: "smtpFromEmail",
    value: "",
    type: "string",
    group: "email",
  },
  {
    key: "smtpSecure",
    value: "auto",
    type: "string",
    group: "email",
  },
  {
    key: "smtpNoAuth",
    value: "false",
    type: "boolean",
    group: "email",
  },
  {
    key: "smtpTrustSelfSigned",
    value: "false",
    type: "boolean",
    group: "email",
  },
  {
    key: "passwordResetTokenExpiration",
    value: "3600",
    type: "number",
    group: "security",
  },
  // Auth Providers Global Configuration
  {
    key: "authProvidersEnabled",
    value: "true",
    type: "boolean",
    group: "auth-providers",
  },
  {
    key: "passwordAuthEnabled",
    value: "true",
    type: "boolean",
    group: "security",
  },
  {
    key: "serverUrl",
    value: "http://localhost:3333",
    type: "string",
    group: "general",
  },
  {
    key: "appUrl",
    value: "",
    type: "string",
    group: "general",
    isSystem: false,
  },
  {
    key: "emailQueueIntervalSeconds",
    value: "30",
    type: "number",
    group: "email",
    isSystem: true,
  },
  {
    key: "emailQueueMaxRetries",
    value: "3",
    type: "number",
    group: "email",
    isSystem: true,
  },
  {
    key: "emailDigestHour",
    value: "8",
    type: "number",
    group: "email",
    isSystem: true,
  },
  {
    key: "emailJobRetentionDays",
    value: "30",
    type: "number",
    group: "email",
    isSystem: true,
  },
  // Lifecycle Management & Automatic Cleanup (5.2 Phase A).
  // Conservative defaults: every destructive operation is opt-in and off by default.
  {
    key: "autoCleanupEnabled",
    value: "false",
    type: "boolean",
    group: "cleanup",
    isSystem: true,
  },
  {
    key: "autoCleanupIntervalHours",
    value: "24",
    type: "number",
    group: "cleanup",
    isSystem: true,
  },
  {
    key: "autoCleanupGracePeriodDays",
    value: "7",
    type: "number",
    group: "cleanup",
    isSystem: true,
  },
  {
    key: "autoCleanupNotifyDaysBefore",
    value: "3",
    type: "number",
    group: "cleanup",
    isSystem: true,
  },
  {
    key: "accountDeactivationCleanupEnabled",
    value: "false",
    type: "boolean",
    group: "cleanup",
    isSystem: true,
  },
  {
    key: "accountDeactivationCleanupDays",
    value: "30",
    type: "number",
    group: "cleanup",
    isSystem: true,
  },
  {
    key: "autoCleanupOrphansEnabled",
    value: "false",
    type: "boolean",
    group: "cleanup",
    isSystem: true,
  },
  {
    key: "autoCleanupOrphanMinAgeHours",
    value: "24",
    type: "number",
    group: "cleanup",
    isSystem: true,
  },
];

const defaultAuthProviders = [
  {
    name: "google",
    displayName: "Google",
    type: "oauth2",
    icon: "FcGoogle",
    enabled: false,
    issuerUrl: "https://accounts.google.com",
    authorizationEndpoint: "/o/oauth2/v2/auth",
    tokenEndpoint: "/o/oauth2/token",
    userInfoEndpoint: "https://www.googleapis.com/oauth2/v3/userinfo",
    scope: "openid profile email",
    sortOrder: 1,
    metadata: JSON.stringify({
      description: "Sign in with your Google account",
      docs: "https://developers.google.com/identity/protocols/oauth2",
      supportsDiscovery: true,
      authMethod: "body",
    }),
  },
  {
    name: "discord",
    displayName: "Discord",
    type: "oauth2",
    icon: "FaDiscord",
    enabled: false,
    issuerUrl: "https://discord.com",
    authorizationEndpoint: "/oauth2/authorize",
    tokenEndpoint: "/api/oauth2/token",
    userInfoEndpoint: "/api/users/@me",
    scope: "identify email",
    sortOrder: 2,
    metadata: JSON.stringify({
      description: "Sign in with your Discord account",
      docs: "https://discord.com/developers/docs/topics/oauth2",
      supportsDiscovery: false,
      authMethod: "body",
    }),
  },
  {
    name: "github",
    displayName: "GitHub",
    type: "oauth2",
    icon: "SiGithub",
    enabled: false,
    issuerUrl: "https://github.com/login/oauth", // URL fixa do GitHub
    authorizationEndpoint: "/authorize",
    tokenEndpoint: "/access_token",
    userInfoEndpoint: "https://api.github.com/user", // GitHub usa URL absoluta para userInfo
    scope: "user:email",
    sortOrder: 3,
    metadata: JSON.stringify({
      description: "Sign in with your GitHub account",
      docs: "https://docs.github.com/en/developers/apps/building-oauth-apps",
      specialHandling: "email_fetch_required",
    }),
  },
  {
    name: "auth0",
    displayName: "Auth0",
    type: "oidc",
    icon: "SiAuth0",
    enabled: false,
    issuerUrl: "https://your-tenant.auth0.com", // Placeholder - usuário deve configurar
    authorizationEndpoint: "/authorize",
    tokenEndpoint: "/oauth/token",
    userInfoEndpoint: "/userinfo",
    scope: "openid profile email",
    sortOrder: 4,
    metadata: JSON.stringify({
      description: "Sign in with Auth0 - Replace 'your-tenant' with your Auth0 domain",
      docs: "https://auth0.com/docs/get-started/authentication-and-authorization-flow",
      supportsDiscovery: true,
    }),
  },
  {
    name: "kinde",
    displayName: "Kinde Auth",
    type: "oidc",
    icon: "FaKey",
    enabled: false,
    issuerUrl: "https://your-tenant.kinde.com", // Placeholder - usuário deve configurar
    authorizationEndpoint: "/oauth2/auth",
    tokenEndpoint: "/oauth2/token",
    userInfoEndpoint: "/oauth2/user_profile",
    scope: "openid profile email",
    sortOrder: 5,
    metadata: JSON.stringify({
      description: "Sign in with Kinde - Replace 'your-tenant' with your Kinde domain",
      docs: "https://kinde.com/docs/developer-tools/about/",
      supportsDiscovery: true,
    }),
  },
  {
    name: "zitadel",
    displayName: "Zitadel",
    type: "oidc",
    icon: "FaShield",
    enabled: false,
    issuerUrl: "https://your-instance.zitadel.cloud", // Placeholder - usuário deve configurar
    authorizationEndpoint: "/oauth/v2/authorize",
    tokenEndpoint: "/oauth/v2/token",
    userInfoEndpoint: "/oidc/v1/userinfo",
    scope: "openid profile email",
    sortOrder: 6,
    metadata: JSON.stringify({
      description: "Sign in with Zitadel - Replace with your Zitadel instance URL",
      docs: "https://zitadel.com/docs/guides/integrate/login/oidc",
      supportsDiscovery: true,
      authMethod: "basic",
    }),
  },
  {
    name: "authentik",
    displayName: "Authentik",
    type: "oidc",
    icon: "FaShieldAlt",
    enabled: false,
    issuerUrl: "https://your-authentik.domain.com", // Placeholder - usuário deve configurar
    authorizationEndpoint: "/application/o/authorize/",
    tokenEndpoint: "/application/o/token/",
    userInfoEndpoint: "/application/o/userinfo/",
    scope: "openid profile email",
    sortOrder: 7,
    metadata: JSON.stringify({
      description: "Sign in with Authentik - Replace with your Authentik instance URL",
      docs: "https://goauthentik.io/docs/providers/oauth2",
      supportsDiscovery: true,
    }),
  },
  {
    name: "frontegg",
    displayName: "Frontegg",
    type: "oidc",
    icon: "FaEgg",
    enabled: false,
    issuerUrl: "https://your-tenant.frontegg.com", // Placeholder - usuário deve configurar
    authorizationEndpoint: "/oauth/authorize",
    tokenEndpoint: "/oauth/token",
    userInfoEndpoint: "/identity/resources/users/v2/me",
    scope: "openid profile email",
    sortOrder: 8,
    metadata: JSON.stringify({
      description: "Sign in with Frontegg - Replace 'your-tenant' with your Frontegg tenant",
      docs: "https://docs.frontegg.com",
      supportsDiscovery: true,
    }),
  },
  {
    name: "pocketid",
    displayName: "Pocket ID",
    type: "oidc",
    icon: "BsFillPSquareFill",
    enabled: false,
    issuerUrl: "https://your-pocket-id.domain.com",
    authorizationEndpoint: "/authorize",
    tokenEndpoint: "/api/oidc/token",
    userInfoEndpoint: "/api/oidc/userinfo",
    scope: "openid profile email",
    sortOrder: 9,
    metadata: JSON.stringify({
      description: "Sign in with Pocket ID - Replace with your Pocket ID instance URL",
      docs: "https://docs.pocket-id.org",
      supportsDiscovery: true,
    }),
  },
];

async function main() {
  console.log("🌱 Starting app configurations seed...");
  console.log("🛡️  Protected mode: Only creates missing configurations");

  let createdCount = 0;
  let skippedCount = 0;

  for (const config of defaultConfigs) {
    const existingConfig = await prisma.appConfig.findUnique({
      where: { key: config.key },
    });

    if (existingConfig) {
      console.log(`⏭️  Configuration '${config.key}' already exists, skipping...`);
      skippedCount++;
      continue;
    }

    await prisma.appConfig.create({
      data: config,
    });

    console.log(`✅ Created configuration: ${config.key}`);
    createdCount++;
  }

  console.log("\n📊 Seed Summary:");
  console.log(`   ✅ Created: ${createdCount} configurations`);
  console.log(`   ⏭️  Skipped: ${skippedCount} configurations`);
  console.log("🎉 App configurations seeded successfully!");

  // Seed Auth Providers
  console.log("\n🔐 Starting auth providers seed...");
  console.log("🛡️  Protected mode: Only creates missing providers");

  let providersCreatedCount = 0;
  let providersSkippedCount = 0;

  for (const provider of defaultAuthProviders) {
    const existingProvider = await prisma.authProvider.findUnique({
      where: { name: provider.name },
    });

    if (existingProvider) {
      console.log(`⏭️  Auth provider '${provider.name}' already exists, skipping...`);
      providersSkippedCount++;
      continue;
    }

    await prisma.authProvider.create({
      data: provider,
    });

    console.log(`✅ Created auth provider: ${provider.displayName} (${provider.name})`);
    providersCreatedCount++;
  }

  console.log("\n📊 Auth Providers Summary:");
  console.log(`   ✅ Created: ${providersCreatedCount} providers`);
  console.log(`   ⏭️  Skipped: ${providersSkippedCount} providers`);
  console.log("🎉 Auth providers seeded successfully!");
}

main()
  .catch((error) => {
    console.error("Error during seed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
