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

type ConfigValueValidator = (value: string) => void;

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
};

/**
 * Validates a single config key/value pair. No-op for keys without a registered
 * validator. Throws {@link ValidationError} when the value is invalid.
 */
export function validateConfigValue(key: string, value: string): void {
  configValueValidators[key]?.(value);
}
