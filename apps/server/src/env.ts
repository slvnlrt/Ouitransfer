import { z } from "zod";

const envSchema = z.object({
  // Storage configuration
  ENABLE_S3: z.union([z.literal("true"), z.literal("false")]).default("false"),
  S3_ENDPOINT: z.string().optional(),
  S3_PORT: z.string().optional(),
  S3_USE_SSL: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET_NAME: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.union([z.literal("true"), z.literal("false")]).default("false"),
  // S3_REJECT_UNAUTHORIZED=false disables TLS certificate verification for S3
  // connections. TEST-ONLY: use exclusively with self-signed certs in dev/CI;
  // never set this in production (it enables MITM on the storage channel).
  S3_REJECT_UNAUTHORIZED: z.union([z.literal("true"), z.literal("false")]).default("true"),
  // SSRF escape hatch: when "true", allow S3_ENDPOINT/STORAGE_URL to point at a
  // private/loopback/link-local host (self-hosted storage on a private network).
  // Cloud metadata endpoints (169.254.169.254 etc.) remain blocked regardless.
  // The internal-storage default (RustFS over a private/loopback address) implies
  // this automatically — see validateStorageEndpoints().
  S3_ALLOW_PRIVATE_ENDPOINT: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .default("false"),
  // Optional comma-separated exact-host allowlist that opts specific hosts back in
  // even when private ranges are otherwise rejected.
  STORAGE_ALLOWED_HOSTS: z.string().optional(),

  // Application configuration
  PORT: z.coerce.number().int().min(1).max(65535).optional().default(3333),
  PRESIGNED_URL_EXPIRATION: z.coerce.number().int().min(60).max(86400).optional().default(3600),
  PRESIGNED_GET_URL_EXPIRATION: z.coerce.number().int().min(60).max(86400).optional().default(900),
  SECURE_SITE: z.union([z.literal("true"), z.literal("false")]).default("true"),
  STORAGE_URL: z.string().optional(), // Public URL for internal storage presigned URLs (required when ENABLE_S3=false, e.g., http://192.168.1.100:9000)
  DATABASE_URL: z.string().optional().default("file:/app/server/prisma/ouitransfer.db"),
  CUSTOM_PATH: z.string().optional(),

  // Security
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  CSRF_SECRET: z
    .string()
    .min(32, "CSRF_SECRET must be at least 32 characters")
    .describe("HMAC key for CSRF token generation — must be distinct from JWT_SECRET"),
  COOKIE_SECRET: z
    .string()
    .min(32, "COOKIE_SECRET must be at least 32 characters")
    .describe(
      "Secret used to sign httpOnly cookies — must be distinct from JWT_SECRET and CSRF_SECRET",
    ),
  ENCRYPTION_SECRET: z
    .string()
    .min(32, "ENCRYPTION_SECRET must be at least 32 characters")
    .describe(
      "Master key for encrypting secrets at rest (2FA TOTP secret, LDAP bind password) via AES-256-GCM + HKDF",
    ),
  TRUST_PROXY: z
    .string()
    .optional()
    .default("loopback")
    .transform((v) => v.toLowerCase()),
  ENABLE_API_DOCS: z.union([z.literal("true"), z.literal("false")]).optional(),
  OAUTH_ALLOWED_REDIRECT_HOSTS: z.string().optional(),
  // SSRF escape hatch for self-hosted IdPs (A5-05 OAuth): when "true", allow OIDC
  // discovery/token/userinfo/JWKS fetches to target a private/loopback/link-local
  // host (e.g. an internal Keycloak/Authentik on a trusted network). Cloud metadata
  // endpoints (169.254.169.254 etc.) remain blocked regardless. Defaults to "false".
  OAUTH_ALLOW_PRIVATE_ENDPOINT: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .default("false"),
  // Optional comma-separated exact-host allowlist that opts specific IdP hosts back
  // in even when private ranges are otherwise rejected (A5-05 OAuth).
  OAUTH_ALLOWED_ENDPOINT_HOSTS: z.string().optional(),
  // SSRF escape hatch for self-hosted LDAP/AD (A5-05/A5-11 LDAP): when "true",
  // allow the LDAP client and the /admin/ldap/test endpoint to connect to a
  // private/loopback/link-local host (e.g. an internal Active Directory domain
  // controller on a trusted network — the common case for self-hosted deploys).
  // Cloud metadata endpoints (169.254.169.254 etc.) remain blocked regardless.
  // Defaults to "false": private targets must be explicitly opted in.
  LDAP_ALLOW_PRIVATE_HOST: z
    .union([z.literal("true"), z.literal("false")])
    .optional()
    .default("false"),
  // Optional comma-separated exact-host allowlist that opts specific LDAP hosts
  // back in even when private ranges are otherwise rejected (A5-05/A5-11 LDAP).
  LDAP_ALLOWED_HOSTS: z.string().optional(),
});

