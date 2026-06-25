/**
 * A8-05 — Pino redaction config (single source of truth, imported by app.ts).
 *
 * The global error handler logs the full error object, and request serializers
 * can surface auth/cookie headers; a misconfigured SMTP/LDAP/S3 client can throw
 * an error whose message/props embed a credential. These paths are redacted
 * before anything reaches stdout / a log aggregator. Mirrors the audit-metadata
 * denylist (modules/audit/service.ts).
 *
 * NOTE: kept in its own module (NOT logger.ts) because logger.ts is widely mocked
 * in unit tests; app.ts must always read the real redaction config.
 */
export const LOG_REDACT_PATHS: string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-csrf-token"]',
  "request.headers.authorization",
  "request.headers.cookie",
  "res.headers['set-cookie']",
  // Wildcard (any nesting depth) + top-level forms of each sensitive field.
  "*.password",
  "*.secret",
  "*.token",
  "*.bindPassword",
  "*.clientSecret",
  "*.smtpPass",
  "*.twoFactorSecret",
  "*.backupCodes",
  "password",
  "secret",
  "token",
  "bindPassword",
  "clientSecret",
  "smtpPass",
  "twoFactorSecret",
  "backupCodes",
];

export const LOG_REDACT_CENSOR = "[REDACTED]" as const;

interface SerializedReq {
  method?: string;
  url?: string;
  headers?: Record<string, unknown>;
  ip?: string;
}

/**
 * Request serializer that strips sensitive headers from request log lines.
 * Pino's default serializer logs the full header map; replace authorization /
 * cookie / csrf with the censor marker so session tokens never land in logs.
 */
export function redactRequestSerializer(request: SerializedReq) {
  const headers = { ...(request.headers ?? {}) };
  for (const key of ["authorization", "cookie", "x-csrf-token"]) {
    if (key in headers) headers[key] = LOG_REDACT_CENSOR;
  }
  return {
    method: request.method,
    url: request.url,
    ip: request.ip,
    headers,
  };
}
