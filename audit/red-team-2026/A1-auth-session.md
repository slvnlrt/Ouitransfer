# Red Team Report — A1: Authentication & Session Management

## Summary

I traced every authentication flow end-to-end (password login, 2FA challenge/verify/setup/disable, refresh-token rotation, logout, password reset, trusted devices, OIDC cookie issuance) against the Fastify/Prisma server. The core design is above average for a self-hosted product: refresh tokens are random (not JWTs), rotated with replay-chain revocation, reset tokens are SHA-256 hashed and single-use, `tokenVersion` provides global revocation, and the 2FA-challenge step is a signed server token (not a raw `userId`). However, several real weaknesses exist. The most serious is that **account lockout and rate-limiting are both trivially bypassable via client-controlled proxy headers** (`x-real-ip`, `x-user-agent`), which collapses the entire brute-force/credential-stuffing defense when `TRUST_PROXY` is misconfigured or attacker-reachable. Other notable issues: the standalone `/auth/2fa/verify` endpoint has **no lockout integration** (TD-3 confirmed and broader than documented), trusted devices are keyed on a spoofable `userAgent+IP` SHA-256 hash with **no per-user salt and a cross-user `@unique` collision footgun**, the 2FA TOTP window allows **replay within the ±30s window**, and there is a **user-enumeration oracle** in the forgot-password flow when password auth is disabled.

**Finding counts:** Critical: 1 · High: 4 · Medium: 5 · Low: 4 · Info: 3

---

## Findings

### [Critical] Account lockout and rate-limiting bypassable via client-controlled `x-real-ip` / `x-user-agent` headers

- **ID**: A1-01
- **Severity**: Critical
- **Location**: `apps/server/src/utils/auth-cookies.ts:94-105`; `apps/server/src/app.ts:150-160`; `apps/server/src/utils/parse-trust-proxy.ts:11-18`
- **OWASP**: A07 Identification & Authentication Failures
- **Description**: `getClientInfo()` derives the client IP from the `x-real-ip` header (and the user-agent from `x-user-agent`) *before* falling back to `request.ip`. These values feed audit logs **and** the trusted-device hash. Separately, the global rate limiter keys on `request.ip` (`keyGenerator: (request) => request.ip`), which is itself derived from `X-Forwarded-For` whenever the request arrives from a trusted-proxy hop. `TRUST_PROXY` defaults to `loopback`, but in the standard 3-container Docker / reverse-proxy deployment the app sits behind Traefik/nginx and operators routinely set `TRUST_PROXY=true` or a CIDR. The lockout is *email-only* (good against IP rotation), but the **rate limiter is the only IP-based throttle** and it trusts forwarded headers; an attacker who can reach the server with a trusted proxy hop (or with `TRUST_PROXY=true`) rotates `X-Forwarded-For` per request to defeat the 5-req/min login limit entirely.
- **Attack scenario**:
  1. Deployment sets `TRUST_PROXY=true` (common copy-paste; the env schema accepts it silently).
  2. Attacker sends `POST /auth/login` with a fresh `X-Forwarded-For: 1.2.3.<n>` on each request. `request.ip` becomes the spoofed value, so each request lands in a distinct rate-limit bucket → the 5/min cap never trips.
  3. Email-only lockout still caps at 10 failures *per target email* in 15 min, but for **credential stuffing across many accounts** (one guess per email) there is no per-IP brake at all → unlimited stuffing throughput.
  4. Bonus: arbitrary `x-user-agent` + spoofed IP also lets an attacker forge/duplicate trusted-device hashes (see A1-04).
- **Evidence**:
```ts
// auth-cookies.ts:98-103
const realIP = headerString(request.headers["x-real-ip"]);
const realUserAgent = headerString(request.headers["x-user-agent"]);
const userAgent = realUserAgent || headerString(request.headers["user-agent"]) || "";
const ipAddress = realIP || request.ip || request.socket.remoteAddress || "";
// app.ts:154
keyGenerator: (request) => request.ip,
```
- **Remediation**: Do not read `x-real-ip` / `x-user-agent` directly. Rely solely on Fastify's `request.ip`, which already honors the validated `trustProxy` configuration and only trusts `X-Forwarded-For` from configured proxy CIDRs. Document that `TRUST_PROXY=true` is dangerous and prefer an explicit proxy CIDR. Add a per-IP failed-login throttle in addition to the email-only lockout, and ensure the rate-limit key cannot be influenced by untrusted forwarded headers.