// ───────────────────────────────────────────────────────────────────────────
// A8-01 — Refuse to boot in production with a known shipped placeholder secret
// or a low-entropy secret.
//
// `env.ts` itself has never shipped an insecure default — the danger is that the
// previous docker-compose.yaml injected weak `${VAR:-dev-...}` fallbacks that
// satisfied the min(32) length check. Those compose defaults are removed (now
// `${VAR:?required}`), but as defense-in-depth we ALSO reject the exact shipped
// placeholder strings, and apply a low-entropy gate, when `NODE_ENV=production`.
//
// Dev/test must still boot: the `.env.development` values and the test-seeded
// secrets (see vitest.setup.ts) are NOT in the denylist below, and the
// entropy/production gate only fires under `NODE_ENV=production`. We denylist the
// EXACT placeholder strings, NOT a blanket `dev-*` substring match.
// ───────────────────────────────────────────────────────────────────────────

/**
 * Exact placeholder secret strings that were ever shipped in compose/example
 * files. Any of these in production = a publicly-known signing key → auth forgery.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set<string>([
  "dev-jwt-secret-do-not-use-in-production!!",
  "dev-csrf-secret-do-not-use-in-production!",
  "dev-cookie-secret-not-for-production!",
  // S3 credential placeholder shipped as the RustFS default
  "ouitransfer",
]);

/**
 * Shannon entropy (bits per character) of a string. A high-quality random
 * 32-char secret (hex/base64) scores well above 3 bits/char; a repeated or
 * low-variety string (e.g. "aaaa...", "changeme-changeme...") scores low.
 */
function shannonEntropyPerChar(value: string): number {
  if (value.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * In production, a signing secret must not be a shipped placeholder and must
 * carry enough entropy (>= 3 bits/char AND >= 12 distinct characters) to make
 * brute-forcing infeasible. Dev/test are exempt (this gate is production-only).
 */
function assertStrongProductionSecret(name: string, value: string): void {
  if (KNOWN_PLACEHOLDER_SECRETS.has(value)) {
    throw new Error(
      `${name} is set to a known placeholder value (${value}). This secret is public — ` +
        "generate a unique one with `openssl rand -hex 32` and set it in your environment.",
    );
  }
  const distinctChars = new Set(value).size;
  const entropy = shannonEntropyPerChar(value);
  if (entropy < 3 || distinctChars < 12) {
    throw new Error(
      `${name} has insufficient entropy for production (Shannon ${entropy.toFixed(2)} bits/char, ` +
        `${distinctChars} distinct chars). Generate a high-entropy secret with ` +
        "`openssl rand -hex 32`.",
    );
  }
}

const refinedEnvSchema = envSchema
  .refine((data) => data.CSRF_SECRET !== data.JWT_SECRET, {
    message:
      "CSRF_SECRET must be different from JWT_SECRET — reusing the same secret for both is a security risk",
    path: ["CSRF_SECRET"],
  })
  .refine((data) => data.COOKIE_SECRET !== data.JWT_SECRET, {
    message:
      "COOKIE_SECRET must be different from JWT_SECRET — reusing the same secret for both is a security risk",
    path: ["COOKIE_SECRET"],
  })
  .refine((data) => data.COOKIE_SECRET !== data.CSRF_SECRET, {
    message:
      "COOKIE_SECRET must be different from CSRF_SECRET — reusing the same secret for both is a security risk",
    path: ["COOKIE_SECRET"],
  })
  .refine((data) => data.ENCRYPTION_SECRET !== data.JWT_SECRET, {
    message:
      "ENCRYPTION_SECRET must be different from JWT_SECRET — reusing the same secret for both is a security risk",
    path: ["ENCRYPTION_SECRET"],
  })
  .superRefine((data, ctx) => {
    // A8-01: production-only placeholder + entropy gate for all signing/encryption
    // secrets. Dev and test boot unchanged.
    if (process.env.NODE_ENV !== "production") return;
    const secrets: Array<[string, string]> = [
      ["JWT_SECRET", data.JWT_SECRET],
      ["CSRF_SECRET", data.CSRF_SECRET],
      ["COOKIE_SECRET", data.COOKIE_SECRET],
      ["ENCRYPTION_SECRET", data.ENCRYPTION_SECRET],
    ];
    for (const [name, value] of secrets) {
      try {
        assertStrongProductionSecret(name, value);
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: err instanceof Error ? err.message : String(err),
          path: [name],
        });
      }
    }
    // S3 credentials, when present, must also not be placeholders in production.
    for (const name of ["S3_ACCESS_KEY", "S3_SECRET_KEY"] as const) {
      const value = data[name];
      if (value && KNOWN_PLACEHOLDER_SECRETS.has(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${name} is set to the known placeholder "${value}" — set a unique credential.`,
          path: [name],
        });
      }
    }
  });

export const env = refinedEnvSchema.parse(process.env);
