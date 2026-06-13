# Red Team Report — A8: Infrastructure, Config, Secrets, Dependencies, Logging

## Summary

Offensive review of Ouitransfer's deployment surface: Docker Compose (3+1 containers: RustFS storage, Fastify server, Next.js web, Fumadocs docs), the multi-target `Dockerfile`, `infra/server-start.sh`, server env validation (`env.ts`), cross-cutting Fastify middleware (`app.ts`: CORS, helmet/CSP, HSTS, rate-limit, CSRF, JWT), the error handler, audit logging, schedulers, and the dependency set.

The core application middleware is, on the whole, well-built: secrets are length-validated (≥32) and required (no insecure dev default leaks through `env.ts`), the three secrets are forced to be mutually distinct, the error handler does **not** leak stack traces or DB internals for 5xx, per-route rate limits cover the auth-sensitive endpoints (login 5/min, forgot 3/min, reset 3/min, share-password 5/10min), Fastify timeouts are tuned against slowloris, proto/constructor poisoning is set to error, and AJV strips unknown properties. These are real strengths and are listed under Tested-and-OK.

The serious problems are concentrated in **deployment configuration and one cross-cutting input-trust bug**:

1. The shipped `docker-compose.yaml` hard-codes **weak, well-known default secrets** for `JWT_SECRET`/`CSRF_SECRET`/`COOKIE_SECRET` (and `ouitransfer:ouitransfer` for S3) via `${VAR:-default}`. These satisfy the ≥32-char check and silently boot a "production" stack with publicly-known signing keys → full auth forgery. This is the single most dangerous finding.
2. `getClientInfo()` trusts the `X-Real-IP` request header **unconditionally**, bypassing `trustProxy` entirely → any client can forge the client IP recorded in every audit log (login failures, lockouts, share-password failures), poisoning the security audit trail (OWASP A09).
3. The RustFS storage container publishes `9000:9000` to the host with default `ouitransfer:ouitransfer` credentials and the admin **console enabled** (`RUSTFS_CONSOLE_ENABLE: "true"`) in the default file — object storage and its admin UI exposed to the world.

Severity counts: **Critical 2 · High 4 · Medium 6 · Low 4** (16 findings).

## Secret inventory

| Secret | Source | Default | Required in prod? | Verdict |
|---|---|---|---|---|
| `JWT_SECRET` | `env.ts:26` (≥32) / compose `:76,125` | **`dev-jwt-secret-do-not-use-in-production!!`** (compose) | Yes (no code default) | **CRITICAL** — env.ts has no default, but compose injects a weak one that passes the length check |
| `CSRF_SECRET` | `env.ts:27` (≥32) / compose `:77` | **`dev-csrf-secret-do-not-use-in-production!`** | Yes | **CRITICAL** (same mechanism) |
| `COOKIE_SECRET` | `env.ts:31` (≥32) / compose `:78` | **`dev-cookie-secret-not-for-production!`** | Yes | **CRITICAL** (same mechanism) |
| `S3_ACCESS_KEY` | compose `:36,68` | **`ouitransfer`** | Yes | **HIGH** — weak default, no entropy/length check |
| `S3_SECRET_KEY` | compose `:37,69` | **`ouitransfer`** | Yes | **HIGH** — weak default |
| `ENCRYPTION_SECRET` | `env.ts:37` (≥32, optional) | none (optional) | Only if LDAP | OK — required only when LDAP enabled; length-checked |
| `DATABASE_URL` | `env.ts:22` | `file:/app/server/prisma/ouitransfer.db` | No | OK (SQLite path) |
| CI secrets | `docker-compose.ci.yml:34-36` | `ci-e2e-*-minimum-32-characters-long-ok` | N/A (CI only) | OK — clearly test-only, isolated overlay |
| `.env.example` / `.env.docker.example` | repo | **empty** (`JWT_SECRET=`) | — | OK — example files ship empty, not committed real secrets |
| Repo-wide hardcoded secret scan | source tree | none found | — | OK — no secrets committed in `apps/`, `infra/`, `packages/` |

Key nuance: `env.ts` itself is **correct** — it has no insecure fallback for the three signing secrets, enforces ≥32 chars, and enforces mutual distinctness (`env.ts:47-62`). The weakness is entirely that the **shipped compose file re-introduces weak defaults** that satisfy those checks.

