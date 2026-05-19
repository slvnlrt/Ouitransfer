import { z } from "zod";

export const LdapConfigSchema = z.object({
  enabled: z.boolean(),
  serverUrl: z.string().min(1, "Server URL is required"),
  bindDn: z.string().min(1, "Bind DN is required"),
  bindPassword: z.string(), // Empty string = keep existing
  searchBase: z.string().min(1, "Search base is required"),
  syncGroupDn: z.string().min(1, "Sync group DN is required"),
  usernameAttribute: z.string().min(1).default("sAMAccountName"),
  emailAttribute: z.string().min(1).default("mail"),
  displayNameAttribute: z.string().min(1).default("displayName"),
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
  bindDn: z.string().min(1),
  bindPassword: z.string().min(1, "Bind password is required for testing"),
  searchBase: z.string().min(1),
  syncGroupDn: z.string().min(1),
  usernameAttribute: z.string().min(1).default("sAMAccountName"),
  emailAttribute: z.string().min(1).default("mail"),
  displayNameAttribute: z.string().min(1).default("displayName"),
  useTls: z.boolean().default(true),
  tlsSkipVerify: z.boolean().default(false),
});

export const SyncLogsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});
