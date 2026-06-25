import { z } from "zod";
import { EMAIL_LOCALES } from "../email/i18n/locales.js";
import { isCanonicalHttpOrigin } from "./app-url.js";

// RFC 4512 §2.5: attributeType = ALPHA *( ALPHA / DIGIT / "-" ); max 64 chars (practical cap).
const ldapAttributeName = z
  .string()
  .min(1)
  .max(64)
  .regex(
    /^[A-Za-z][A-Za-z0-9-]*$/,
    "Must be a valid LDAP attribute name (letters, digits, hyphens; must start with a letter)",
  );

// A valid DN must start with an RDN of the form "attribute=…"
const ldapDn = z
  .string()
  .min(1)
  .refine((val) => /^[A-Za-z][A-Za-z0-9-]*\s*=/.test(val), {
    message: "Must be a valid LDAP Distinguished Name (e.g. CN=…,DC=…)",
  });

export const LdapConfigSchema = z.object({
  enabled: z.boolean(),
  serverUrl: z.string().min(1, "Server URL is required"),
  // Not constrained to DN form: AD accepts UPN (user@domain) and down-level
  // (DOMAIN\user) bind names. The bind value is never used in a filter, so it
  // is not an injection sink.
  bindDn: z.string().min(1, "Bind DN is required"),
  bindPassword: z.string(), // Empty string = keep existing
  searchBase: ldapDn,
  syncGroupDn: ldapDn,
  usernameAttribute: ldapAttributeName.default("sAMAccountName"),
  emailAttribute: ldapAttributeName.default("mail"),
  displayNameAttribute: ldapAttributeName.default("displayName"),
  // Constrained to locales with translated email templates (en, fr). Other UI
  // locales are intentionally excluded — they would silently send English.
  defaultLocale: z.enum(EMAIL_LOCALES).default("en"),
  syncIntervalMinutes: z.number().int().min(15).max(10080), // 15 min to 7 days
  useTls: z.boolean().default(true),
  tlsSkipVerify: z.boolean().default(false),
  // Credential-bearing welcome/password-set links are built from this origin
  // (A5-13), so it must be a canonical http(s):// origin — not just any parseable
  // URL (z.url() would accept javascript:/ftp: schemes). Empty string → null.
  appUrl: z
    .string()
    .refine((v) => v === "" || isCanonicalHttpOrigin(v), {
      message: "Must be a valid http(s):// URL (e.g. https://transfer.example.com)",
    })
    .nullable()
    .optional()
    .transform((v) => v || null),
});

export const LdapTestSchema = z.object({
  serverUrl: z.string().min(1),
  // See LdapConfigSchema.bindDn — not constrained to DN form (UPN / down-level allowed).
  bindDn: z.string().min(1),
  bindPassword: z.string().min(1, "Bind password is required for testing"),
  searchBase: ldapDn,
  syncGroupDn: ldapDn,
  usernameAttribute: ldapAttributeName.default("sAMAccountName"),
  emailAttribute: ldapAttributeName.default("mail"),
  displayNameAttribute: ldapAttributeName.default("displayName"),
  useTls: z.boolean().default(true),
  tlsSkipVerify: z.boolean().default(false),
});

/**
 * Connection fields shared by the directory-browse and group-search routes.
 *
 * `bindPassword` is intentionally unconstrained (empty / masked allowed): the
 * masked-password resolver reuses the stored encrypted password when the form
 * holds the masked value or an empty string, mirroring the PUT /config rule.
 */
export const LdapConnectionFieldsSchema = z.object({
  serverUrl: z.string().min(1, "Server URL is required"),
  // See LdapConfigSchema.bindDn — not constrained to DN form (UPN / down-level allowed).
  bindDn: z.string().min(1, "Bind DN is required"),
  bindPassword: z.string(), // Empty / masked = reuse the stored encrypted password
  useTls: z.boolean().default(true),
  tlsSkipVerify: z.boolean().default(false),
});

/**
 * Directory-browse body: connection fields plus an optional base DN. Without a
 * base DN the route reads the RootDSE (naming contexts); with one it lists the
 * immediate container children of that node. `baseDn` is a search base, not a
 * filter value — not injectable — but is still validated to DN shape.
 */
export const LdapBrowseSchema = LdapConnectionFieldsSchema.extend({
  baseDn: ldapDn.optional(),
});

/**
 * Group-search body: connection fields plus a DN-validated search base and a
 * free-text query. The query is carried as an ldapts SubstringFilter value
 * (object), never interpolated into a filter string (C-1).
 */
export const LdapSearchGroupsSchema = LdapConnectionFieldsSchema.extend({
  searchBase: ldapDn,
  query: z.string().min(1, "Search query is required").max(256),
});

export const SyncLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