## Findings

### [CRITICAL] Weak default signing secrets shipped in docker-compose.yaml — ID A8-01
- **Severity:** Critical
- **Location:** `docker-compose.yaml:76-78` (server), `:125` (web), `.env.docker.example:48-50`
- **OWASP:** A05 Security Misconfiguration / A02 Cryptographic Failures
- **Description:** The default compose file uses `${JWT_SECRET:-dev-jwt-secret-do-not-use-in-production!!}` (and analogous CSRF/COOKIE defaults). Each default is exactly long enough to pass the `min(32)` check in `env.ts`, so the server boots successfully with publicly-known secrets if the operator runs `docker compose up -d` without first populating `.env`. The compose header (`docker-compose.yaml:13-14`) and `SCRIPTS.md` explicitly advertise `docker compose up -d` as "works with localhost defaults," inviting exactly this. The web container also receives `JWT_SECRET` with the same weak default (`:125`).
- **Attack/misconfig scenario:** An operator deploys with the out-of-the-box compose (or sets `FRONTEND_ORIGIN` for CORS but forgets the secrets). The known `JWT_SECRET` lets any attacker forge a valid admin JWT (`{userId, isAdmin:true, tokenVersion}`) — the `trusted` callback only validates tokenVersion, not the signing key’s secrecy — granting full admin takeover, file access, and user impersonation. The known `COOKIE_SECRET` lets them forge signed cookies; the known `CSRF_SECRET` defeats CSRF.
- **Evidence:**
  - `docker-compose.yaml:76` `JWT_SECRET: "${JWT_SECRET:-dev-jwt-secret-do-not-use-in-production!!}"`
  - `docker-compose.yaml:77-78` CSRF/COOKIE equivalents
  - `apps/server/src/env.ts:26-36` length-only validation (no entropy / no denylist of known-bad values)
  - `apps/server/src/app.ts:165-177` JWT secret = `env.JWT_SECRET`, `trusted: validateTokenVersion` (no key-secrecy check)
- **Remediation:** Remove the `:-default` fallbacks for `JWT_SECRET`, `CSRF_SECRET`, `COOKIE_SECRET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` so an unset value makes Compose fail fast (use `${JWT_SECRET:?JWT_SECRET is required}`). Additionally, add a denylist/entropy gate in `env.ts`: reject any secret matching the shipped `dev-*` placeholders or with low Shannon entropy, and refuse to boot when `NODE_ENV=production`. Have `server-start.sh` print a hard error if a known-placeholder secret is detected.

### [CRITICAL] Audit-log client IP fully spoofable via X-Real-IP (trustProxy bypass) — ID A8-02
- **Severity:** Critical (integrity of security logs)
- **Location:** `apps/server/src/utils/auth-cookies.ts:94-105`
- **OWASP:** A09 Security Logging & Monitoring Failures / A05
- **Description:** `getClientInfo()` reads `request.headers["x-real-ip"]` and `x-user-agent` **directly off the request**, with no dependence on `trustProxy`. It returns that value as `ipAddress`, which is then persisted to `AuditLog.ipAddress` for `LOGIN_SUCCESS`, `LOGIN_FAILURE`, `LOGIN_LOCKED`, 2FA, trusted-device, and OIDC events (`auth/routes.ts:99,188,246`). Default `TRUST_PROXY=loopback` (`env.ts:38-42`) is irrelevant here — Fastify’s `request.ip` is correctly gated by trustProxy, but `getClientInfo` ignores `request.ip` whenever a header is present (`x-real-ip || request.ip`).
- **Attack/misconfig scenario:** An attacker brute-forces login while sending `X-Real-IP: 8.8.8.8` (rotating values). Every failed-login and lockout audit row records the forged IP, making attribution and IP-based incident response impossible, and lets the attacker frame an arbitrary third-party IP. Because lockout in the audit trail is keyed on this value for human review, the attacker can also evade detection by spreading forged IPs.
- **Evidence:**
  - `auth-cookies.ts:98` `const realIP = headerString(request.headers["x-real-ip"]);`
  - `auth-cookies.ts:102` `const ipAddress = realIP || request.ip || request.socket.remoteAddress || "";`
  - `auth-cookies.ts:83-85` `headerString` does no validation (returns header verbatim)
