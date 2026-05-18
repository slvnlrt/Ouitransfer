import { z } from "zod";

/**
 * Reuse the quota override field logic: null = inherit, 0 = unlimited, >0 = bytes.
 * Accepts number or string input, converts to bigint internally. Max 1 PB.
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
    const ONE_PB = 1125899906842624n; // 2^50 bytes = 1 PB
    if (n > ONE_PB) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quota value must not exceed 1 PB",
      });
      return z.NEVER;
    }
    return n;
  } catch {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Quota value must be a valid integer",
    });
    return z.NEVER;
  }
});

export const CreateGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Group name is required")
    .max(100, "Group name must be at most 100 characters"),
  description: z.string().max(500, "Description must be at most 500 characters").optional(),
  maxFileSizeOverride: quotaOverrideField.optional(),
  maxTotalStorageOverride: quotaOverrideField.optional(),
});

export const UpdateGroupSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  maxFileSizeOverride: quotaOverrideField.optional(),
  maxTotalStorageOverride: quotaOverrideField.optional(),
});

export const AddMemberSchema = z.object({
  userId: z.string().min(1, "User ID is required"),
});
