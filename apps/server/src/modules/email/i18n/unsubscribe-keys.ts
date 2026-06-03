/**
 * i18n key references for the public unsubscribe HTML pages (rendered by
 * `notification/routes.ts`). The strings live under the `unsubscribe.*`
 * namespace in `messages/{en,fr}.json`.
 *
 * Centralizing the keys here gives a single source of truth that is:
 *   - consumed by the route renderers (no string-literal drift), and
 *   - validated at boot by `validateAllI18nKeys()` (catalog.ts), so a missing
 *     or mistyped key in en.json fails loudly at startup rather than only when
 *     a user clicks an unsubscribe link.
 *
 * This module intentionally has no imports so it can be referenced from both
 * the notification and email modules without creating an import cycle.
 */
export const UNSUBSCRIBE_I18N = {
  confirmTitle: "unsubscribe.confirmTitle",
  confirmAbout: "unsubscribe.confirmAbout",
  confirmAction: "unsubscribe.confirmAction",
  confirmButton: "unsubscribe.confirmButton",
  successTitle: "unsubscribe.successTitle",
  successMessage: "unsubscribe.successMessage",
  successManage: "unsubscribe.successManage",
  errorTitle: "unsubscribe.errorTitle",
  errorMessage: "unsubscribe.errorMessage",
  errorManage: "unsubscribe.errorManage",
} as const;

/** Flat list of every `unsubscribe.*` key, for boot-time validation. */
export const UNSUBSCRIBE_I18N_KEYS: readonly string[] = Object.values(UNSUBSCRIBE_I18N);
