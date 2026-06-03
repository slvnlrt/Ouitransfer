import { Database, ImagePlus, Mail, Settings, Shield, Trash2, UserCheck } from "lucide-react";
import type { createTranslator } from "next-intl";

export const createGroupMetadata = (t: ReturnType<typeof createTranslator>) => ({
  email: {
    title: t("settings.groups.email.title"),
    description: t("settings.groups.email.description"),
    icon: Mail,
  },
  general: {
    title: t("settings.groups.general.title"),
    description: t("settings.groups.general.description"),
    icon: Settings,
  },
  "auth-providers": {
    title: "Authentication Providers",
    description: "Configure external authentication providers for SSO",
    icon: UserCheck,
  },
  security: {
    title: t("settings.groups.security.title"),
    description: t("settings.groups.security.description"),
    icon: Shield,
  },
  storage: {
    title: t("settings.groups.storage.title"),
    description: t("settings.groups.storage.description"),
    icon: Database,
  },
  backgrounds: {
    title: t("settings.groups.backgrounds.title"),
    description: t("settings.groups.backgrounds.description"),
    icon: ImagePlus,
  },
  cleanup: {
    title: t("settings.groups.cleanup.title"),
    description: t("settings.groups.cleanup.description"),
    icon: Trash2,
  },
});

export const createFieldDescriptions = (t: ReturnType<typeof createTranslator>) => ({
  // General settings
  appLogo: t("settings.fields.appLogo.description"),
  appName: t("settings.fields.appName.description"),
  appDescription: t("settings.fields.appDescription.description"),
  showHomePage: t("settings.fields.showHomePage.description"),
  hideVersion: t("settings.fields.hideVersion.description"),
  footerEnabled: t("settings.fields.footerEnabled.description"),
  footerText: t("settings.fields.footerText.description"),
  footerUrl: t("settings.fields.footerUrl.description"),
  firstUserAccess: t("settings.fields.firstUserAccess.description"),
  serverUrl: t("settings.fields.serverUrl.description"),

  // Email settings
  smtpEnabled: t("settings.fields.smtpEnabled.description"),
  smtpHost: t("settings.fields.smtpHost.description"),
  smtpPort: t("settings.fields.smtpPort.description"),
  smtpUser: t("settings.fields.smtpUser.description"),
  smtpPass: t("settings.fields.smtpPass.description"),
  smtpFromName: t("settings.fields.smtpFromName.description"),
  smtpFromEmail: t("settings.fields.smtpFromEmail.description"),
  smtpSecure: t("settings.fields.smtpSecure.description"),
  smtpNoAuth: t("settings.fields.smtpNoAuth.description"),
  smtpTrustSelfSigned: t("settings.fields.smtpTrustSelfSigned.description"),

  // Auth Providers settings
  authProvidersEnabled: "Enable external authentication providers for SSO",

  // Security settings
  maxLoginAttempts: t("settings.fields.maxLoginAttempts.description"),
  loginBlockDuration: t("settings.fields.loginBlockDuration.description"),
  passwordMinLength: t("settings.fields.passwordMinLength.description"),
  passwordResetTokenExpiration: t("settings.fields.passwordResetTokenExpiration.description"),

  auditRetentionDays: t("settings.fields.auditRetentionDays.description"),

  // Storage settings
  maxFileSize: t("settings.fields.maxFileSize.description"),
  maxTotalStoragePerUser: t("settings.fields.maxTotalStoragePerUser.description"),

  // Quota overage policy (5.2 Phase B) — lives in the storage group
  quotaWarningThresholds: t("settings.fields.quotaWarningThresholds.description"),
  quotaGracePeriodDays: t("settings.fields.quotaGracePeriodDays.description"),
  quotaSmartDeletionEnabled: t("settings.fields.quotaSmartDeletionEnabled.description"),
  quotaInactiveShareDays: t("settings.fields.quotaInactiveShareDays.description"),
  reverseShareQuotaSoftEnforcement: t(
    "settings.fields.reverseShareQuotaSoftEnforcement.description",
  ),
  reverseShareMaxOverageFactor: t("settings.fields.reverseShareMaxOverageFactor.description"),
  reverseShareAbsoluteMaxBytes: t("settings.fields.reverseShareAbsoluteMaxBytes.description"),

  // Cleanup / lifecycle settings (5.2)
  autoCleanupEnabled: t("settings.fields.autoCleanupEnabled.description"),
  autoCleanupIntervalHours: t("settings.fields.autoCleanupIntervalHours.description"),
  autoCleanupGracePeriodDays: t("settings.fields.autoCleanupGracePeriodDays.description"),
  autoCleanupNotifyDaysBefore: t("settings.fields.autoCleanupNotifyDaysBefore.description"),
  accountDeactivationCleanupEnabled: t(
    "settings.fields.accountDeactivationCleanupEnabled.description",
  ),
  accountDeactivationCleanupDays: t("settings.fields.accountDeactivationCleanupDays.description"),
  autoCleanupOrphansEnabled: t("settings.fields.autoCleanupOrphansEnabled.description"),
  autoCleanupOrphanMinAgeHours: t("settings.fields.autoCleanupOrphanMinAgeHours.description"),
});
