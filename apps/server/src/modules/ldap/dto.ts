import { z } from "zod";

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
  syncIntervalMinutes: z.number().int().min(15).max(10080), // 15 min to 7 days
  useTls: z.boolean().default(true),
  tlsSkipVerify: z.boolean().default(false),
  appUrl: z
    .string()
    .url("Must be a valid URL")
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

export const SyncLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
