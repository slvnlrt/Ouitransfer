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
- [ ] A5-01 (Crit) verify OIDC `id_token` (JWKS, alg allowlist, iss/aud/exp/iat/nonce); userinfo only for non-OIDC over verified channel
- [ ] A5-02 (Crit) no auto-link by email; require verified-email claim + explicit authenticated link; add `emailVerified` column
- [ ] A5-03 (Crit) server-only `state` in httpOnly cookie bound to session; single-use (delete on lookup); `expiresAt<now` reject
- [ ] A5-04 / A6-01 (High) compute OAuth callback/redirect base from trusted `appUrl`; never accept client `redirect_uri`; relative-only post-login return
- [ ] A5-05 / A3-07 / A5-11 (High/Med) SSRF guard: allowlist/deny private+link-local+loopback+metadata for discovery/token/userinfo/github-email/ldap host + ldap test; reject http issuer; generic error text
- [ ] A5-06 (High) always PKCE S256 regardless of provider type
- [ ] A5-07 (High) require LDAPS/StartTLS for non-loopback; reject remote `ldap://`; `tlsSkipVerify` dev-only + forbidden when enabled for non-private
- [ ] A5-08 (Med) validate/normalize LDAP attribute strings on ingest (length, strip control chars)
- [ ] A5-09 (Med) pending-state in signed cookie (also fixes multi-instance) — folded into A5-03
- [ ] A5-10 (Med) log status+redacted marker only; never raw IdP bodies
- [ ] A5-12 (Low) bind external identity to immutable subject only
- [ ] A5-13 (Low) validate `appUrl` canonical origin for LDAP welcome links
- [ ] A5-14 (Info) HKDF/scrypt+salt for encryption key derivation; enforce min secret length

## R5 — Email, invites, notifications (server: email/invite/notification + config-validation)
- [ ] A6-02 / A6-08 (Med/Low) per-route IP rate limit on `/register-with-invite`, `GET /invite-tokens/:token`, `/notifications/unsubscribe`
- [ ] A6-03 / A4-10 (Med) per-user daily external-email quota + max-recipients-per-share ceiling + enqueue-rate cap
- [ ] A6-04 (Med) bind invite token to invited email (store + compare case-insensitive); document open invites
- [ ] A6-05 (Low) shorten unsubscribe TTL (30d) + include tokenVersion/nonce for revocation
- [ ] A6-06 (Low) cap pending email-queue depth; prune old failed rows
- [ ] A6-07 (Low) validators for `appUrl` (http(s) origin, no path/CRLF), `smtpFromEmail` (email), CRLF-strip `smtpFromName`/`appName`

## R6 — Web frontend (apps/web)
- [ ] A7-01 (High) validate `footerUrl` `^https?://` (reject javascript:/data:/vbscript://) at config-write API + render; add `rel="noopener noreferrer"` to all `target=_blank`
- [ ] A7-02 (Med) CSP add `object-src 'none'`, `frame-src 'self' blob:`, `worker-src 'self' blob:`, `manifest-src 'self'`
- [ ] A7-03 (Med) nonce-based CSP: drop `script-src 'unsafe-inline'` via per-request nonce + strict-dynamic
- [ ] A7-04 (Med) reject `*` in `CSP_STORAGE_ORIGINS`; document storage-origin-only; split img-src/connect-src minimally
- [ ] A7-05 (Med) `getBaseUrl()` validate host against canonical `APP_URL`; only honor X-Forwarded-* from trusted proxy
- [ ] A7-06 (Low) add `noopener,noreferrer` to all `window.open`
- [ ] A7-08 (Low) drop free-form `message` URL param in login toast; map `error` codes to i18n only

## R7 — Infrastructure, config, dependencies, logging (infra/docker/env/app.ts)
- [ ] A8-01 (Crit) remove `:-default` for JWT/CSRF/COOKIE/S3 secrets in compose (`${VAR:?required}`); env.ts denylist known `dev-*` placeholders + low-entropy + refuse boot in prod. **R3a dependency:** `ENCRYPTION_SECRET` is now a REQUIRED env var (min 32) — add it to docker-compose with `${ENCRYPTION_SECRET:?required}` (no fallback), distinct from the other secrets.
- [ ] A8-03 (High) RustFS: required creds (no fallback), `RUSTFS_CONSOLE_ENABLE: false` default, bind `127.0.0.1:9000` for local; document reverse-proxy path
- [ ] A8-04 (High→Med) genericize non-AppError Fastify 4xx messages (use `http4xxMessage`)
- [ ] A8-05 (High→Med) Pino `redact` for authorization/cookie/password/secret/token/bindPassword/clientSecret/smtpPass + serializers
- [ ] A8-06 (Med) CORS: do not auto-allow missing/null origin with credentials
- [ ] A8-07 (Med) gate `/swagger` + `/docs` behind admin (or disallow in prod); keep strict CSP for API JSON regardless of docs
- [ ] A8-08 (Med) trustProxy: prefer CIDR; never expose `3333` with permissive trustProxy in default compose; doc
- [ ] A8-09 (Med) container hardening: `no-new-privileges`, `cap_drop: ALL`, `read_only`+tmpfs where feasible, `USER ouitransfer` in server-runner; eliminate root window
- [ ] A8-10 (Med) pin image tags to immutable versions/digests (Renovate-managed)
- [ ] A8-11 (Med→Low) minimal unauth liveness; move per-subsystem health detail behind admin
- [ ] A8-13 (Low) HSTS `preload`
- [ ] A8-15 (Low) Renovate: exclude security-critical deps from automerge
- [ ] A8-12 (Low) moot after X-Real-IP fix; normalize stored IPs

---

## Exec order (sequential — one implementer agent at a time, Opus)
R1 → R2 → R3 → R4 → R5 → R6 → R7. Critical-bearing batches (R1, R2, R3, R4, R7) first
where dependencies allow. Each batch: implement ALL its items, extend tests, run
`pnpm --filter <pkg> type-check` + `test`, commit atomically.
