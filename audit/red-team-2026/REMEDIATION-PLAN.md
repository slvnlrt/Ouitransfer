# Red Team 2026 — Consolidated Remediation Plan

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done
**Convention:** Perfect implementation, zero technical debt. Every finding is fixed —
Critical, High, Medium, Low, AND Info. None are optional. Add/extend tests for every
security-critical change (`app.inject()` integration tests for full request lifecycle).

Total raw findings: 108 (10 Critical · 21 High · 34 Medium · 29 Low · 14 Info).
After de-duplication of cross-corroborated findings: see batches below.

## Cross-cutting / duplicate findings (fix once)

| Canonical | Duplicates / related | Issue |
|---|---|---|
| ~~**X-Real-IP/X-User-Agent header trust**~~ ✅ R3a | A1-01 (Crit), A8-02 (Crit) | `getClientInfo()` trusts spoofable headers → lockout/rate-limit bypass + audit poisoning |
| **Reverse-share multipart objectName injection** | A3-01 (Crit), A4-01 (Crit) | 4 public multipart routes skip `validateObjectName` |
| **Download bypasses share lifecycle** | A4-02 (Crit), A3-04 (High), A2-04 (Low) | `checkFileAccess` checks only password/ownership; not scoped to a shareId |
| **Inline-disposition download + proxy CSP** | A3-03 (High), A7-07 (Low) | stored HTML/SVG rendered same-origin |
| **Client-declared size (no HEAD reconcile)** | A3-08 (Med), A4-05 (High) | quota/size bypass |
| **Reverse-share multipart no limits / TOCTOU / presign** | A3-05 (High), A4-04 (High), A4-07 (Med) | quota/maxFiles bypass + orphans |
| **Folder objectName unvalidated** | A2-06 (Low), A3-06 (Med) | cross-tenant delete primitive |
| **Host-header in OAuth base URL / redirect_uri** | A6-01 (High), A5-04 (High) | SSRF/link poisoning + code interception |
| **SSRF on server-side fetch/connect (OIDC discovery/token/userinfo, LDAP host)** | A5-05 (High), A3-07 (Med), A5-11 (Med) | no private-IP/metadata guard |
| **bcrypt cost / bcryptjs** | A1-17 (Info), A8-14 (Low) | raise cost to 12; consider lib |

---

## R1 — Storage & upload integrity (server: file/folder/reverse-share/storage/utils)
- [x] A3-01 / A4-01 (Crit) reverse-share multipart: `validateObjectName(objectName, reverse-shares/<id>)` on part-url/complete/abort/list-parts
- [x] A3-02 (Crit) magic-byte/MIME fail-open: require mimeType (or derive server-side), run both layers unconditionally, **fail closed** on unexpected S3 error, enforce `DANGEROUS_EXTENSIONS` denylist at register; apply to reverse-share register too
- [x] A3-05 / A4-04 / A4-07 (High) reverse-share multipart limits: enforce maxFiles/maxFileSize/allowedFileTypes/owner-quota at create+complete; create `ReverseShareFile` row on complete; atomic maxFiles/quota; presign-time best-effort check
- [x] A3-08 / A4-05 (High/Med) HEAD-reconcile real object size for quota/maxFileSize/stored size on register (direct + reverse-share)
- [x] A2-06 / A3-06 (Med/Low) folder `objectName`: `validateObjectName` on create/check (or server-generate); namespace-guard before `deleteObject`
- [x] A3-09 (Med) use shared `sanitizeFilename` in reverse-share multipart create
- [x] A3-11 (Low) strip Unicode bidi/zero-width controls in `sanitizeFilename`; warn on dangerous double-extension
- [x] A3-12 (Low) `sharp(..., { limitInputPixels, failOn })` on avatar/logo/background
- [x] A3-10 (Low) fix dead GET reverse-share internal-storage download path to use POST authz
- [x] A3-07 (Med) validate `S3_ENDPOINT`/`STORAGE_URL` at boot (reject private/loopback/link-local/metadata unless allowlisted; https in prod); document `S3_REJECT_UNAUTHORIZED=false` test-only
- [x] A3-13 / A3-14 (Info) document header-only sniffing limits; keep forced attachment (covered by R2 A3-03)

