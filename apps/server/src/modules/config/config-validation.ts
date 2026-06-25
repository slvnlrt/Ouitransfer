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
 * Whether `value` is a canonical, credential-safe `http(s)://` origin (A6-07).
 * This is the single source of truth for `appUrl` validation across the app —
 * the LDAP welcome-link guard (`ldap/app-url.ts`) delegates to it (A5-13).
 *
 *   - parseable as a URL,
 *   - http or https scheme only (rejects `javascript:`, `ftp:`, `data:`, …),
 *   - has a hostname,
 *   - carries no userinfo (`user:pass@`), which could mask the real host,
 *   - carries no path / query / fragment beyond the bare origin (an `appUrl`
 *     with a path would corrupt every link built by concatenation), and
 *   - contains no CR/LF (header-injection / link-poisoning defense).
 */
export function isCanonicalHttpOrigin(value: string): boolean {
  // Reject ASCII control characters (CR/LF/TAB/NUL and friends) before parsing —
  // the URL parser tolerates some of them, but they must never reach a link
  // builder or header. Checked by code point to avoid embedding raw control
  // characters in a regex literal.
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!url.hostname) return false;
  if (url.username || url.password) return false;
  if (url.search || url.hash) return false;
  // A trailing "/" is the only path the URL parser normalizes an origin to; any
  // other pathname means the admin supplied a path, which we reject.
  if (url.pathname !== "/" && url.pathname !== "") return false;
  return true;
}

/**
 * Whether `value` is a safe `http(s)://` URL for a user-facing, `target="_blank"`
 * link (A7-01). Unlike {@link isCanonicalHttpOrigin}, this permits a path, query,
 * and fragment (a footer link may point at a deep page), but still enforces the
 * scheme allow-list and rejects the dangerous-scheme / link-poisoning classes:
 *
 *   - parseable as an absolute URL (rejects protocol-relative `//evil.com`,
 *     which `new URL()` cannot parse without a base),
 *   - `http:` / `https:` scheme only — rejects `javascript:`, `data:`,
 *     `vbscript:`, `file:`, `ftp:`, etc. (DOM-XSS via a rendered href),
 *   - has a hostname, and
 *   - contains no CR/LF or other ASCII control characters.
 */
export function isSafeHttpLinkUrl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) return false;
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (!url.hostname) return false;
  return true;
}

/** Max length for free-text branding strings persisted to config (appName, smtpFromName). */
const MAX_BRANDING_LENGTH = 200;

/**
 * Validator for free-text branding strings (`appName`, `smtpFromName`). These are
 * interpolated into email subjects, the `From` display name, and HTML/text bodies.
 * Subjects and headers are already CRLF-stripped at render time, but we reject
 * CR/LF and cap the length at the config boundary too (defense-in-depth, A6-07)
 * so a malformed value never reaches the email pipeline.
 */
function brandingString(label: string): ConfigValueValidator {
  return (value: string) => {
    if (/[\r\n]/.test(value)) {
      throw new ValidationError(`${label} must not contain line breaks.`, { key: label });
    }
    if (value.length > MAX_BRANDING_LENGTH) {
      throw new ValidationError(`${label} must be at most ${MAX_BRANDING_LENGTH} characters.`, {
        key: label,
      });
    }
  };
}

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
    .transform(Number)
    .pipe(
      z
        .number({ message: wholeNumberMessage })
        .int(wholeNumberMessage)
        .min(min, `${label} must be at least ${min}.`),
    );
}

/**
 * A non-negative big-integer config value persisted as a string (a byte count
 * that may exceed `Number.MAX_SAFE_INTEGER`), constrained to `>= min`. Parsed
 * with the native `BigInt` so arbitrarily large values stay exact. Rejects
 * empty/whitespace, non-numeric, and fractional input explicitly.
 */
function bigintMin(label: string, min: bigint): z.ZodType {
  const wholeNumberMessage = `${label} must be a whole number of bytes.`;
  return z
    .string()
    .trim()
    .min(1, wholeNumberMessage)
    .superRefine((value, ctx) => {
      let parsed: bigint;
      try {
        parsed = BigInt(value);
      } catch {
        ctx.addIssue({ code: "custom", message: wholeNumberMessage });
        return;
      }
      if (parsed < min) {
        ctx.addIssue({
          code: "custom",
          message: `${label} must be at least ${min}.`,
        });
      }
    });
}

/**
 * Comma-separated quota-usage warning percentages (5.2 Phase B). Each entry must
 * be an integer in the inclusive range 1–99 (100% is the implicit "exceeded"
 * boundary, never a configured warning). The list must be non-empty; order and
 * duplicates are tolerated (the quota service sorts + dedupes at parse time).
 */