- **Remediation:** Stop trusting raw `X-Real-IP`/`X-User-Agent`. Use `request.ip` (already trustProxy-gated by Fastify) for audit IPs, and only honor forwarding headers when behind a trusted proxy. If the deployment relies on `X-Real-IP` from Nginx/Caddy, derive it through Fastify’s trustProxy chain (which already handles `X-Forwarded-For`) rather than reading the header unconditionally. Drop `x-user-agent` trust entirely (use the standard `user-agent`).

### [HIGH] RustFS storage exposed on host with default creds and admin console enabled — ID A8-03
- **Severity:** High
- **Location:** `docker-compose.yaml:31-53`
- **OWASP:** A05 Security Misconfiguration
- **Description:** The default `storage` service publishes `9000:9000` to the host, uses `RUSTFS_ACCESS_KEY/SECRET_KEY` defaulting to `ouitransfer`/`ouitransfer`, and sets `RUSTFS_CONSOLE_ENABLE: "true"`. The S3 API must be browser-reachable for presigned uploads, but binding to `0.0.0.0:9000` with default credentials and an enabled admin console exposes the entire object store and its management UI to anyone who can reach the host.
- **Attack/misconfig scenario:** On any internet-facing or LAN host, an attacker reaches `:9000`, authenticates with `ouitransfer:ouitransfer` (or uses the console), and lists/reads/deletes every uploaded file across all shares — total data breach and destruction, independent of the app’s own authz.
- **Evidence:**
  - `docker-compose.yaml:36-38` default keys `ouitransfer` + `RUSTFS_CONSOLE_ENABLE: "true"`
  - `docker-compose.yaml:42-43` `ports: - "9000:9000"`
  - The hardened example (`:218-220`) sets `RUSTFS_CONSOLE_ENABLE: "false"` — but only in the commented Traefik block, not the default that operators actually run.
- **Remediation:** In the default file, require `S3_ACCESS_KEY`/`S3_SECRET_KEY` (no fallback, per A8-01), set `RUSTFS_CONSOLE_ENABLE: "false"` by default, and document that direct `:9000` exposure must be replaced by a reverse-proxied bucket path (as the Traefik example does) for any non-localhost deployment. Bind to `127.0.0.1:9000` for local-only setups.

### [HIGH] Verbose Fastify 4xx error messages forwarded to client — ID A8-04
- **Severity:** High → Medium (info disclosure)
- **Location:** `apps/server/src/utils/error-handler.ts:204-221`
- **OWASP:** A05 / A09
- **Description:** For any error carrying a Fastify `statusCode` in 400–499 that isn’t an AppError/Zod/JWT/Prisma, the handler forwards `fastifyError.message` verbatim to the client (line 207, 213). While 5xx are correctly genericized (`:215-217`), 4xx messages from internal plugins/libraries (multipart, content-type parsers, custom throws) are passed through. These can leak internal field names, limits, library internals, or stack-adjacent detail depending on the throwing code.
- **Attack/misconfig scenario:** An attacker probes upload/content-type/multipart edge cases and reads plugin-internal messages to fingerprint exact library versions and internal constraints, aiding targeted exploitation. The risk is bounded (4xx only, no stack), hence High→Medium.
- **Evidence:** `error-handler.ts:206-208` `response.error = fastifyError.message || http4xxMessage(...)`.
- **Remediation:** For non-AppError Fastify errors, prefer the canonical `http4xxMessage(statusCode)` and only forward `fastifyError.message` when the error is a known, vetted AppError/validation type. Treat library `message` as untrusted for client display.