---

### [High] `/auth/2fa/verify` has no account-lockout integration — unlimited TOTP/backup-code brute force (TD-3 confirmed & broader)

- **ID**: A1-02
- **Severity**: High
- **Location**: `apps/server/src/modules/two-factor/routes.ts:119-156`; `apps/server/src/modules/two-factor/service.ts:113-172`
- **OWASP**: A07 Identification & Authentication Failures
- **Description**: The login-path 2FA (`POST /auth/2fa/login`) routes through `completeTwoFactorLogin`, which *does* call `isAccountLocked` / `recordLoginAttempt`. But the **standalone** `POST /auth/2fa/verify` endpoint (used post-login for step-up/verification) calls `twoFactorService.verifyToken` directly with **no `recordLoginAttempt`, no `isAccountLocked`, and no `tokenVersion`/challenge gating** — only a 5/min rate limit (which is itself defeatable per A1-01). TD-3 in TECHNICAL-DEBT.md notes a "2FA brute-force gap"; this is it, and it is exploitable. A 6-digit TOTP has 10^6 space; with the ±1 window (~3 valid codes per 30s) and bypassable rate limiting, online brute force is feasible. Backup codes are only 32-bit (`crypto.randomBytes(4)`, A1-07), making them far weaker.
- **Attack scenario**: Attacker who already holds a valid access token (e.g. session-riding, or a low-value account they own) hammers `/auth/2fa/verify`. With the rate limit bypassed (A1-01) and no lockout, they brute the TOTP or, worse, the 4-byte backup codes for their own account — but more importantly, the missing lockout means failed 2FA attempts here are never counted toward the lockout that the *login* path relies on, creating an inconsistent security boundary.
- **Evidence**:
```ts
// two-factor/routes.ts:146-154 — handler for /2fa/verify
const result = await twoFactorService.verifyToken(userId, request.body.token);
return reply.send(result);   // no recordLoginAttempt, no lockout check
```
- **Remediation**: Route all 2FA verification through the same lockout accounting as login (`isAccountLocked` pre-check + `recordLoginAttempt` on success/failure), keyed on the user's email. Apply a dedicated, low 2FA-failure counter that triggers temporary lock. Verify whether `/auth/2fa/verify` is even needed; if it is only a leftover, remove it.

---

### [High] TOTP replay window — a captured code is valid for ~90 seconds and is not consumed

- **ID**: A1-03
- **Severity**: High
- **Location**: `apps/server/src/modules/two-factor/service.ts:132-143` (and identical logic at `:76-83`, `:219-226`)
- **OWASP**: A07 Identification & Authentication Failures
- **Description**: `verifyToken` validates the TOTP with `window: 1` (accepts the previous, current, and next 30s steps → up to 90s of validity) and **does not record the last-used TOTP step**. The same code can be replayed multiple times within its validity window. RFC 6238 §5.2 explicitly requires rejecting a previously accepted OTP within the same step. There is no `lastTotpStep` column on `User`.
- **Attack scenario**: Attacker observes a victim's just-entered 6-digit code (shoulder-surf, phishing relay, MITM of a non-TLS dev deployment, or a malicious browser extension capturing the form). Within ~90s the attacker replays the identical code at `/auth/2fa/login` (with a valid challenge token from a parallel password attempt) and completes login. Because nothing marks the step consumed, the legitimate user's own subsequent submission is unaffected, so the victim sees no anomaly.
- **Evidence**:
```ts
const verified = loginTotp.validate({ token: normalizedToken, window: 1 }) !== null;
if (verified) { return { success: true, method: "totp" as const }; }   // no step recorded
```
- **Remediation**: Persist the last successfully used TOTP counter/step per user and reject re-use of that step (and earlier). Consider reducing `window` to 0 or keeping 1 only with replay tracking.

---

### [High] Trusted-device hash is spoofable, unsalted, and cross-user collidable (`deviceHash @unique`)