function quotaWarningThresholds(label: string): z.ZodType {
  const message = `${label} must be a comma-separated list of whole percentages between 1 and 99.`;
  return z
    .string()
    .trim()
    .min(1, message)
    .superRefine((value, ctx) => {
      const parts = value.split(",");
      const fail = () => ctx.addIssue({ code: "custom", message });
      for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed === "" || !/^\d+$/.test(trimmed)) {
          fail();
          return;
        }
        const n = Number(trimmed);
        if (n < 1 || n > 99) {
          fail();
          return;
        }
      }
    });
}

/**
 * Audit log retention, in days.
 *  - `0` means "keep audit logs forever".
 *  - Any positive value must be at least 7 days. This mirrors the admin UI
 *    guidance and prevents accidental aggressive pruning (values 1–6), which
 *    the retention scheduler would otherwise apply verbatim.
 */
const auditRetentionDaysSchema = z
  .string()
  .trim()
  .min(1, "Audit retention must be a whole number of days.")
  .transform(Number)
  .pipe(
    z
      .number({ message: "Audit retention must be a whole number of days." })
      .int("Audit retention must be a whole number of days.")
      .min(0, "Audit retention cannot be negative.")
      .refine((days) => days === 0 || days >= 7, {
        message: "Audit retention must be 0 (keep forever) or at least 7 days.",
      }),
  );

/**
 * `appUrl` must be a canonical http(s):// origin (A6-07). Every email link and the
 * OAuth/LDAP base URL is built by concatenating onto this value, so a non-http(s)
 * scheme, an embedded path, userinfo, or CR/LF would poison those links.
 */
const appUrlValidator: ConfigValueValidator = (value: string) => {
  if (!isCanonicalHttpOrigin(value)) {
    throw new ValidationError(
      "Application URL must be a valid http(s):// origin with no path, query, credentials, or line breaks (e.g. https://transfer.example.com).",
      { key: "appUrl" },
    );
  }
};

/**
 * `footerUrl` is rendered as the `href` of an admin-configurable, public-facing
 * `target="_blank"` footer link (A7-01). It must be an `http(s)://` URL so a
 * stored `javascript:`/`data:`/`vbscript:` value can never become a DOM-XSS sink
 * when clicked, and a protocol-relative `//evil` value can never silently
 * redirect users off-origin. The frontend validates again at render time
 * (defense-in-depth), but the value is rejected at the write boundary here.
 */
const footerUrlValidator: ConfigValueValidator = (value: string) => {
  // An empty value is allowed — it disables the footer link (renders no href).
  if (value === "") return;
  if (!isSafeHttpLinkUrl(value)) {
    throw new ValidationError(
      "Footer URL must be a valid http(s):// URL (e.g. https://example.com). javascript:, data:, and protocol-relative URLs are not allowed.",
      { key: "footerUrl" },
    );
  }
};

const configValueValidators: Record<string, ConfigValueValidator> = {
  auditRetentionDays: fromSchema("auditRetentionDays", auditRetentionDaysSchema),

  // Branding & email identity (A6-07). appUrl backs every link builder; the SMTP
  // From identity feeds outbound headers.
  appUrl: appUrlValidator,
  // Public footer link rendered with target="_blank" (A7-01).
  footerUrl: footerUrlValidator,
  appName: brandingString("appName"),
  smtpFromName: brandingString("smtpFromName"),
  smtpFromEmail: fromSchema("smtpFromEmail", z.email("From email must be a valid email address.")),

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

  // Quota Overage Policy (5.2 Phase B).
  quotaWarningThresholds: fromSchema(
    "quotaWarningThresholds",
    quotaWarningThresholds("Quota warning thresholds"),
  ),
  quotaGracePeriodDays: fromSchema("quotaGracePeriodDays", intMin("Quota grace period (days)", 0)),
  quotaSmartDeletionEnabled: fromSchema(
    "quotaSmartDeletionEnabled",
    booleanString("Smart deletion"),
  ),
  quotaInactiveShareDays: fromSchema(
    "quotaInactiveShareDays",
    intMin("Inactive-share window (days)", 1),
  ),
  reverseShareQuotaSoftEnforcement: fromSchema(
    "reverseShareQuotaSoftEnforcement",
    booleanString("Reverse-share soft enforcement"),
  ),
  reverseShareMaxOverageFactor: fromSchema(
    "reverseShareMaxOverageFactor",
    intMin("Reverse-share max overage factor", 1),
  ),
  reverseShareAbsoluteMaxBytes: fromSchema(
    "reverseShareAbsoluteMaxBytes",
    bigintMin("Reverse-share absolute max bytes", 0n),
  ),
};

/**
 * Validates a single config key/value pair. No-op for keys without a registered
 * validator. Throws {@link ValidationError} when the value is invalid.
 */
export function validateConfigValue(key: string, value: string): void {
  configValueValidators[key]?.(value);
}