### [HIGH] No Pino redaction configured — secrets/PII may be logged on error — ID A8-05
- **Severity:** High → Medium
- **Location:** `apps/server/src/app.ts:34-36` (logger config), `apps/server/src/utils/logger.ts` (no serializers/redaction)
- **OWASP:** A09 / A02
- **Description:** Pino is initialized with only `{ level }` — **no `redact` paths and no serializers**. The global error handler logs the full error object (`error-handler.ts:145` `request.log.error({ err: error }, "Request error")`). Fastify’s default serializers log request headers including `cookie` and `authorization` on certain log paths, and any thrown error whose message/properties embed credentials (e.g. SMTP/LDAP/S3 connection errors that include the connection string or password) will be written to stdout in cleartext. The audit-metadata denylist (`audit/service.ts:144-156`) protects the DB, but does **not** protect Pino logs.
- **Attack/misconfig scenario:** A misconfigured SMTP/LDAP/S3 client throws an error whose message contains the credential; it lands in container logs (shipped to a log aggregator), exposing the secret to anyone with log access. Cookie/authorization headers in request logs expose session tokens.
- **Evidence:** `app.ts:34-36` (no `redact`), `logger.ts:1-16` (placeholder only, no config), `error-handler.ts:145`.
- **Remediation:** Configure Pino `redact: { paths: ['req.headers.authorization','req.headers.cookie','*.password','*.secret','*.token','*.bindPassword','*.clientSecret','*.smtpPass'], censor: '[REDACTED]' }` and add custom serializers that strip sensitive headers. Mirror the audit denylist.

### [MEDIUM] CORS allows null/absent Origin with credentials — ID A8-06
- **Severity:** Medium
- **Location:** `apps/server/src/app.ts:98-113`
- **OWASP:** A05 / A07
- **Description:** The CORS callback returns `true` when `!origin` (line 100) **and** `credentials: true` is set (line 111). Requests with no `Origin` header (some non-browser clients, certain `null`-origin contexts like sandboxed iframes / `data:`/`file:` documents, or `Origin: null`) are treated as same-origin and allowed with credentials. Combined with the cookie-based auth, this widens the surface for credentialed cross-context requests that omit/forge a null origin.
- **Attack/misconfig scenario:** Limited — modern browsers send `Origin` on credentialed cross-site requests, and CSRF tokens still gate mutations. But the `!origin → allow` branch is broader than necessary and removes one defense layer; combined with any CSRF-exempt endpoint it is exploitable from null-origin contexts.
- **Evidence:** `app.ts:100` `if (!origin || allowedOrigins.includes(origin)) cb(null, true);`
- **Remediation:** For credentialed CORS, do not auto-allow missing/`null` origins. Allow no-Origin only for explicitly safe, non-credentialed paths, or reflect only exact allow-listed origins. Keep `Vary: Origin`.

### [MEDIUM] Swagger/Scalar docs + relaxed CSP can be enabled in production — ID A8-07
- **Severity:** Medium
- **Location:** `apps/server/src/app.ts:115-141,259-272`, `env.ts:43`
- **OWASP:** A05
- **Description:** `docsEnabled = isDevMode || env.ENABLE_API_DOCS === "true"`. Setting `ENABLE_API_DOCS=true` in production exposes the full OpenAPI spec at `/swagger` and `/docs` (every route, schema, param) **and** relaxes the CSP to `script-src 'self' 'unsafe-inline'` / `style-src 'self' 'unsafe-inline'` for the whole API (`app.ts:127-135`). There is no auth gate on the docs routes.
- **Attack/misconfig scenario:** An operator enables docs for convenience; the entire API surface (including admin endpoints) is enumerated by attackers, and the relaxed `unsafe-inline` CSP weakens any reflected-content protections on API responses.
- **Evidence:** `app.ts:116` `docsEnabled = isDevMode || env.ENABLE_API_DOCS === "true"`; `:131-132` `'unsafe-inline'`; `:259-272` unauthenticated docs registration.
- **Remediation:** Gate `/swagger` and `/docs` behind admin auth (or disallow entirely in production). Keep the strict CSP for API JSON responses regardless of docs, scoping the relaxed CSP only to the docs route prefixes. Document that `ENABLE_API_DOCS=true` is not for internet-facing deployments.

