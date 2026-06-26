/**
 * Namespace-scoped message picking for NextIntlClientProvider.
 *
 * Instead of serialising all ~122 KB of translations into every RSC payload,
 * each route layout picks only the namespaces its component tree actually uses.
 */

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/** Pick only the listed top-level keys from a messages object. */
export function pickMessages(
  messages: Record<string, unknown>,
  namespaces: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const ns of namespaces) {
    if (ns in messages) result[ns] = messages[ns];
  }
  return result;
}

/** Merge multiple namespace groups (deduplicating) then pick. */
export function routeMessages(
  messages: Record<string, unknown>,
  ...groups: (readonly string[])[]
): Record<string, unknown> {
  const combined = new Set(groups.flat());
  return pickMessages(messages, [...combined]);
}

// ---------------------------------------------------------------------------
// Namespace groups — verified by tracing useTranslations() calls in each
// component tree (TD-54).
// ---------------------------------------------------------------------------

/**
 * Namespaces consumed by root-layout components (SkipToContent, LoadingScreen).
 * Every page inherits these.
 */
export const GLOBAL_NAMESPACES = ["a11y", "common"] as const;

/**
 * Namespaces for authentication pages: /login, /forgot-password,
 * /reset-password, /register-with-invite.
 *
 * Components: LoginForm, LoginHeader, RegisterForm, TwoFactorVerification,
 * MultiProviderButtons, useLogin hook, ForgotPasswordForm/Header,
 * ResetPasswordForm/Header, RegisterForm (invite), LanguageSwitcher,
 * DefaultFooter.
 */
export const AUTH_NAMESPACES = [
  "auth",
  "errors",
  "footer",
  "forgotPassword",
  "languageSwitcher",
  "login",
  "register",
  "registerWithInvite",
  "resetPassword",
  "twoFactor",
  "validation",
] as const;

/**
 * Namespaces for the public share download page (/s/[alias]).
 *
 * Components: ShareDetails, ShareHeader, PasswordModal, IdentificationForm,
 * FilesViewManager, FilePreviewModal, LanguageSwitcher, ModeToggle,
 * DefaultFooter, error boundary.
 */
export const PUBLIC_SHARE_NAMESPACES = [
  "contextMenu",
  "errors",
  "fileActions",
  "filePreview",
  "fileSelector",
  "files",
  "filesTable",
  "folderActions",
  "footer",
  "languageSwitcher",
  "logo",
  "searchBar",
  "share",
  "shareManager",
  "theme",
] as const;

/**
 * Namespaces for the reverse-share upload page (/r/[alias]).
 *
 * Components: DefaultLayout, WeTransferLayout, FileUploadSection,
 * PasswordModal, StatusMessage, TransparentFooter, LanguageSwitcher,
 * ModeToggle, error boundary.
 */
export const REVERSE_SHARE_NAMESPACES = [
  "errors",
  "footer",
  "languageSwitcher",
  "reverseShares",
  "theme",
  "uploadFile",
] as const;

/**
 * Namespaces for the landing page (/).
 *
 * Components: HomeContent (EmployeeSection, PartnerSection), Navbar
 * (LanguageSwitcher, ModeToggle).
 */
export const HOME_NAMESPACES = ["home", "languageSwitcher", "theme"] as const;