- **ID**: A1-04
- **Severity**: High
- **Location**: `apps/server/src/modules/auth/trusted-device.service.ts:6-9, 37-57`; `apps/server/prisma/schema.prisma:458-472` (`deviceHash String @unique`)
- **OWASP**: A07 Identification & Authentication Failures / A02 Cryptographic Failures
- **Description**: A "trusted device" is identified solely by `sha256(userAgent + "-" + ipAddress)` with **no per-user salt and no random device secret**. Two problems:
  1. **Bypass of 2FA**: both `userAgent` and `ipAddress` are fully attacker-controllable (the UA always; the IP via `x-real-ip` per A1-01). An attacker who learns/guesses a victim's UA + IP (or who shares a NAT egress IP and a common UA string) produces a colliding `deviceHash` and skips 2FA entirely at login (`service.ts:79-89`).
  2. **`deviceHash @unique` is global, not per-user**. `addTrustedDevice` upserts on `where: { deviceHash }`. If user A and user B ever produce the same UA+IP hash (same office NAT + same browser version — very common), the upsert **overwrites the existing row's `userId`**, silently transferring/clobbering another user's trusted-device record. This is a correctness *and* security defect: trust can be reassigned across accounts.
- **Attack scenario**: Corporate network, all users behind one egress IP, all on the same managed Chrome build → identical UA+IP → identical `deviceHash`. User B enabling "remember this device" upserts over User A's row (changing `userId`). Conversely, if A already has a trusted device, B logging in from the same UA+IP is treated as trusted and **bypasses 2FA** because `isDeviceTrusted` matches on `(userId, deviceHash)` — wait, it does scope the *read* by `userId`, but the upsert's `@unique` on `deviceHash` alone means only one row can exist for that hash, so the second user's create silently mutates the first user's row. Either the second user can't get their own row, or the read for the original user now fails — an availability/trust-integrity break, and with UA spoofing an attacker can deliberately craft a victim's hash.
- **Evidence**:
```ts
private generateDeviceHash(userAgent: string, ipAddress: string): string {
  const deviceInfo = `${userAgent}-${ipAddress}`;
  return crypto.createHash("sha256").update(deviceInfo).digest("hex");   // no salt, no per-user component
}
// upsert keyed on deviceHash only:
await prisma.trustedDevice.upsert({ where: { deviceHash }, ... });
```
```prisma
deviceHash String @unique   // global uniqueness → cross-user collision
```
- **Remediation**: Generate a random, server-issued device secret stored in a dedicated httpOnly cookie; key trust on `hash(secret)` (or on `(userId, randomDeviceId)`), never on attacker-controlled UA/IP. Change the schema to `@@unique([userId, deviceHash])` instead of a global `@unique`, and stop deriving identity from spoofable client fields.

---

### [High] Self-service 2FA setup (`/2fa/verify-setup`) requires only an access token — no password/step-up re-auth

- **ID**: A1-05
- **Severity**: High
- **Location**: `apps/server/src/modules/two-factor/routes.ts:71-117`; `apps/server/src/modules/two-factor/service.ts:62-108`
- **OWASP**: A07 Identification & Authentication Failures
- **Description**: Enabling 2FA (which sets the secret and issues backup codes) requires only a valid JWT (`preValidation`). Unlike *disabling* 2FA (which correctly requires password + TOTP, `service.ts:179-265`), *enabling* it has no re-authentication. An attacker who hijacks an active session (XSS-stolen cookie is httpOnly-protected, but session-fixation/CSRF-adjacent or a borrowed unlocked device) can enroll their **own** authenticator as the victim's 2FA, then download backup codes — converting a transient session into durable account takeover that survives the victim's password reset only if the attacker also controls reset, but it locks the victim out and grants the attacker the second factor.
- **Attack scenario**: Attacker gets momentary authenticated access (shared computer, session token leak via a sibling vuln). They call `/2fa/setup` then `/2fa/verify-setup` with their own TOTP, enabling 2FA bound to the attacker's device. `verifySetup` then calls `incrementTokenVersion` (service.ts:102), invalidating the victim's other sessions — locking the victim out while the attacker holds the second factor.
- **Evidence**:
```ts
// routes.ts:99-103 — only userId from JWT, no password/step-up
const result = await twoFactorService.verifySetup(userId, request.body.token, request.body.secret);
```
- **Remediation**: Require recent re-authentication (password and/or current session step-up) to enable 2FA and to regenerate backup codes, mirroring the protection already on `disable2FA`.