### [MEDIUM] trustProxy parser accepts attacker-controlled-leaning values; `true` documented for prod — ID A8-08
- **Severity:** Medium
- **Location:** `apps/server/src/utils/parse-trust-proxy.ts:11-18`, `docker-compose.yaml:265`
- **OWASP:** A05
- **Description:** The hardened example sets `TRUST_PROXY: "true"` (`docker-compose.yaml:265`), which makes Fastify trust `X-Forwarded-For` from **any** upstream. If the server port (`3333`) is also reachable directly (the default file publishes `3333:3333`, `:102-103`), a client connecting directly with a forged `X-Forwarded-For` controls `request.ip` → spoofs the rate-limit key (`app.ts:154 keyGenerator: request.ip`) and any IP-based logic. `parseTrustProxy` faithfully maps `"true"` → boolean true with no warning.
- **Attack/misconfig scenario:** With `TRUST_PROXY=true` and `3333` exposed, an attacker bypasses the per-route login rate limit by rotating `X-Forwarded-For`, restoring unlimited brute-force against `/auth/login`.
- **Evidence:** `parse-trust-proxy.ts:12` `if (value === "true") return true;`; `app.ts:154`; `docker-compose.yaml:103,265`.
- **Remediation:** Document that `TRUST_PROXY=true` must be paired with **no direct host port** for the server (only the reverse proxy reaches it) — the Traefik example already drops the port, but the cross-reference should be explicit. Prefer a specific proxy CIDR over `true`. In the default direct-port file, never expose `3333` alongside a permissive trustProxy.

### [MEDIUM] Containers/start script run as root to chown, then drop — large root-time attack window — ID A8-09
- **Severity:** Medium
- **Location:** `infra/server-start.sh:26-49,80-84`, `Dockerfile:96-108`
- **OWASP:** A05
- **Description:** The server image creates a non-root `ouitransfer` user but the entrypoint runs the **container as root** to chown bind-mounts (`server-start.sh:26-40`), runs Prisma `migrate deploy` and seed as the target user via `su-exec`, then `exec su-exec` to drop privileges only for the final node process. The container therefore starts as PID 1 root and performs filesystem writes (`find ... -exec chown`, recursive chmod) as root. Compose sets `no-new-privileges` only on `storage` (`:51-52`), **not** on `server`, `web`, or `docs`. No `read_only`, no `cap_drop`, no user namespacing on the app services.
- **Attack/misconfig scenario:** A pre-auth RCE in the server during the root window, or abuse of the broad `chown -R`/`chmod -R 755` on attacker-influenced bind-mount contents, runs with root in-container. Lack of `no-new-privileges`/`cap_drop` on the app containers raises blast radius for any container escape primitive.
- **Evidence:** `server-start.sh:26-40` root chown/chmod; `:80-84` final drop; `Dockerfile` server-runner has no `USER` directive (web/docs do, `:157,223`); `docker-compose.yaml:51-52` `no-new-privileges` only on storage.
- **Remediation:** Add `security_opt: ["no-new-privileges:true"]`, `cap_drop: ["ALL"]`, and (where feasible) `read_only: true` with tmpfs for writable paths to `server`, `web`, `docs`. Prefer pre-creating volume ownership (named volumes are already correct UID at first run) so the entrypoint can run as non-root from the start, eliminating the root window. Set `USER ouitransfer` in the server-runner stage.

### [MEDIUM] `rustfs/rustfs:latest` and other floating/`latest` image tags — supply-chain & reproducibility — ID A8-10
- **Severity:** Medium
- **Location:** `docker-compose.yaml:32,57,117,142`
- **OWASP:** A06 Vulnerable & Outdated Components / A08
- **Description:** All four service images use mutable tags: `rustfs/rustfs:latest`, `ghcr.io/slvnlrt/ouitransfer-*:latest`. `latest` is unpinned and not digest-locked, so deployments are non-reproducible and a compromised/poisoned upstream tag is pulled automatically on `pull`/recreate. RustFS in particular is a young project pinned to a moving `latest`.
- **Attack/misconfig scenario:** Upstream tag is compromised or silently regresses; operators `docker compose pull` and run a backdoored/vulnerable image. No digest pinning means no integrity guarantee.
- **Evidence:** `docker-compose.yaml:32` `image: rustfs/rustfs:latest`; `:57,117,142` `*:latest`.
- **Remediation:** Pin to immutable version tags and ideally `@sha256:` digests; let Renovate bump them (it manages digests). Avoid `latest` for storage especially.

