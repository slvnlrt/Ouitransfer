import { z } from "zod";

/**
 * Schema for boolean query parameters that correctly treats "false" as `false`.
 *
 * Unlike `z.coerce.boolean()`, which uses JS `Boolean()` semantics (any non-empty
 * string is `true`), this schema only treats the literal string "true" as `true`.
 * All other values (including "false", absent, and empty) resolve to `false`.
 *
 * @example querystring: z.object({ force: booleanQueryParam })
 */
export const booleanQueryParam = z
  .enum(["true", "false"])
  .optional()
  .default("false")
  .transform((v) => v === "true");