---

### [Medium] User enumeration via forgot-password when password auth is disabled

- **ID**: A1-06
- **Severity**: Medium
- **Location**: `apps/server/src/modules/auth/service.ts:164-211`
- **OWASP**: A07 Identification & Authentication Failures
- **Description**: `requestPasswordReset` is carefully written to NOT throw on email-send failure (preserving the no-enumeration contract). But when `passwordAuthEnabled === "false"` and the email **belongs to an existing non-LDAP user**, it throws `ForbiddenError` ("Password reset is not available"). For a non-existent email it returns silently (the early `if (!user) return;` at :168-169). This is a direct enumeration oracle in that configuration: 403 = registered local user, 200 = unregistered (or LDAP). The same `ForbiddenError` branch exists in `resetPassword` (:236-243).
- **Attack scenario**: With external-auth-only deployments (passwordAuth disabled — a documented mode), attacker submits candidate emails to `/auth/forgot-password`; a 403 confirms a registered local account, a 200 means not registered.
- **Evidence**:
```ts
const isLdapUser = !!user.ldapDn;
if (!isLdapUser) {
  const passwordAuthEnabled = await getConfigValue("passwordAuthEnabled");
  if (passwordAuthEnabled === "false") {
    throw new ForbiddenError("Password authentication is disabled. ...");  // distinguishes existing user
  }
}
```
- **Remediation**: When password auth is disabled, still return the generic 200 "if an account exists…" response for non-LDAP users instead of throwing — do not branch the response on user existence. Move the disabled-auth check before the user lookup, or suppress the difference.

---

### [Medium] Backup codes have only ~32 bits of entropy (and the "64-bit" comment is wrong)

- **ID**: A1-07
- **Severity**: Medium
- **Location**: `apps/server/src/modules/two-factor/service.ts:330-342`; misleading comment at `:147-152`
- **OWASP**: A02 Cryptographic Failures
- **Description**: Backup codes are `crypto.randomBytes(4)` = 4 bytes = **32 bits** of entropy, formatted as 8 hex chars (`XXXX-XXXX`). The code comment at line 150 claims they are "high-entropy (64-bit random)" — that is false; they are 32-bit. Combined with the missing 2FA-verify lockout (A1-02) and bypassable rate limiting (A1-01), 2^32 is within reach of a sustained online attack against a determined target (and trivially offline if the JSON store ever leaks — they are stored in plaintext, see A1-08).
- **Evidence**:
```ts
const code = crypto.randomBytes(4).toString("hex").toUpperCase();   // 32 bits, not 64
// comment falsely states: "backup codes are high-entropy (64-bit random)"
```
- **Remediation**: Use at least `crypto.randomBytes(10)` (80 bits) per code. Correct the comment.

---

### [Medium] Backup codes stored in plaintext in the DB

- **ID**: A1-08
- **Severity**: Medium
- **Location**: `apps/server/src/modules/two-factor/service.ts:91-99, 145-168`; `apps/server/prisma/schema.prisma:26` (`twoFactorBackupCodes String?`)
- **OWASP**: A02 Cryptographic Failures
- **Description**: Backup codes are stored as a plaintext JSON array (`twoFactorBackupCodes`). The TOTP secret (`twoFactorSecret`) is likewise stored unencrypted. Any DB read (SQL injection elsewhere, backup leak, file exfiltration of the SQLite file) yields working second factors for every user. Reset tokens and refresh tokens are handled better (reset is hashed; refresh is random and revocable), so the 2FA secret/backup-code plaintext is the weak link. Note `ENCRYPTION_SECRET` exists in env and is used to encrypt the LDAP bind password (schema:551) but is not applied to 2FA material.
- **Evidence**:
```prisma
twoFactorSecret      String?
twoFactorBackupCodes String?   // plaintext JSON
```
- **Remediation**: Hash backup codes (bcrypt/argon2 or HMAC with `ENCRYPTION_SECRET`) and compare hashes; encrypt `twoFactorSecret` at rest with `ENCRYPTION_SECRET` (AES-256-GCM, same as the LDAP bind password).

---

### [Medium] No password complexity policy and a low default minimum (8); reset path doesn't revoke trusted devices

