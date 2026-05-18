import { z } from "zod";

/**
 * Schema for BigInt fields that can be null (inherit), 0 (unlimited), or >0 (bytes).
 * Accepts number or string input, converts to bigint internally.
 * Null clears the override (inherit from group/global).
 */
const quotaOverrideField = z.union([z.number(), z.string(), z.null()]).transform((val, ctx) => {
  if (val === null) return null;
  const str = String(val);
  if (!/^\d+$/.test(str)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Quota value must be a non-negative integer in bytes",
    });
    return z.NEVER;
  }
  try {
    const n = BigInt(str);
    return n;
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Quota value must be a valid integer",
    });
    return z.NEVER;
  }
});

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
});

/** Response schema for PATCH /users/:id/quota */
export const UpdateQuotaResponseSchema = z.object({
  message: z.string(),
  overrides: z.object({
    maxFileSizeOverride: z.string().nullable(),
    maxTotalStorageOverride: z.string().nullable(),
  }),
});