### [MEDIUM] Health endpoints disclose subsystem status unauthenticated — ID A8-11
- **Severity:** Medium → Low
- **Location:** `apps/server/src/modules/health/routes.ts:57-134`
- **OWASP:** A05 / A09
- **Description:** `/health` and `/health/status` are unauthenticated (and `/health` is CSRF-exempt) and report DB up/down, storage configured/up/down/not_configured, and a coarse email status. While intentionally coarse (no counters), it still lets an unauthenticated attacker probe which backend subsystems are degraded — useful for timing attacks (e.g. inducing DB/storage failure and confirming impact) and for choosing when to attack.
- **Attack/misconfig scenario:** Attacker polls `/health/status` to detect when storage/DB is degraded (e.g. during their own DoS) and times follow-on attacks; also discloses whether storage is configured/external.
- **Evidence:** `health/routes.ts:106-107` "No authentication required"; `:74-82` per-subsystem booleans exposed.
- **Remediation:** Keep a minimal unauthenticated liveness `200/503` for orchestrators, and move the detailed per-subsystem breakdown behind admin auth. The current shape is acceptable for many threat models — hence Medium→Low — but the subsystem granularity is more than a public probe needs.

### [LOW] Audit `search` filter does not redact and matches IPs/actions only; metadata search absent — ID A8-12
- **Severity:** Low
- **Location:** `apps/server/src/modules/audit/service.ts:239-244,310-315`
- **OWASP:** A09
- **Description:** Audit log read/export is admin-gated (`audit/routes.ts:12,56,98`) and the metadata denylist strips secrets at write time — good. Minor: the `search` uses `contains` on `ipAddress`/`action` only; combined with A8-02 (spoofable IP) an attacker who has poisoned IPs can make their events hard to filter. Low because read access requires admin.
- **Evidence:** `service.ts:240-243`.
- **Remediation:** After fixing A8-02, this is largely moot. Optionally index/normalize stored IPs.

### [LOW] HSTS set without `preload`; relies on reverse proxy for TLS — ID A8-13
- **Severity:** Low
- **Location:** `apps/server/src/app.ts:144-147`
- **OWASP:** A05
- **Description:** HSTS is set (`maxAge 1y`, `includeSubDomains`) but no `preload`. Minor hardening gap; also note HSTS from an HTTP-only API behind a proxy that terminates TLS is mostly defense-in-depth.
- **Evidence:** `app.ts:144-147`.
- **Remediation:** Add `preload: true` if the domain is submitted to the preload list; ensure the edge proxy sets HSTS authoritatively.

### [LOW] `bcryptjs@2.4.3` (pure-JS, older major) used for password hashing — ID A8-14
- **Severity:** Low
- **Location:** `apps/server/package.json:66`, `pnpm-lock.yaml:3792`
- **OWASP:** A06 / A02
- **Description:** Password hashing uses `bcryptjs` 2.4.3. bcryptjs is pure-JS (no native binding) — correct and not vulnerable, but slower than native `bcrypt`, and 2.x is an older line (3.x exists). Slower hashing can pressure operators toward lower cost factors. All other security libs are current and maintained: `jose ^5.10`, `otpauth 9.5.1`, `ldapts 8.1.8`, `nodemailer 8.0.10`, `@fastify/*` 5.x-era, `zod 4.x`.
- **Evidence:** `package.json:66`, lockfile `bcryptjs@2.4.3`.
- **Remediation:** Consider upgrading to `bcryptjs@^3` or native `bcrypt`/`argon2`; verify the configured cost factor (≥12) elsewhere in the auth service.

### [LOW] Renovate auto-merges minor/patch (incl. security libs) without human review — ID A8-15
- **Severity:** Low
- **Location:** `renovate.json:7-9,18-25`
- **OWASP:** A06 / A08
- **Description:** `automerge: true` for patch and minor updates (squash) with only `minimumReleaseAge: 3 days`. A malicious or regressed minor/patch of a security-critical dep (e.g. `@fastify/jwt`, `jose`, `bcryptjs`) is auto-merged without human review after 3 days. Convenient, but a supply-chain risk for the security-relevant subset.
- **Evidence:** `renovate.json:8-9`, packageRules `:18-24`.
- **Remediation:** Exclude security-critical packages (jwt/jose/csrf/bcrypt/otpauth/helmet/rate-limit) from automerge; require manual review for those. Keep automerge for low-risk deps.