- **ID**: A1-09
- **Severity**: Medium
- **Location**: `apps/server/src/modules/auth/dto.ts:5-11, 27-35`; `apps/server/src/db/seed-data.ts:86-90` (`passwordMinLength=8`); `apps/server/src/modules/auth/service.ts:213-267`
- **OWASP**: A07 Identification & Authentication Failures
- **Description**: The only password rule anywhere is a configurable minimum length defaulting to **8**, enforced both in the Zod schema and `validatePasswordMiddleware`. There is no check for complexity, no breached-password (HIBP) screening, and no maximum-length guard before bcrypt (bcrypt silently truncates input at 72 bytes — `bcryptjs` here — so a >72-byte password is partially ignored; combined with no max-length validation this is a subtle weakness). Separately, on password reset, `resetPassword` revokes refresh tokens and bumps `tokenVersion` (good) but does **not** revoke trusted devices, so a previously-trusted attacker device still bypasses 2FA after the victim resets their password.
- **Evidence**:
```ts
return z.string().min(minLength, `Password must be at least ${minLength} characters`); // no complexity, no max
```
```ts
// resetPassword: bumps tokenVersion + revokes refresh tokens, but never touches trustedDevice rows
invalidateTokenVersionCache(resetRequest.userId);
await revokeAllUserTokens(resetRequest.userId);
```
- **Remediation**: Enforce a higher default minimum (12+), add a max-length (≤72 bytes for bcrypt) and complexity/HIBP checks. On password reset (and on 2FA disable), also delete the user's trusted devices.

---

### [Medium] Login does not gate inactive accounts before bcrypt; `recordLoginAttempt` failures swallowed; timing oracle on user existence

- **ID**: A1-10
- **Severity**: Medium
- **Location**: `apps/server/src/modules/auth/service.ts:52-73`
- **OWASP**: A07 Identification & Authentication Failures
- **Description**: Two subtler order-of-checks issues:
  1. **Timing/user-existence oracle**: when the user does not exist, `login` returns immediately after `recordLoginAttempt` without performing a bcrypt comparison (`:52-56`). When the user exists with a wrong password it runs a full bcrypt compare (`:68`). The measurable latency difference (bcrypt cost) lets an attacker distinguish "email exists" from "email does not exist" despite both returning the same "Invalid credentials" message. (The lockout pre-check at :42 runs for both, partially masking this, but the bcrypt delay is still observable.)
  2. The `isActive`/`!user.password` branches (`:58-66`) throw *distinct* errors ("Account is inactive", "external authentication") **after** confirming the user exists but *before* password verification — another enumeration vector: an attacker learns an email is a valid, inactive, or OIDC-only account without knowing the password.
- **Evidence**:
```ts
const user = await this.userRepository.findUserByEmailOrUsername(...);
if (!user) { await recordLoginAttempt(...); throw new UnauthorizedError("Invalid credentials"); } // no bcrypt → faster
if (!user.isActive) { throw new ForbiddenError("Account is inactive..."); }     // distinct error pre-password
if (!user.password) { throw new ForbiddenError("This account uses external..."); }
const isValid = await bcrypt.compare(...);   // only reached for existing local users
```
- **Remediation**: Perform a dummy bcrypt comparison against a fixed hash when the user is absent (constant-time user-existence masking). Defer the `isActive` / external-auth checks until *after* password verification, or return the generic "Invalid credentials" for all pre-password failures.

---

### [Low] Challenge-token secret is process-ephemeral and not bound to the password step beyond userId

- **ID**: A1-11
- **Severity**: Low
- **Location**: `apps/server/src/modules/auth/challenge.ts:9-37`
- **OWASP**: A02 Cryptographic Failures
- **Description**: The 2FA challenge HMAC secret is generated per-process (`crypto.randomBytes(32)` at module load). In a multi-instance/clustered deployment, a challenge minted by instance A cannot be verified by instance B (HS256 secret differs), breaking 2FA login behind a load balancer — and conversely, a restart invalidates in-flight challenges (acceptable). More importantly, the challenge embeds only `userId` + `purpose`; it does not bind the IP/UA or the specific password-verification event, so a leaked challenge token (5-min TTL) is usable from anywhere to attempt 2FA for that user. This is a defense-in-depth gap rather than a direct bypass (still needs a valid TOTP).
- **Evidence**:
```ts
const CHALLENGE_SECRET = new TextEncoder().encode(crypto.randomBytes(32).toString("hex"));
return new jose.SignJWT({ userId, purpose: "2fa-challenge" }) ... .setExpirationTime("5m").sign(CHALLENGE_SECRET);
```
- **Remediation**: Derive the challenge secret from a stable env value (e.g. HKDF over `JWT_SECRET` with a distinct label) so it is consistent across instances; optionally bind IP/UA into the token claims.

