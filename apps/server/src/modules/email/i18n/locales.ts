/**
 * Single source of truth for the email locales that have translated message
 * files in `./messages/`. The welcome / notification emails are translated ONLY
 * for these locales; every other locale falls back to English in the loader.
 *
 * Any feature that lets an operator pick an email language (e.g. the LDAP
 * "default email language" setting) MUST constrain its choices to this list —
 * offering an untranslated locale would silently send English while claiming
 * otherwise.
 *
 * Drift is guarded by `__tests__/locales.test.ts`, which asserts this list
 * exactly matches the `*.json` files in `./messages/`. Adding `de.json` later
 * will fail that test until `de` is added here.
 */
export const EMAIL_LOCALES = ["en", "fr"] as const;

export type EmailLocale = (typeof EMAIL_LOCALES)[number];