## R2 — Download/share access control (server: file/share routes + service + web proxy)
- [x] A4-02 / A3-04 / A2-04 (Crit/High/Low) `checkFileAccess` replaced by `resolveDownloadTarget`: a download key is EITHER an opaque per-share file token (bound to a specific shareId, full lifecycle gate via `assertShareAccessible`) OR a raw objectName (JWT owner only). Extracted shared `assertShareAccessible(share)` used by `getShare` + the download path. maxViews enforced on download via the views>=maxViews gate (not per-file increment, to keep ZIP downloads correct).
- [x] A3-03 / A7-07 (High/Low) forced `Content-Disposition: attachment` + `application/octet-stream` + `nosniff` (+ CSP sandbox) on streamed downloads; restrictive CSP (sandbox + default-src 'none') + nosniff applied to `/api/*` proxy responses in `apps/web/src/proxy.ts`
- [x] A4-03 (High) per-share password brute-force lockout (share-password-attempts.service, reuses LoginAttempt keyed by share) on `/access`, `/check-password`, and the password-bearing download path; per-route IP rate limits added; failed password audited on the download path
- [x] A4-06 (Med) metadata endpoints (share + reverse-share): 404 for owner-inactive; name/description withheld for closed shares; expiry computed from date
- [x] A4-08 (Med) non-owner share response omits `userId` (blank) and replaces raw `objectName` with the opaque per-share file token (folders' objectName/userId blanked too)
- [x] A4-09 (Med) self-declared cookie email never mutates recipient stats (access accessCount/lastAccessedAt nor download downloadCount/lastDownloadedAt); only `token`-verified arrivals do
- [x] A2-01 (High) IDOR: `findFilesByIds`/`findFoldersByIds` scoped by `userId` in `addItemsToShare`; inject test added
- [x] A4-10 (Med) reverse-share recipient add returns a generic conflict (no "already exists" oracle); (spam cap handled in R5)
- [x] A4-12 (Low) alias min length raised 5→8; per-IP enumeration rate-limits on reverse-share upload-info + metadata; share metadata tightened 60→30/min
- [x] A4-11 / A4-13 / A4-14 (Low) documented anonymous csrfExempt surface + presigned/streamed delivery; expiry computed from date (not just the persisted flag) in lifecycle gate + metadata

## R3 — Authentication & session + access-control core (server: auth/two-factor/user/middleware)
### R3a (2FA / trusted-device / credentials-at-rest) — DONE
- [x] **X-Real-IP/X-User-Agent (Crit, A1-01/A8-02)** stop reading `x-real-ip`/`x-user-agent`; use Fastify `request.ip`; add per-IP failed-login throttle alongside email lockout
- [x] A1-02 (High, TD-3) route `/auth/2fa/verify` + `/2fa/login` through lockout accounting; dedicated 2FA failure counter
- [x] A1-03 (High) persist last-used TOTP step; reject replay; consider window 0/1
- [x] A1-04 (High) trusted-device: server-issued random device secret in httpOnly cookie; `@@unique([userId, deviceHash])`; stop deriving from UA/IP
- [x] A1-05 (High) require re-auth (password/step-up) to enable 2FA + regenerate backup codes
- [x] A1-06 (Med) forgot-password: generic 200 for disabled-password non-LDAP users (no enumeration) — `requestPasswordReset` returns silently for disabled-auth local users (no ForbiddenError oracle); route always sends the generic 200; inject tests in `auth-r3b.integration.test.ts`
- [x] A1-07 (Med) backup codes ≥80-bit (`randomBytes(10)`); fix comment
- [x] A1-08 (Med) encrypt `twoFactorSecret` at rest (AES-256-GCM/ENCRYPTION_SECRET); hash backup codes
- [x] A1-09 (Med) password policy: min 12 default (`seed-data.ts`) + max-72-byte guard + 3-of-4 complexity, centralised in `auth/password-policy.ts` (Zod schema + `validatePasswordMiddleware`); revoke trusted devices on reset (`resetPassword`) AND on 2FA disable (`two-factor/service.disable2FA`); web register/reset/profile/invite forms + i18n updated (12 chars + new max/complexity keys across 23 locales)
- [x] A1-10 (Med) login: always runs a bcrypt compare (real hash or fixed `DUMMY_PASSWORD_HASH`) to mask user-existence timing; inactive/external/unknown all return the generic "Invalid credentials" (no distinct pre-password errors); inject tests
- [x] A1-11 (Low) derive challenge secret from JWT_SECRET via HKDF (stable across instances); optionally bind IP/UA
- [x] A1-12 (Low) logout now `await`s `revokeAllUserTokens` (surfaces failures) AND bumps `tokenVersion` so the current access token is invalidated immediately; inject test
- [x] A1-13 (Low) `sameSite: "strict"` for refresh cookie (`auth-cookies.ts`); test updated
- [x] A1-14 (Low) documented the proxy contract for the refresh cookie path vs `/auth/refresh` route in `auth.config.ts` (browser-facing `/api` prefix is intentional + load-bearing)
- [x] A1-17 / A8-14 (Info/Low) bcrypt cost raised 10→12 everywhere (`BCRYPT_COST` in `password-policy.ts`: register/reset/invite/user-update/share/reverse-share/reset-password script). bcryptjs@3 upgrade DEFERRED — the major bump changes the async API (callback→promise) and touches every hash/compare call site + tests; cost-12 on the current 2.4.3 already meets the hardening goal, so the lib upgrade is left to a dedicated dependency PR (also see A8-15 automerge-exclusion).
- [x] A2-02 (Med) last-admin / self-lockout protection on demote/deactivate/delete (`UserService.assertAdminRemovalAllowed`, new `LAST_ADMIN` error code, 409); inject tests in `user-admin-protection.integration.test.ts`
- [x] A2-03 (Med) restrict `allowSetupBypass` to first-user `POST /auth/register` only; `/users` mgmt, `/app/configs|logo|test-smtp`, `/providers*` now `allowSetupBypass: false` (401 in zero-user window); inject tests (+ updated `admin-prevalidation.integration.test.ts`)
- [x] A2-07 (Low) removed `isAdmin` from `BaseRegisterUserSchema`/`RegisterUserInput` + register route schema; repository `createUser` takes `isAdmin` as an explicit server-only arg (never from client body)
- [x] A1-15 / A1-16 / A2-08 / A2-09 / A2-10 (Info) A1-16: `PASSWORD_RESET_REQUEST` audit no longer stores the raw email for unknown accounts (only `userId`+email when a real reset issued). A1-15 (AJV vs Zod), A2-08 (isAdmin JWT claim propagation), A2-09/A2-10 (intentional public metadata; reconciled with R2 opaque file token) annotated in code.

## R4 — Federated identity: OAuth/OIDC & LDAP (server: auth-providers/ldap)
- [x] A5-01 (Crit) verify OIDC `id_token` (JWKS, alg allowlist, iss/aud/exp/iat/nonce); userinfo only for non-OIDC over verified channel — R4a
- [x] A5-02 (Crit) no auto-link by email; require verified-email claim + explicit authenticated link; add `emailVerified` column — R4a
- [x] A5-03 (Crit) server-only `state` in httpOnly cookie bound to session; single-use (delete on lookup); `expiresAt<now` reject — R4a
- [x] A5-04 / A6-01 (High) compute OAuth callback/redirect base from trusted `appUrl`; never accept client `redirect_uri`; relative-only post-login return — R4a
- [x] A5-05 / A3-07 / A5-11 (High/Med) SSRF guard: allowlist/deny private+link-local+loopback+metadata for discovery/token/userinfo/github-email/ldap host + ldap test; reject http issuer; generic error text — **OAuth portion done in R4a** (discovery/token/userinfo/github-email/JWKS); **LDAP host + ldap test done in R4b** (`ldap/ldap-ssrf.ts`, `LDAP_ALLOW_PRIVATE_HOST`/`LDAP_ALLOWED_HOSTS`, generic test-failure message). **Owner-requested relaxation (LDAP egress):** the LDAP guard now blocks ONLY cloud-metadata addresses by default — private/loopback/remote hosts are allowed (an internal DC on a private LAN is the admin's choice). `LDAP_ALLOWED_HOSTS` remains an OPTIONAL exact-host lockdown; `LDAP_ALLOW_PRIVATE_HOST` was removed (private is the default). Metadata block still fires before connecting. (Note: the OAuth/storage SSRF guards are unchanged — this relaxation is LDAP-only.)
- [x] A5-06 (High) always PKCE S256 regardless of provider type — R4a
- [x] A5-07 (High) require LDAPS/StartTLS for non-loopback; reject remote `ldap://`; `tlsSkipVerify` dev-only + forbidden when enabled for non-private — R4b (`ldap/ldap-ssrf.ts` transport policy: `LDAP_CLEARTEXT_REMOTE`/`LDAP_SKIP_VERIFY_REMOTE`). **Owner-requested relaxation:** transport confidentiality is now WARN-only, never blocked — the admin decides on transport. A remote cleartext `ldap://` bind (without StartTLS) and `tlsSkipVerify` are both allowed; each emits a `logger.warn(...)` recommending ldaps:// / StartTLS / proper certs. The `LDAP_CLEARTEXT_REMOTE` / `LDAP_SKIP_VERIFY_REMOTE` hard rejections were removed; the client honors `useTls`/`tlsSkipVerify`/scheme as configured.
- [x] A5-08 (Med) validate/normalize LDAP attribute strings on ingest (length, strip control chars) — R4b (`ldap/sanitize-directory.ts`; applied in `sync.service.ts` parseDisplayName + email ingest)
- [x] A5-09 (Med) pending-state in signed cookie (also fixes multi-instance) — folded into A5-03 — R4a
- [x] A5-10 (Med) log status+redacted marker only; never raw IdP bodies — R4a
- [x] A5-12 (Low) bind external identity to immutable subject only — R4a
- [x] A5-13 (Low) validate `appUrl` canonical origin for LDAP welcome links — R4b (`ldap/app-url.ts` `assertSafeAppUrl`; canonical-origin DTO refinement; divergence warning vs configured `appUrl`). **Consolidated in R5:** `ldap/app-url.ts` now re-exports `isCanonicalHttpOrigin` from the central `config/config-validation.ts` validator (single source of truth, now also rejects path/query/fragment).
- [x] A5-14 (Info) HKDF/scrypt+salt for encryption key derivation; enforce min secret length — **done in R3a, confirmed in R4b**: `ldap/encryption.ts` delegates to `utils/encryption.ts` (HKDF-SHA256, per-record 16-byte salt, per-purpose `info="ldap-bind-password"`, AES-256-GCM); `env.ts:52-54` enforces `ENCRYPTION_SECRET` min 32 chars. No unsalted SHA-256 path remains.

## R5 — Email, invites, notifications (server: email/invite/notification + config-validation)
- [x] A6-02 / A6-08 (Med/Low) per-route IP rate limit (5/min, keyed by `request.ip`) on `POST /register-with-invite` + `GET /invite-tokens/:token`; `/notifications/unsubscribe` already capped 30/h (R2). Global rate-limit `errorResponseBuilder` now emits `statusCode:429`/`code:"RATE_LIMITED"` so the error handler maps throttles to 429 (was falling through to 500). Cheap pre-flight token check stays ahead of bcrypt (bcrypt-DoS bound).
- [x] A6-03 / A4-10 (Med) central `email/spam-guard.ts`: per-user rolling-24h external-email quota (500) + burst cap (100/min) counted via new `EmailJob.senderUserId` column, independent of HTTP request count; `MAX_RECIPIENTS_PER_SHARE=100` ceiling enforced on share + reverse-share recipient-add/replace; `senderUserId` threaded through `emailService.send` for invitation/reminder types. New `RATE_LIMITED` error code; 429 added to notify/remind route schemas.
- [x] A6-04 (Med) `InviteToken.email` column (Prisma migration); `generateInviteToken` stores the lowercased invited email; `registerWithInvite` rejects a mismatched email (case-insensitive) with `INVITE_EMAIL_MISMATCH` (403) **before** bcrypt; null email = open/bearer invite (documented in schema).
- [x] A6-05 (Low) unsubscribe TTL 90d→30d; token embeds the user's `tokenVersion` as `tv`; verify returns it; `unsubscribeUser` + the GET confirm page reject a token whose `tv` ≠ live `tokenVersion` (silent no-op / error page); legacy tokens with no `tv` are rejected.
- [x] A6-06 (Low) `MAX_PENDING_QUEUE_DEPTH=10000` cap (drop non-critical w/ logged warn; priority-1 critical exempt); cleanup now prunes terminal `failed` rows (fixed 7-day window) alongside `sent` (`cleanupTerminalJobs`).
- [x] A6-07 (Low) central `isCanonicalHttpOrigin` + validators in `config/config-validation.ts`: `appUrl` (http(s) origin, no path/query/fragment/userinfo/CRLF), `smtpFromEmail` (email), CRLF-strip + length-cap `smtpFromName`/`appName`. `ldap/app-url.ts` now delegates to the shared helper (A5-13 consolidation). Plain-text email renderer routes `cta.url`/`unsubscribeUrl` through a scheme allowlist (`safeTextUrl`).

## R6 — Web frontend (apps/web) ✅
- [x] A7-01 (High) validate `footerUrl` `^https?://` (reject javascript:/data:/vbscript://) at config-write API + render; add `rel="noopener noreferrer"` to all `target=_blank` — server `footerUrlValidator` (`isSafeHttpLinkUrl`) + render-time `safeHttpUrlOrHash` (`utils/safe-url.ts`) on both footers; `rel` added to both footer `<Link>`s (`add-provider-form.tsx` already had it)
- [x] A7-02 (Med) CSP add `object-src 'none'`, `frame-src 'self' blob:`, `worker-src 'self' blob:`, `manifest-src 'self'` — added in `proxy.ts buildPageCsp`
- [x] A7-03 (Med) nonce-based CSP: drop `script-src 'unsafe-inline'` via per-request nonce + strict-dynamic — `script-src 'nonce-<n>' 'strict-dynamic' 'self'`; nonce generated in `proxy.ts`, forwarded via request `Content-Security-Policy` + `x-nonce` headers; Next auto-nonces App-Router scripts; `next build` smoke OK (proxy recognized as Middleware, all routes dynamic). `style-src 'unsafe-inline'` kept (documented trade-off: Next/Tailwind inline styles + inline `style=` attrs are not nonceable)
- [x] A7-04 (Med) reject `*` in `CSP_STORAGE_ORIGINS`; document storage-origin-only; split img-src/connect-src minimally — `env.ts` refine now rejects any `*`; documented storage-origin-only; `img-src`/`connect-src` each carry only the storage origin
- [x] A7-05 (Med) `getBaseUrl()` validate host against canonical `APP_URL`; only honor X-Forwarded-* from trusted proxy — `APP_URL` used verbatim when set (host headers ignored); otherwise client `X-Forwarded-Host` ignored, connection `host` used
- [x] A7-06 (Low) add `noopener,noreferrer` to all `window.open` — share-details-links-section, reverse-share-details-modal, audit-log-export
- [x] A7-08 (Low) drop free-form `message` URL param in login toast; map `error` codes to i18n only — `use-login.ts` no longer reads `messageParam`

## R7 — Infrastructure, config, dependencies, logging (infra/docker/env/app.ts)
- [x] A8-01 (Crit) removed `:-default` for JWT/CSRF/COOKIE/S3 secrets in compose (now `${VAR:?required}`); `env.ts` `superRefine` denylists the EXACT shipped placeholders (`dev-jwt-secret-do-not-use-in-production!!`, CSRF/COOKIE equivalents, `ouitransfer` for S3) + a Shannon-entropy/distinct-char gate, applied ONLY under `NODE_ENV=production` (dev `.env.development` + test-seeded secrets boot unchanged). `ENCRYPTION_SECRET` is now REQUIRED in compose (`${ENCRYPTION_SECRET:?required}`) + distinct-from-JWT refine. Tests: `env-secret-gate.test.ts`.
- [x] A8-03 (High) RustFS: required creds (no fallback), `RUSTFS_CONSOLE_ENABLE: "false"` default, bound `127.0.0.1:9000` for local; documented reverse-proxy bucket path (Traefik example) for remote browsers.
- [x] A8-04 (High→Med) `error-handler.ts` now returns `http4xxMessage(statusCode)` for non-AppError Fastify 4xx (never forwards `fastifyError.message`); AppError/Zod/JWT/Prisma mapping intact. Tests updated in `error-handler.test.ts`.
- [x] A8-05 (High→Med) Pino `redact` (authorization/cookie/x-csrf-token headers + `*.password|secret|token|bindPassword|clientSecret|smtpPass|twoFactorSecret|backupCodes` + top-level forms) with `[REDACTED]` censor + `req` serializer stripping sensitive headers; config in `utils/log-redaction.ts` (separate module so logger mocks don't break it). Tests in `server-config.test.ts`.
- [x] A8-06 (Med) CORS: no-Origin → no ACAO grant (not 403'd); `Origin: null` and unlisted origins → 403; only exact allow-listed origins reflected. Tests in `server-config.test.ts`.
- [x] A8-07 (Med) `/swagger` + `/docs` gated behind admin auth in production (encapsulated `onRequest` admin guard); strict `default-src 'none'` CSP always applied to API JSON, relaxed docs CSP scoped via `onSend` to the `/swagger` `/docs` prefixes only; `ENABLE_API_DOCS=true` documented as not-for-internet-facing. Tests in `server-config.test.ts`.
- [x] A8-08 (Med) trustProxy: default compose keeps `loopback` while publishing 3333 (documented); Traefik example documents `true` is safe only with no host port + prefer a CIDR; A8-08 security note added to `parse-trust-proxy.ts` + env examples.
- [x] A8-09 (Med) container hardening: `no-new-privileges:true` + `cap_drop: [ALL]` on all four services; `read_only: true` + tmpfs on web/docs; `USER ouitransfer` in the server-runner Dockerfile stage + `/app/server` pre-owned so the named volume inherits non-root ownership (no root window); `server-start.sh` documents the root path is bind-mount-only.
- [x] A8-10 (Med) pinned all image tags to immutable versions (`rustfs/rustfs:1.0.0`, `ghcr.io/slvnlrt/ouitransfer-*:0.1.0`) in active + Traefik-example services; Renovate manages bumps.
- [x] A8-11 (Med→Low) `/health` = public minimal liveness `200/503` (no subsystem detail); `/health/status` = **authenticated** (any logged-in user, JWT-gated — NOT admin) detailed `checks{database,storage,email}` breakdown. This closes the unauthenticated-probe vector (the actual finding) while preserving the user-facing email/notifications-disrupted indicator (feature 10.2/TD-42). Frontend: all authenticated users read `/health/status`; user email indicator retained. Tests: `health.test.ts`, `health-status.integration.test.ts`, web `system-status-bar.test.tsx`. **(Post-review adjustment: initially over-corrected to admin-only, which broke the legit user indicator; relaxed to auth-gated per owner review.)**
- [x] A8-13 (Low) HSTS `preload: true` added to helmet config.
- [x] A8-15 (Low) `renovate.json`: security-critical deps (`@fastify/jwt`, `jose`, `@fastify/csrf-protection`, `bcryptjs`, `otpauth`, `@fastify/helmet`/`helmet`, `@fastify/rate-limit`, `ldapts`, `nodemailer`) excluded from automerge (manual review; also covers the deferred bcryptjs@3 bump).
- [x] A8-12 (Low) moot after the R3a X-Real-IP fix; added `normalizeIp()` in `auth-cookies.ts` (strips `::ffff:` IPv4-mapped prefix) for consistent audit IP search/grouping.
- [x] **Env wiring** — `ENCRYPTION_SECRET` (required) + optional SSRF opt-ins (`S3_ALLOW_PRIVATE_ENDPOINT`/`STORAGE_ALLOWED_HOSTS`/`OAUTH_ALLOW_PRIVATE_ENDPOINT`/`OAUTH_ALLOWED_ENDPOINT_HOSTS`/`LDAP_ALLOW_PRIVATE_HOST`/`LDAP_ALLOWED_HOSTS`) + `APP_URL` (web) documented in `docker-compose.yaml`/`.env.docker.example`/`.env.example`; `APP_URL`/`CSP_STORAGE_ORIGINS` added to Turbo `passThroughEnv`; `docker-compose.ci.yml` + `e2e.yml` set `ENCRYPTION_SECRET` (+ base-file required vars via workflow `env:`). Docs (EN+FR quick-start/manual-installation/architecture/api) updated.

---

## Exec order (sequential — one implementer agent at a time, Opus)
R1 → R2 → R3 → R4 → R5 → R6 → R7. Critical-bearing batches (R1, R2, R3, R4, R7) first
where dependencies allow. Each batch: implement ALL its items, extend tests, run
`pnpm --filter <pkg> type-check` + `test`, commit atomically.