---

### [Low] Logout token revocation is fire-and-forget and silently best-effort

- **ID**: A1-12
- **Severity**: Low
- **Location**: `apps/server/src/modules/auth/routes.ts:245-277`
- **OWASP**: A07 Identification & Authentication Failures
- **Description**: On logout, `revokeAllUserTokens(userId)` is invoked **without `await`** and only logs on error. If the DB write fails, the response still says "Logout successful" while refresh tokens remain valid for 7 days. Also, logout does not bump `tokenVersion`, so the **current access token remains valid until its 15-min `exp`** even after logout (cookie cleared client-side, but a copy of the JWT keeps working). For shared-device logout this is a real window.
- **Evidence**:
```ts
clearAuthCookies(reply);
if (userId) {
  revokeAllUserTokens(userId).catch((err) => getLogger().error(...));  // not awaited
}
```
- **Remediation**: `await` the revocation and surface failures; consider bumping `tokenVersion` on logout if immediate access-token invalidation is desired (trade-off: logs out all sessions).

---

### [Low] Access-token cookie uses `sameSite: "lax"` in HTTPS and is path `/` — CSRF surface for any future GET-side-effect routes

- **ID**: A1-13
- **Severity**: Low
- **Location**: `apps/server/src/utils/auth-cookies.ts:42-65`
- **OWASP**: A07 / A01
- **Description**: In secure deployments the access-token cookie is `sameSite: "lax"`, justified for OIDC top-level redirects. CSRF is mitigated by the double-submit token, and login/refresh are CSRF-exempt by design — but the refresh cookie is also `sameSite: "lax"` and the refresh endpoint is CSRF-exempt, so a top-level navigation/`form` POST to `/api/auth/refresh` (lax allows it on navigations… though refresh is POST and lax does not send cookies on cross-site POST, only on top-level GET navigation) is the relevant nuance. This is low risk given POST + lax, but the combination of CSRF-exempt + lax + httpOnly should be reviewed if any state-changing GET is ever added.
- **Evidence**:
```ts
sameSite: isSecure ? "lax" : "strict",   // access token, path "/"
// refresh: sameSite: "lax", csrf-exempt
```
- **Remediation**: Prefer `sameSite: "strict"` for the refresh cookie (it is only sent to `/api/auth/refresh`, never needed cross-site). Keep auditing that no GET route performs mutations.

---

### [Low] Refresh-token cookie path (`/api/auth/refresh`) vs. server route (`/auth/refresh`) mismatch relies entirely on the proxy rewrite

- **ID**: A1-14
- **Severity**: Low
- **Location**: `apps/server/src/config/auth.config.ts:17`; `apps/server/src/modules/auth/routes.ts:582-621`; `apps/server/src/server.ts:90`
- **OWASP**: A05 (config) / A07
- **Description**: The refresh cookie is scoped to path `/api/auth/refresh`, but the Fastify route is registered at `/auth/refresh` (no `/api` prefix). This works only because the web layer proxies `/api/*` to the server. If the server is ever exposed directly (or the proxy prefix changes), the browser will not send the refresh cookie to the real endpoint (refresh silently fails) — or, if a different path is reachable, the narrow scoping is lost. Also, `CSRF_EXEMPT_ROUTES` lists `/auth/refresh` and `/auth/login` (server-relative), confirming the server sees un-prefixed paths; the cookie path is the odd one out. This is fragile coupling rather than an exploitable hole today.
- **Remediation**: Make the cookie path and the route path consistent (either prefix the route with `/api` or scope the cookie to `/auth/refresh`), and document the proxy contract explicitly.

---

### [Info] `removeAdditional: "all"` (AJV) does not apply to Zod-validated routes

