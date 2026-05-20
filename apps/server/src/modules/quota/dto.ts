import { z } from "zod";
import { quotaOverrideField } from "../../shared/quota-schema.js";

export const UpdateQuotaSchema = z.object({
  maxFileSizeOverride: quotaOverrideField.optional(),
  maxTotalStorageOverride: quotaOverrideField.optional(),
});

/** Response schema for GET /users/:id/quota */
export const QuotaStatusResponseSchema = z.object({
  used: z.string().describe("Storage used in bytes"),
  maxTotalStorage: z.string().describe("Effective max total storage in bytes (0 = unlimited)"),
  maxFileSize: z.string().describe("Effective max file size in bytes (0 = unlimited)"),
  percentage: z.number().describe("Percentage of quota used (0 if unlimited)"),
  warningLevel: z.enum(["none", "warning", "critical", "exceeded"]),
  uploadAllowed: z.boolean(),
  overrides: z.object({
    maxFileSizeOverride: z
      .string()
      .nullable()
      .describe("Per-user file size override (null = inherit)"),
    maxTotalStorageOverride: z
      .string()
      .nullable()
      .describe("Per-user total storage override (null = inherit)"),
  }),
  sources: z.object({
    maxFileSizeSource: z
      .enum(["user", "group", "global", "admin-default"])
      .describe("Where the effective max file size limit comes from"),
    maxTotalStorageSource: z
      .enum(["user", "group", "global", "admin-default"])
      .describe("Where the effective max total storage limit comes from"),
    groupName: z.string().nullable().describe("Name of the user's group (null if none)"),
  }),
});

/** Response schema for PATCH /users/:id/quota */
export const UpdateQuotaResponseSchema = z.object({
  message: z.string(),
  overrides: z.object({
    maxFileSizeOverride: z.string().nullable(),
    maxTotalStorageOverride: z.string().nullable(),
  }),
});
