/**
 * Timeout Configuration for Large File Handling
 *
 * Balances two competing concerns:
 *
 * 1. Security: Fast rejection of idle/slow connections (slowloris, resource exhaustion).
 *    - `connection.timeout`: 30s — time for the TCP connection to complete the HTTP handshake.
 *    - `connection.keepAlive`: 30s — idle keep-alive before the server closes the socket
 *      (nginx default is 75s; 30s is more conservative).
 *    - `file.streamTimeout`: 30s — max idle time between consecutive chunks during streaming.
 *
 * 2. Usability: Allow legitimate large-file transfers to complete.
 *    - `request.timeout`: 4h — covers a full 10GB upload over a slow connection (~350KB/s).
 *    - `file.uploadTimeout` / `file.downloadTimeout`: 4h / 2h — per-transfer limits.
 *    - `request.bodyTimeout`: disabled (0) — Fastify's bodyTimeout applies to the body
 *      parsing phase only; we rely on `requestTimeout` for the overall request limit.
 *
 * Note: Rate limiting (100 req/min) provides an additional layer of protection against
 * resource-exhaustion attacks, complementing the timeout settings here.
 *
 * All values are in milliseconds unless otherwise noted.
 * Override at runtime via the environment variables documented on `envTimeoutOverrides`.
 */

export const timeoutConfig = {
  connection: {
    /**
     * Maximum time allowed to receive the first byte of the HTTP request after TCP connect.
     * 30s protects against slowloris attacks (attacker sends headers one byte at a time).
     * Previously: 0 (disabled — vulnerable to slowloris).
     */
    timeout: 30_000,

    /**
     * Maximum idle time for a keep-alive connection.
     * 30s is conservative but appropriate; nginx default is 75s.
     * Previously: 20 * 60 * 60 * 1000 (20 hours — insane).
     */
    keepAlive: 30_000,
  },

  request: {
    /**
     * Maximum total time for a single request, including body transfer.
     * 4 hours covers a 10GB upload at ~700KB/s. Adjust via REQUEST_TIMEOUT env var.
     * Previously: 0 (disabled — no protection against hung uploads).
     */
    timeout: 4 * 60 * 60 * 1000,

    /**
     * Maximum time to fully receive the request body (Fastify's bodyTimeout).
     * Disabled (0): we rely on `request.timeout` for the overall limit. Fastify's
     * bodyTimeout applies only to the body-parsing phase, which is too narrow for
     * streaming large file uploads handled with @fastify/multipart.
     */
    bodyTimeout: 0,
  },

  file: {
    /**
     * Maximum time for a single file upload to complete.
     * 4 hours covers 10GB at ~700KB/s over a slow connection.
     */
    uploadTimeout: 4 * 60 * 60 * 1000,

    /**
     * Maximum time for a single file download to complete.
     * 2 hours is generous for downloads (typically faster than uploads).
     */
    downloadTimeout: 2 * 60 * 60 * 1000,

    /**
     * Maximum idle time between consecutive chunks during streaming.
     * 30s — if the connection goes silent for 30s, it is assumed broken.
     */
    streamTimeout: 30_000,
  },

  token: {
    /** Default token expiration for presigned URLs (1 hour). */
    expiration: 60 * 60 * 1000,
  },
};

/**
 * Get timeout configuration based on file size.
 * Very large files (>10GB) get longer presigned URL expiry.
 */
export function getTimeoutForFileSize(fileSizeBytes: number) {
  const fileSizeGB = fileSizeBytes / (1024 * 1024 * 1024);

  if (fileSizeGB > 100) {
    return {
      ...timeoutConfig,
      token: {
        expiration: 24 * 60 * 60 * 1000, // 24 hours for very large files
      },
    };
  }

  if (fileSizeGB > 10) {
    return {
      ...timeoutConfig,
      token: {
        expiration: 4 * 60 * 60 * 1000, // 4 hours for large files
      },
    };
  }

  return timeoutConfig;
}

/**
 * Environment-based timeout overrides.
 * Set these in your .env file to tune defaults without code changes.
 *
 * @env KEEP_ALIVE_TIMEOUT  - Override connection.keepAlive (ms). Default: 30_000.
 * @env REQUEST_TIMEOUT     - Override request.timeout (ms). Default: 4h.
 * @env TOKEN_EXPIRATION    - Override token.expiration (ms). Default: 1h.
 */
export const envTimeoutOverrides = {
  keepAliveTimeout: process.env.KEEP_ALIVE_TIMEOUT
    ? parseInt(process.env.KEEP_ALIVE_TIMEOUT, 10)
    : timeoutConfig.connection.keepAlive,

  requestTimeout: process.env.REQUEST_TIMEOUT
    ? parseInt(process.env.REQUEST_TIMEOUT, 10)
    : timeoutConfig.request.timeout,

  tokenExpiration: process.env.TOKEN_EXPIRATION
    ? parseInt(process.env.TOKEN_EXPIRATION, 10)
    : timeoutConfig.token.expiration,
};