- **ID**: A1-15
- **Severity**: Info
- **Location**: `apps/server/src/app.ts:29-33`
- **Description**: The AJV `removeAdditional: "all"` option only affects AJV-compiled schemas. These routes use `@fastify/type-provider-zod`, so request bodies are validated/stripped by Zod, not AJV. Not a vulnerability, but the AJV setting is dead config for auth routes — worth noting so reviewers don't assume AJV-level stripping protects auth payloads.

---

### [Info] Audit logs and reset-request logs record raw email (PII) and could aid enumeration via log access

- **ID**: A1-16
- **Severity**: Info
- **Location**: `apps/server/src/modules/auth/routes.ts:311-316`; `login-attempts.service.ts:100-104`
- **Description**: `PASSWORD_RESET_REQUEST` audit events store the submitted email in metadata regardless of whether the account exists, and lockout audit metadata includes the email. Anyone with audit-log read access can enumerate which emails were targeted (not which exist, but still PII). Defense-in-depth observation only.

---

### [Info] bcrypt cost factor hardcoded to 10

- **ID**: A1-17
- **Severity**: Info
- **Location**: `apps/server/src/modules/auth/service.ts:245` (`bcrypt.hash(newPassword, 10)`) and registration paths
- **Description**: Cost 10 is the bcryptjs default and acceptable today, but `bcryptjs` (pure-JS) is ~3-5x slower than native bcrypt, so cost 10 in JS is roughly equivalent work to a lower native cost. Consider cost 12 and/or migrating to argon2id. Informational.

---

## Tested-and-OK (controls verified solid)

- **Password reset tokens**: 256-bit random (`crypto.randomBytes(32)`), **SHA-256 hashed at rest** (`hashToken`), single-use (`used` flag flipped in a transaction), and expiry-checked (`expiresAt gt now`). No host-header poisoning — reset URL is built from the server-configured `appUrl`, never from request headers (`url-builder.ts:80-83`). (`service.ts:182-267`)
- **Reset side effects**: password change atomically bumps `tokenVersion` and revokes all refresh tokens, invalidating existing sessions (`service.ts:247-264`). (Trusted-device revocation gap noted in A1-09.)
- **Refresh-token rotation**: tokens are opaque 256-bit random (not JWTs), rotated on every use with a conditional `updateMany` (`where: { id, revokedAt: null }`) that closes the TOCTOU race; replay of a revoked token triggers full-chain revocation (`refresh-token.service.ts:42-122`).
- **tokenVersion global revocation**: enforced on every `jwtVerify` via the `trusted` callback with a 30s cache and explicit invalidation hooks; legacy tokens missing the claim are rejected (`token-version.ts:22-59`, `app.ts:176`).
- **2FA challenge step**: login does not trust a raw `userId` from the client — it issues a signed, 5-min, purpose-scoped challenge token verified server-side before 2FA (`routes.ts:118-124, 185-186`; `challenge.ts`). (Secret-portability caveat in A1-11.)
- **Disable-2FA**: correctly requires password **and** TOTP/backup code, preventing password-only 2FA removal (`service.ts:179-265`). (Enable path is the asymmetry — A1-05.)
- **JWT/cookie secret hygiene**: `JWT_SECRET`, `CSRF_SECRET`, `COOKIE_SECRET` each enforced ≥32 chars and required to be mutually distinct via Zod refinements; fails fast at boot (`env.ts:26-62`). Access-token cookie is `signed: true` (HMAC via `@fastify/cookie`) and httpOnly. JWT alg is fixed HS256 via `@fastify/jwt` (no alg-confusion / no `none`).
- **Constant-time comparisons**: backup-code and token comparisons use `crypto.timingSafeEqual` with a length pre-check (`timing-safe.ts`); reset-token lookup compares hashes via DB equality on the SHA-256 hash (acceptable since the stored value is itself a hash, not the secret).
- **Lockout rolling-window prevention**: `recordLoginAttempt` skips recording while already locked, preventing indefinite lockout extension; email-only lockout resists IP-rotation for single-account attacks (`login-attempts.service.ts:27-114`). (IP-throttle gap is A1-01.)
- **Randomness**: all security tokens use `crypto.randomBytes` — no `Math.random` anywhere in the auth surface.
- **Prototype-poisoning hardening**: `onProtoPoisoning: "error"` / `onConstructorPoisoning: "error"` set on the Fastify instance (`app.ts:46-47`).
