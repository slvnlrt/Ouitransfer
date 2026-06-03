import { z } from "zod";
import { ValidationError } from "../../utils/app-error.js";

/**
 * Per-config-key value validation.
 *
 * Config values are persisted as strings, so each validator parses the raw
 * string and throws a {@link ValidationError} (HTTP 400) with a clear,
 * client-safe message when the value violates the key's constraints.
 *
 * Keys absent from the registry accept any string (no format constraint).
 * This is applied in both the single and bulk config update paths so the two
 * never drift apart.
 */

type ConfigValueValidator = (value: string) => void;

/**
 * Builds a validator that delegates to a Zod schema and rethrows any failure as
 * a {@link ValidationError} (HTTP 400) carrying the offending `key` in
 * `details`, matching the behavior the admin UI and API clients rely on.
 */
function fromSchema(key: string, schema: z.ZodType): ConfigValueValidator {
  return (value: string) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(result.error.issues[0]?.message ?? "Invalid configuration value.", {
        key,
      });
    }
  };
}

/**
 * A boolean config value persisted as a string. Accepts only the canonical
 * `"true"` / `"false"` tokens (no coercion of `"1"`, `"yes"`, empty, etc.) so
 * the stored representation stays predictable.
 */
function booleanString(label: string): z.ZodType {
  return z.enum(["true", "false"], {
    message: `${label} must be either "true" or "false".`,
  });
}

/**
 * An integer config value persisted as a string, constrained to `>= min`.
 * Rejects empty/whitespace, non-numeric, and non-integer input explicitly so a
 * cleared field is an error rather than silently coerced to 0.
 */
function intMin(label: string, min: number): z.ZodType {
  const wholeNumberMessage = `${label} must be a whole number.`;
  return z
    .string()
    .trim()
    .min(1, wholeNumberMessage)
    .pipe(
      z.coerce
        .number({ message: wholeNumberMessage })
        .int(wholeNumberMessage)
        .min(min, `${label} must be at least ${min}.`),
    );
}

/**
 * Audit log retention, in days.
 *  - `0` means "keep audit logs forever".
 *  - Any positive value must be at least 7 days. This mirrors the admin UI
 *    guidance and prevents accidental aggressive pruning (values 1–6), which
 *    the retention scheduler would otherwise apply verbatim.
 */
const auditRetentionDaysSchema = z.coerce
  .number({ message: "Audit retention must be a whole number of days." })
  .int("Audit retention must be a whole number of days.")
  .min(0, "Audit retention cannot be negative.")
  .refine((days) => days === 0 || days >= 7, {
    message: "Audit retention must be 0 (keep forever) or at least 7 days.",
  });

const configValueValidators: Record<string, ConfigValueValidator> = {
  auditRetentionDays: (value) => {
    // z.coerce.number() turns an empty string into 0, which would silently mean
    // "keep forever" — reject it explicitly so a cleared field is an error.
    if (value.trim() === "") {
      throw new ValidationError("Audit retention must be a whole number of days.", {
        key: "auditRetentionDays",
      });
    }

    const result = auditRetentionDaysSchema.safeParse(value);
    if (!result.success) {
      throw new ValidationError(result.error.issues[0]?.message ?? "Invalid configuration value.", {
        key: "auditRetentionDays",
      });
    }
  },

  // Lifecycle Management & Automatic Cleanup (5.2 Phase A).
  autoCleanupEnabled: fromSchema("autoCleanupEnabled", booleanString("Automatic cleanup")),
  autoCleanupIntervalHours: fromSchema(
    "autoCleanupIntervalHours",
    intMin("Cleanup interval (hours)", 1),
  ),
  autoCleanupGracePeriodDays: fromSchema(
    "autoCleanupGracePeriodDays",
    intMin("Grace period (days)", 0),
  ),
  autoCleanupNotifyDaysBefore: fromSchema(
    "autoCleanupNotifyDaysBefore",
    intMin("Notify days before deletion", 0),
  ),
  accountDeactivationCleanupEnabled: fromSchema(
    "accountDeactivationCleanupEnabled",
    booleanString("Deactivated-account cleanup"),
  ),
  accountDeactivationCleanupDays: fromSchema(
    "accountDeactivationCleanupDays",
    intMin("Deactivated-account cleanup delay (days)", 1),
  ),
  autoCleanupOrphansEnabled: fromSchema(
    "autoCleanupOrphansEnabled",
    booleanString("Orphan cleanup"),
  ),
  autoCleanupOrphanMinAgeHours: fromSchema(
    "autoCleanupOrphanMinAgeHours",
    intMin("Orphan minimum age (hours)", 1),
  ),
};

/**
 * Validates a single config key/value pair. No-op for keys without a registered
 * validator. Throws {@link ValidationError} when the value is invalid.
 */
export function validateConfigValue(key: string, value: string): void {
  configValueValidators[key]?.(value);
}
