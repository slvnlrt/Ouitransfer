import { z } from "zod";

/**
 * Schema for BigInt fields that can be null (inherit), 0 (unlimited), or >0 (bytes).
 * Accepts number or string input, converts to bigint internally.
 * Null clears the override (inherit from group/global).
 *
 * Shared between quota and group modules to keep validation in sync.
 */
export const quotaOverrideField = z
  .union([z.number(), z.string(), z.null()])
  .transform((val, ctx) => {
    if (val === null) return null;
    const str = String(val);
    if (!/^\d+$/.test(str)) {
      ctx.addIssue({
        code: "custom",
        message: "Quota value must be a non-negative integer in bytes",
      });
      return undefined as never;
    }
    try {
      const n = BigInt(str);
      const ONE_PB = 1125899906842624n; // 2^50 bytes = 1 PB
      if (n > ONE_PB) {
        ctx.addIssue({
          code: "custom",
          message: "Quota value must not exceed 1 PB",
        });
        return undefined as never;
      }
      return n;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Quota value must be a valid integer",
      });
      return undefined as never;
    }
  });