## Tested-and-OK

- **Secret validation in `env.ts`** — `JWT_SECRET`/`CSRF_SECRET`/`COOKIE_SECRET` have **no insecure code default**, are `min(32)`, and are forced mutually distinct (`env.ts:26-62`). The weakness is the compose defaults (A8-01), not env.ts.
- **No committed secrets** — repo-wide scan of `apps/`, `infra/`, `packages/`, compose/JSON found no hardcoded credentials in source; `.env.example`/`.env.docker.example` ship empty values; `.gitignore` excludes `.env` and `*.db` (`.gitignore`).
- **Error handler 5xx hygiene** — stack traces and DB/internal messages are never returned for 5xx; Prisma errors mapped to generic codes; serialization errors genericized; unknown errors → generic 500 (`error-handler.ts:46-91,172-231`). (4xx pass-through is A8-04.)
- **Per-route rate limits on auth-sensitive endpoints** — login 5/min, 2FA-login 5/min, forgot-password 3/min, reset-password 3/min, refresh 10/min, csrf-token 30/min, share/reverse-share password & notify 5/10min (`auth/routes.ts:60-63,152-155,287-290,331-334`, `app.ts:213`, `share/routes.ts:854,923`, `reverse-share/routes.ts:1367`). Rate-limit key uses Fastify `request.ip` (trustProxy-gated) — sound under the default `loopback` trustProxy.
- **Slowloris / DoS timeouts** — `connectionTimeout` 30s, `keepAliveTimeout` 30s, `requestTimeout` 4h, `headersTimeout` set; serverFactory explicitly avoids `setTimeout(0)` (`app.ts:38-71`, `timeout.config.ts`). `bodyLimit` 50MB global with tighter `AUTH_BODY_LIMIT` per auth route.
- **Prototype/constructor poisoning** — `onProtoPoisoning: "error"`, `onConstructorPoisoning: "error"` (`app.ts:46-47`).
- **AJV `removeAdditional: "all"`** strips unknown properties (`app.ts:29-32`).
- **CSRF** — double-submit with httpOnly secret cookie, HMAC key distinct from JWT, per-route exempt + normalized fallback set with trailing-slash normalization to prevent bypass (`app.ts:190-257`, `csrf.config.ts`).
- **Audit metadata denylist** — deep-sanitizes `password`, `token`, `secret`, `bindPassword`, `clientSecret`, `smtpPass`, 2FA secrets/backup codes before DB write (`audit/service.ts:144-178`). Audit read/export admin-gated (`audit/routes.ts:12,56,98`). GDPR email redaction implemented (`service.ts:485-516`).
- **Audit/export & retention bounded** — export capped at 100k rows, cursor-paginated; retention deletes in 1000-row batches via LIMIT subquery (`audit/service.ts:273-431`).
- **Schedulers** — cleanup and retention use chained `setTimeout` with re-entrancy guard (`isRunning`), per-phase try/catch, interval floor (`>=1h`), and superseded-handle checks; no unbounded recursion (`cleanup.scheduler.ts:98-268`, `retention.scheduler.ts`).
- **CORS required in production** — boot fails if `CORS_ORIGINS` unset under `NODE_ENV=production`; rejects unlisted origins with 403 (`app.ts:91-110`). (Null-origin gap is A8-06.)
- **redirect-validation** — relative-only `/` allowed (blocks `//`), same-origin + explicit OAuth host allowlist, malformed URLs rejected (`redirect-validation.ts:50-75`).
- **escape-html** — escapes `& < > " '` correctly (`escape-html.ts`).
- **Refresh cookie scoping** — `refresh_token` path-scoped to `/api/auth/refresh`, 7-day TTL (`auth.config.ts`).
- **CI secrets isolated** — `docker-compose.ci.yml` test secrets are clearly test-only and in a separate overlay (`docker-compose.ci.yml:34-36`).
- **NODE_ENV=production baked into images** — set in Dockerfile runner stages (`Dockerfile:86,142,204`), so production behavior (strict CSP, no auto-docs) holds even though compose omits it.
