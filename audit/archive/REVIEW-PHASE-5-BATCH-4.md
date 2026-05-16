# Phase 5 Batch 4 Review — Tasks 8 & 9

**Reviewer:** claude-opus-4-6 (independent review)
**Date:** 2026-05-11
**Server tests:** 145/145 ✅ | **Web tests:** 185/185 ✅ | **Server type-check:** ✅ | **Web type-check:** ✅

---

## Task 8: Token Rotation + Account Lockout (5.23, 5.25)

### 5.23 — Token Rotation on Privilege Escalation

| Step | Spec Requirement | Status | Notes |
|------|-----------------|--------|-------|
| 8.1 | `tokenVersion Int @default(0)` on User model | ✅ | `schema.prisma:28` |
| 8.2 | Prisma migration | ✅ | `20260511183339_add_token_version_and_login_attempts/migration.sql` |
| 8.3 | `tokenVersion` in JWT payload at ALL jwtSign call sites | ✅ | Login (`auth/controller.ts:63`), 2FA login (`auth/controller.ts:105`), OIDC callback (`auth-providers/controller.ts:349`), refresh (`auth/routes.ts:383`) |
| 8.4 | Validate tokenVersion on every authenticated request | ✅ | `@fastify/jwt` `trusted` callback in `app.ts:143` → `validateTokenVersion()`. 30s TTL in-memory cache. |
| 8.5 | Increment tokenVersion after privilege-changing operations | ✅ | Password reset (`auth/service.ts:206` — inline in transaction), 2FA enable (`two-factor/service.ts:102`), 2FA disable (`two-factor/service.ts:256`), admin password change (`user/service.ts:78`) |
| 8.6 | Tests for token rotation | ✅ | `token-rotation.test.ts` — 7 tests covering cache, invalidation, increment, reject legacy tokens |

**Verdict: ✅ PASS**

Implementation is clean and thorough. The `trusted` callback pattern is the right approach — it hooks into every `jwtVerify()` call transparently. Cache invalidation is correct (invalidates on increment, falls through to DB on miss). Legacy tokens without `tokenVersion` are rejected (line 28-29 of token-version.ts). 

### 5.25 — Per-Account Brute-Force Protection

| Step | Spec Requirement | Status | Notes |
|------|-----------------|--------|-------|
| 8.7 | LoginAttempt model (per-email, ipAddress, success, index) | ✅ | `schema.prisma:128-138`, indexes on `[email, createdAt]` and `[createdAt]` |
| 8.8 | `login-attempts.service.ts` with 3 functions | ✅ | `recordLoginAttempt`, `isAccountLocked`, `cleanupOldAttempts` |
| 8.9 | Lockout check BEFORE password verification | ✅ | `auth/service.ts:41-46` — `isAccountLocked` before user lookup |
| 8.10 | Hourly cleanup with onClose hook | ✅ | `server.ts:97-108` (interval) + `server.ts:126` (onClose) |
| 8.11 | Tests for lockout | ✅ | `login-attempts.test.ts` — 7 tests covering recording, threshold, success reset, expiration, email normalization |

**Verdict: ✅ PASS**

Lockout constants (10 attempts, 15 min) match spec. Email normalization to lowercase is a good touch. The `isAccountLocked` function uses consecutive failure counting from most-recent backward, which correctly resets on successful login. Cleanup runs hourly with proper onClose cleanup.

---

## Task 9: Refresh Tokens + Audit Logging (5.26, 5.24)

### 5.26 — Refresh Token Strategy

| Step | Spec Requirement | Status | Notes |
|------|-----------------|--------|-------|
| 9.1 | RefreshToken model | ✅ | `schema.prisma:335-349`. Has token @unique, userId, userAgent, ipAddress, expiresAt, revokedAt, replacedBy. Indexes on userId and expiresAt. |
| 9.2 | Migration | ✅ | `20260511184719_add_refresh_token_and_audit_log/migration.sql` |
| 9.3 | `refresh-token.service.ts` with create/rotate/revoke/cleanup | ✅ | All 4 functions present. Token = `crypto.randomBytes(32).toString("base64url")`. Replay detection revokes entire chain (`revokeAllUserTokens`). |
| 9.4 | JWT `expiresIn` changed from `1d` to `15m` | ✅ | `app.ts:139` |
| 9.5 | `POST /auth/refresh` endpoint (rate-limited 10/min, bodyLimit 64KB) | ✅ | `auth/routes.ts:352-395`. Rate limit 10/min. bodyLimit 64KB. CSRF-exempt (`app.ts:187`). |
| 9.6 | Login + 2FA login return refreshToken in response body | ✅ | `auth/controller.ts:74,84` (login), `auth/controller.ts:116,127` (2FA login) |
| 9.7 | Frontend 401 interceptor with refresh-before-redirect, mutex | ✅ | `web/src/config/api.ts:98-196`. Mutex via `refreshPromise`. `_retry` flag prevents infinite loops. |
| 9.8 | Hourly cleanup for expired refresh tokens | ✅ | `server.ts:112-124` (interval) + `server.ts:127` (onClose) |
| 9.9 | Tests | ⚠️ | Service-level tests exist (6 tests in `refresh-token.test.ts`). **No integration tests with `app.inject()` for `/auth/refresh`.** See finding C-1 below. |

**Verdict: ✅ PASS (with critical findings)**

The core implementation is correct. Token rotation with replay detection is properly implemented in a transaction. The 401 interceptor with mutex is well-structured. However, there are important findings below.

### 5.24 — Audit Logging

| Step | Spec Requirement | Status | Notes |
|------|-----------------|--------|-------|
| 9.10 | AuditLog model | ✅ | `schema.prisma:352-364`. userId nullable, 3 indexes matching spec. |
| 9.11 | `audit/service.ts` with logAuditEvent + getAuditLogs | ✅ | Fire-and-forget via `.catch()` at all call sites. Paginated getAuditLogs with filtering. |
| 9.12 | Audit logging at required events | ✅ | See verification table below. |
| 9.13 | `GET /admin/audit-logs` admin endpoint | ✅ | `audit/routes.ts:28-77`. Admin preValidation. Query params with Zod coercion. |
| 9.14 | Tests | ⚠️ | Service-level tests exist (5 tests in `service.test.ts`). **No integration test for `GET /admin/audit-logs`.** |

**Audit event verification:**

| Required Event | Location | Found |
|---------------|----------|-------|
| Login success | `auth/controller.ts:77-82` | ✅ |
| Login failure | `auth/controller.ts:41-47` | ✅ |
| Logout | `auth/controller.ts:145-150` | ✅ |
| Password change | `user/controller.ts:49-54` | ✅ |
| Password reset | `auth/controller.ts:170-176` | ✅ |
| 2FA enable | `two-factor/controller.ts:82-87` | ✅ |
| 2FA disable | `two-factor/controller.ts:122-127` | ✅ |
| Admin config change | `app/controller.ts:42-48` + `app/controller.ts:58-64` | ✅ |
| User create | `user/controller.ts:20-26` | ✅ |
| User delete | `user/controller.ts:77-83` | ✅ |
| Account lockout | `login-attempts.service.ts:53-57` | ✅ |

All 11 audit actions from the spec are present. ✅

**Verdict: ✅ PASS (with findings)**

---

## Findings

### Critical

#### C-1: OIDC users have no refresh token — 15-minute hard session limit
**Severity: CRITICAL**
**Files:** `apps/server/src/modules/auth-providers/controller.ts:317-363`

The spec (Step 9.6) says "Login + 2FA login return refreshToken in response body." The OIDC callback flow (`auth-providers/controller.ts` `callback()`) sets a JWT cookie and redirects, but **never creates a refresh token**. Since JWT `expiresIn` was reduced from `1d` to `15m`, OIDC users will be silently logged out after 15 minutes with no way to renew their session.

The fix: After the `jwtSign` call (line 346), create a refresh token via `createRefreshToken(result.user.id, ...)` and either:
- Include it as a URL parameter in the redirect (not ideal — URL leakage risk)
- Store it in a second httpOnly cookie (e.g., `refresh_token`)
- Redirect to an intermediate frontend page that receives the token via a short-lived mechanism

The simplest approach: store the refresh token in a second httpOnly cookie that the frontend's refresh interceptor reads on page load and stores in memory.

#### C-2: No integration tests for security-critical new endpoints
**Severity: CRITICAL**
**Files:** Missing integration tests for `POST /auth/refresh`, `GET /admin/audit-logs`

Per CLAUDE.md Rule 11: "For security-critical flows, always add at least one integration test using `app.inject()` that exercises the full request lifecycle." The `/auth/refresh` endpoint is the entire session renewal mechanism — it must be tested end-to-end to verify:
- Route registration works
- Body schema validation (Zod strips unknown fields — Rule 10)
- Rate limiting (10/min)
- CSRF exemption
- Cookie setting on refresh
- 401 on invalid/expired/replayed tokens

Similarly, `GET /admin/audit-logs` should have an integration test verifying admin-only access.

### Important

#### I-1: Frontend 401 interceptor refresh flow has no tests
**Severity: IMPORTANT**
**Files:** `apps/web/src/__tests__/api-interceptor.test.ts`

The existing 401 interceptor tests (from Phase 4) only test the direct-redirect behavior. The new refresh-before-redirect flow (`attemptTokenRefresh`, mutex via `refreshPromise`, `_retry` flag, retry of original request) has **zero test coverage**. This is the most complex piece of the frontend implementation and the most likely to have edge-case bugs (e.g., concurrent 401s during refresh, failed refresh followed by redirect, stale closure over `refreshTokenValue`).

Required tests:
- 401 → successful refresh → retry succeeds
- 401 → failed refresh → redirect to login
- Concurrent 401s → only one refresh attempt (mutex)
- Refresh endpoint itself returns 401 → no infinite loop

#### I-2: OIDC cookie `maxAge` unit mismatch (pre-existing, now worse)
**Severity: IMPORTANT**  
**Files:** `apps/server/src/modules/auth-providers/controller.ts:18,98-106`

`COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000` is in milliseconds, but `@fastify/cookie`'s `maxAge` option expects **seconds** (per the `cookie` npm package spec). This results in the cookie being set for ~7000 days instead of 7 days. This bug is pre-existing, but now it's more impactful: the cookie persists for years while the JWT inside it expires in 15 minutes.

Fix: `const COOKIE_MAX_AGE = 7 * 24 * 60 * 60;` (remove the `* 1000`).

#### I-3: Refresh token not revoked on logout
**Severity: IMPORTANT**
**Files:** `apps/server/src/modules/auth/controller.ts:130-153`

The `logout` method clears the access token cookie but does not revoke the user's refresh tokens. An attacker who obtained a refresh token can continue using it to get new access tokens even after the user explicitly logs out. The logout handler should call `revokeAllUserTokens(userId)` when a valid userId is available.

#### I-4: Audit log `PASSWORD_RESET` lacks userId
**Severity: IMPORTANT**
**Files:** `apps/server/src/modules/auth/controller.ts:170-176`

The password reset audit log is created without a userId:
```typescript
logAuditEvent({
  action: "PASSWORD_RESET",
  ipAddress,
  userAgent,
  // userId is NOT set
});
```

The comment says "userId not easily available here since the reset is token-based." But it IS available — `AuthService.resetPassword` has access to `resetRequest.userId`. Either the service should return it, or the audit event should be logged inside the service where `resetRequest.userId` is known (it's already used for `invalidateTokenVersionCache`).

### Minor

#### M-1: Audit controller types query params as strings despite Zod coercion
**Severity: MINOR**
**Files:** `apps/server/src/modules/audit/controller.ts:7-12`

The audit controller casts query params as:
```typescript
const query = request.query as {
  userId?: string;
  action?: string;
  limit?: string;   // ← already a number after z.coerce.number()
  offset?: string;  // ← already a number after z.coerce.number()
};
```

Then converts them back with `Number()`. This works because `Number(42) === 42`, but the types are incorrect. Should be `limit?: number; offset?: number;`. Better yet, use `z.infer<typeof querystringSchema>` to derive the type from the route schema.

#### M-2: `getAuditLogs` return type is `Record<string, unknown>[]` instead of typed
**Severity: MINOR**
**Files:** `apps/server/src/modules/audit/service.ts:39,55`

```typescript
export async function getAuditLogs(...): Promise<{ logs: Array<Record<string, unknown>>; total: number }>
```

The function returns Prisma AuditLog objects cast to `Record<string, unknown>`. This loses type safety. Should use `AuditLog[]` from Prisma client types.

#### M-3: Cleanup keeps revoked tokens for 24h, but spec says "expired" tokens
**Severity: MINOR**
**Files:** `apps/server/src/modules/auth/refresh-token.service.ts:125-131`

The cleanup function comment says "Revoked tokens within the 24h window are kept for replay detection" — which is a good design choice. But the implementation only checks `expiresAt < cutoff`, not `revokedAt`. A token that was revoked 2 hours ago but doesn't expire for 7 days won't be cleaned up for 8 days. This is benign (more data retained = more replay detection) but inconsistent with the stated intent. Consider adding a secondary condition: `OR (revokedAt IS NOT NULL AND revokedAt < cutoff)`.

#### M-4: Proxy route for `auth/refresh` should set `clientHeaders: true`
**Severity: MINOR**
**Files:** `apps/web/src/lib/proxy-routes.ts:126`

The `auth/refresh` proxy route doesn't forward `X-Real-IP` / `X-User-Agent` headers. While the refresh token service currently preserves the original token's IP/UA for the new token, having the actual client info available would be valuable for future logging or security decisions.

---

## Summary

| Area | Verdict |
|------|---------|
| Task 8 — Token Rotation (5.23) | ✅ Fully compliant |
| Task 8 — Account Lockout (5.25) | ✅ Fully compliant |
| Task 9 — Refresh Tokens (5.26) | ⚠️ Functional for password-login users, **broken for OIDC users** (C-1) |
| Task 9 — Audit Logging (5.24) | ✅ All 11 event types present |
| Tests | ⚠️ Service-level unit tests good; missing integration tests (C-2) and frontend refresh tests (I-1) |
| Type-check | ✅ Clean |

**Overall: The core architecture is sound.** Token rotation via `trusted` callback, refresh token rotation with replay detection, and fire-and-forget audit logging are all well-implemented. The two critical findings (C-1: OIDC refresh gap, C-2: missing integration tests) must be addressed before closing this batch.

---

## Code Quality Review

**Reviewer:** principal-engineer pass (post-fix verification)
**Range:** `7947bf2..b2efdfb` (3 commits, 34 files, +2273/-79)
**Server tests:** 158/158 ✅ | **Web tests:** 190/190 ✅ (verified by running full suites)

This second pass complements the first review by focusing on **what the first review did not catch** and on the fixes added in `b2efdfb`. The OIDC cookie/integration-test gaps are confirmed fixed; the items below are new findings.

### CRITICAL

#### CQ-1: Missing tokenVersion increment on privilege changes (`isAdmin`, `isActive`)
**Severity: CRITICAL** — defeats the whole point of token rotation
**Files:** `apps/server/src/modules/user/service.ts:60-83`, `apps/server/src/modules/user/controller.ts:60-86`

The plan explicitly says "incrementTokenVersion on privilege changes" and the spec covers password change + 2FA toggle. But these are NOT all the privilege changes:

- **`updateUser` increments tokenVersion only when `password` is in the payload.** If an admin demotes another user with `{ id, isAdmin: false }`, the demoted user's existing JWT still carries `isAdmin: true` and `tokenVersion: N`. The `trusted` callback validates tokenVersion only — it does not re-check `isAdmin`. The demoted user retains admin privileges for up to 15 min (access token TTL) and for up to 7 days via refresh (because `revokeAllUserTokens` is also not called). See `user/service.ts:77` — the `if (password)` gate.
- **`deactivateUser` does nothing about sessions.** A user disabled by an admin keeps a valid session for up to 15 min, plus 7-day refresh capability. The `isActive` check in `auth/service.ts:54-56` only fires on a *new* login.
- **`deleteUser` relies on cascade-deletion of refresh tokens and on `validateTokenVersion` returning false when `user` lookup fails.** That part works, but the cache TTL (30 s, `token-version.ts:11`) means a deleted admin's access token could remain valid for up to 30 s after deletion if their userId was recently cached. `deleteUser` should call `invalidateTokenVersionCache(id)` for immediate effect.

**Fix path:**
1. In `UserService.updateUser`, detect changes to `isAdmin` or `isActive` (or simply call `incrementTokenVersion + revokeAllUserTokens` whenever ANY field other than `image` changes — defense in depth).
2. In `UserService.deactivateUser`, call `incrementTokenVersion(id)` + `revokeAllUserTokens(id)`.
3. In `UserService.deleteUser`, call `invalidateTokenVersionCache(id)` after the DB delete (the cascade handles refresh tokens). Note the user row is gone so increment is pointless; cache invalidation is what matters.

The spec sentence "incrementTokenVersion on privilege changes" is satisfied **only for password and 2FA**, not for the two other privilege levers (`isAdmin`, `isActive`). This is the single most impactful gap in the batch.

#### CQ-2: Refresh-token rotation race condition (no atomic revoke-and-replace)
**Severity: CRITICAL** — breaks replay detection under concurrency
**Files:** `apps/server/src/modules/auth/refresh-token.service.ts:42-107`

`rotateRefreshToken` reads, validates, then writes in two steps:

```ts
const oldToken = await prisma.refreshToken.findUnique({ where: { token } });  // read
if (oldToken.revokedAt) { /* replay */ }
// ... checks ...
await prisma.$transaction([
  prisma.refreshToken.update({ where: { id: oldToken.id }, data: { revokedAt: ... } }),  // unconditional update
  prisma.refreshToken.create({ ... }),
]);
```

The update is keyed on `id` alone — it is **not conditional** on `revokedAt IS NULL`. Two concurrent calls with the same valid refresh token both pass the read-side replay check, both proceed to the transaction, and both succeed. Result: **one revocation, two new tokens issued, replay detection silently defeated**.

This is not theoretical: the frontend has a `refreshPromise` mutex (`api.ts:130`) but it is *per browser tab*. Two tabs racing on app load, or an attacker actively trying it, both bypass the protection. The codebase already documented "Refresh token replay detected" telemetry — but the detection only fires on the *third* attempt (after both racers succeed and one tries again with its now-stale revoked token).

**Fix path:** replace the unconditional `update` with a conditional `updateMany`:

```ts
const updated = await prisma.refreshToken.updateMany({
  where: { id: oldToken.id, revokedAt: null },
  data: { revokedAt: new Date(), replacedBy: newTokenValue },
});
if (updated.count === 0) {
  // Someone else rotated first — treat as replay
  await revokeAllUserTokens(oldToken.userId);
  throw new UnauthorizedError("Refresh token reuse detected");
}
// Then create the new token outside the same transaction (or in a follow-up).
```

Note: `prisma.$transaction([a, b])` is *not* SERIALIZABLE on SQLite — it just batches in one connection. The race window is the gap between `findUnique` and `update`, not within the transaction. Hence the need for a conditional write.

#### CQ-3: Login response leaks `refreshToken` as JSON body (XSS-stealable)
**Severity: CRITICAL** — partially negates the httpOnly cookie design used for OIDC
**Files:** `apps/server/src/modules/auth/routes.ts:67,111`, `controller.ts:84,127`; `apps/web/src/app/login/hooks/use-login.ts:143-145,185-187`; `apps/web/src/config/api.ts:17-25,111-113`

Password-login and 2FA-login return `{ user, refreshToken }` as JSON. The frontend stores it in a module-level `refreshTokenValue` and sends it in the body of `/auth/refresh`. OIDC users get an httpOnly cookie instead.

Problems:
1. **XSS exposure.** Any successful XSS can read `refreshTokenValue` (it's in the JS heap, reachable through `setRefreshToken`/`getRefreshToken` exports). The whole reason for the OIDC cookie design is to prevent this — yet password users get the inferior treatment.
2. **UX regression.** In-memory state is wiped on reload. After 15 min + a reload, a password user is forced to re-login. OIDC users stay logged in for 7 days. The product promise of "session persistence" doesn't apply equally.
3. **Inconsistency for callers.** The frontend has to handle two paths (body + cookie). Tests at `api-interceptor.test.ts:290-302` document this.

**Fix path:** issue the refresh token as an httpOnly cookie in `controller.login` and `controller.completeTwoFactorLogin` (same pattern as the OIDC callback at `auth-providers/controller.ts:363-369`). Drop `refreshToken` from the login response body. Update the route response schema accordingly. Drop `setRefreshToken`/`getRefreshToken` from the frontend; the cookie handles it transparently. The integration tests in `auth-refresh.integration.test.ts:94-135` cover both flows; reuse them.

Treat the body-token path as a temporary compatibility shim or delete it outright per CLAUDE.md "No Production, No Legacy".

### IMPORTANT

#### CQ-4: `request.protocol === "https"` in OIDC callback contradicts `env.SECURE_SITE` used everywhere else
**Severity: IMPORTANT**
**Files:** `apps/server/src/modules/auth-providers/controller.ts:354`

```ts
this.setAuthCookie(reply, jwt, request.protocol === "https");
```

vs. every other cookie write in the codebase:

```ts
secure: env.SECURE_SITE === "true",
```

Behind a reverse proxy, `request.protocol` is `"http"` unless trustProxy is configured AND the proxy sends X-Forwarded-Proto. The `parseTrustProxy(env.TRUST_PROXY)` config exists, so this *probably* works in practice — but the two sources of truth for "is this a secure context" can drift. If TRUST_PROXY is misconfigured, OIDC users get insecure cookies while password users get secure cookies. Same env, divergent behavior.

**Fix:** unify on `env.SECURE_SITE === "true"` for all cookie writes. Delete the `request.protocol` heuristic.

#### CQ-5: OIDC access-token cookie sets `maxAge: 7 days` while the JWT inside expires in 15 min
**Severity: IMPORTANT** (correctness, not security-critical)
**Files:** `apps/server/src/modules/auth-providers/controller.ts:20,105`

`COOKIE_MAX_AGE = 7 * 24 * 60 * 60` is applied to the access-token cookie. The JWT inside expires in 15 min. This means:
- The browser keeps sending an expired token for up to 7 days.
- Every authenticated request between 15 min and 7 days fails with 401 → triggers refresh flow.

Not harmful — the refresh flow rescues it — but the password-login flow uses a *session cookie* for `token` (no maxAge), which is the more common pattern and aligns better with the 15-min JWT lifetime. The inconsistency suggests an oversight: the OIDC code likely predates the 15-min JWT change and was not revisited.

**Fix:** make the access-token cookie a session cookie (omit `maxAge`) in OIDC callback. Match the password-login pattern.

#### CQ-6: Login attempts service uses `ipAddress: "unknown"` in audit event
**Severity: IMPORTANT** (audit-trail integrity)
**Files:** `apps/server/src/modules/auth/login-attempts.service.ts:53-57`

```ts
logAuditEvent({
  action: "ACCOUNT_LOCKED",
  ipAddress: "unknown",
  metadata: { email, remainingMinutes: ... },
});
```

`isAccountLocked` doesn't receive `ipAddress`, so it can't audit it. But the caller (`auth/service.ts:41`) has it — pass it through. An audit log entry for "ACCOUNT_LOCKED" with `ipAddress: "unknown"` is a forensics dead-end.

**Fix:** add `ipAddress` to `isAccountLocked`'s signature and forward it to the audit event.

#### CQ-7: Migration would crash on any DB with rows in `login_attempts`
**Severity: IMPORTANT** (developer friction; CLAUDE.md says no production)
**Files:** `apps/server/prisma/migrations/20260511183339_add_token_version_and_login_attempts/migration.sql:22`

```sql
INSERT INTO "new_login_attempts" ("id") SELECT "id" FROM "login_attempts";
```

The new table has `email`, `ipAddress`, `success` declared `NOT NULL` without defaults. Inserting only `id` will fail with a NOT NULL constraint violation. Any developer with existing `login_attempts` rows will see `prisma migrate dev` blow up. The migration warning header even lists this.

Project rules say "no production, no legacy" so the response is "tough luck, reset your dev DB" — but this is the kind of thing that costs a team member an hour. A `DROP TABLE; CREATE TABLE` migration would be honest about being destructive (and just as fast). The current shape pretends to preserve rows but cannot.

**Fix:** rewrite the migration to `DROP TABLE login_attempts; CREATE TABLE ...` with no INSERT step. Or, if you want to be friendly, hand-edit the migration to also accept `email = ''`, `ipAddress = ''`, `success = 0` defaults for the legacy rows.

#### CQ-8: `audit/routes.ts` allows unauthenticated access when `usersCount === 0`
**Severity: IMPORTANT** (questionable bypass pattern)
**Files:** `apps/server/src/modules/audit/routes.ts:11-14`

```ts
const usersCount = await prisma.user.count();
if (usersCount === 0) {
  return;  // bypass auth
}
```

This pattern is copied (presumably) from the registration flow ("first user becomes admin without auth"). But:
1. There is no plausible reason an admin would query audit logs before any user exists — the audit log would be empty.
2. Future migrations or seeders that insert audit rows (telemetry, system events) would leak via this bypass.
3. The integration test at `audit-logs.integration.test.ts:142-151` codifies this behavior, which makes it harder to remove later.

**Fix:** delete the bypass. There is no legitimate use case for unauthenticated audit-log access. If the empty-DB case matters (it doesn't), require authentication anyway and return `{ logs: [], total: 0 }` once the first user exists.

#### CQ-9: Password reset duplicates the increment-and-invalidate pattern instead of using the helper
**Severity: IMPORTANT** (DRY, future-proofing)
**Files:** `apps/server/src/modules/auth/service.ts:202-217`

The transaction inlines `tokenVersion: { increment: 1 }` then calls `invalidateTokenVersionCache` manually. The helper `incrementTokenVersion(userId)` does exactly this, but it's not used here because the increment must be part of the same DB transaction as the password write. Fair reason — but then there's a hidden invariant: "any code that touches `tokenVersion` directly must also call `invalidateTokenVersionCache`". This is a refactor hazard.

**Fix path (one of):**
1. Make `incrementTokenVersion` accept an optional `Prisma.TransactionClient` so it can participate in a transaction.
2. Or: extract the increment into a separate Prisma update call after the password transaction commits (slightly less atomic but `revokeAllUserTokens` is already non-transactional with the password write at line 217, so the atomicity argument is already weak).
3. At minimum: add a comment at line 206 pointing at the cache-invalidation requirement.

### MINOR

#### CQ-10: `body.refreshToken || cookie` uses `||` not `??` — empty string falls through to cookie
**Severity: MINOR** (Zod catches this, but defensive code still wrong)
**Files:** `apps/server/src/modules/auth/routes.ts:382-383`

```ts
const refreshToken = body.refreshToken || (request.cookies as ...).refresh_token;
```

Zod schema requires `refreshToken: z.string().min(1).optional()`, so empty string fails validation before reaching the handler. The `||` is therefore correct *today*. But if someone relaxes `min(1)` later, an empty body field will silently fall back to the cookie — confusing precedence. Use `??` for parity with the documented precedence ("body takes precedence over cookie"), or explicitly check `typeof body.refreshToken === "string" && body.refreshToken.length > 0`.

#### CQ-11: `RefreshToken.replacedBy` is a free-form string, no FK
**Severity: MINOR** (already noted: load-bearing logic doesn't depend on it)
**Files:** `apps/server/prisma/schema.prisma:343`

`replacedBy` stores the new token value (raw secret) rather than the new token's `id`. Two issues:
- It duplicates the secret. The token is `@unique` so you could lookup by token; storing the secret again is unnecessary.
- It's not a FK, so the chain can't be walked structurally.

If you want a chain (you don't, per current code), use `replacedById String?` referencing `RefreshToken.id`. Otherwise drop the column.

#### CQ-12: Cleanup retention doesn't honor "revoked tokens kept for 24h" comment
**Severity: MINOR** (first reviewer flagged a similar issue as M-3, partial overlap)
**Files:** `apps/server/src/modules/auth/refresh-token.service.ts:121-130`

```ts
const result = await prisma.refreshToken.deleteMany({
  where: { expiresAt: { lt: cutoff } },
});
```

The doc says "Revoked tokens within the 24h window are kept for replay detection." But the implementation only filters on `expiresAt`. A token revoked 1 minute ago that expires in 6 days is kept (good for replay detection — but for 6 days, not 24h). A token revoked 6 days ago that expires today is deleted right when its replay-detection value peaks (right after expiry).

The intent is clear; the SQL is not. A simpler shape that matches the intent:

```ts
where: {
  OR: [
    { expiresAt: { lt: cutoff } },
    { AND: [{ revokedAt: { not: null } }, { revokedAt: { lt: cutoff } }] },
  ],
}
```

#### CQ-13: `AuditAction` typed union duplicates the wire format with no enforcement on read
**Severity: MINOR**
**Files:** `apps/server/src/modules/audit/service.ts:5-16`

Writing audit logs is type-safe via `AuditAction`. Reading them returns `string`. The query endpoint accepts `action?: string` with no validation. A typo in a future audit-log call (`"LOGIN_SUCESS"`) compiles fine if cast, and any consumer parsing `action` has no compile-time guarantee. With SQLite enums unavailable, the realistic mitigation is a Zod `z.enum([...])` mirroring `AuditAction` at the route boundary, both for read filtering and for service writes.

#### CQ-14: Audit metadata returned as raw JSON string to the client
**Severity: MINOR** (consumer ergonomics)
**Files:** `apps/server/src/modules/audit/service.ts:31`, `apps/server/src/modules/audit/routes.ts:65`

The admin endpoint returns `metadata: string | null` — the client has to `JSON.parse` it. For an admin-only UI this is workable, but parsing on the server (and exposing `metadata: Record<string, unknown> | null`) is cleaner. The response schema would need to be `z.record(z.unknown()).nullable()` or similar.

#### CQ-15: `LoginAttempt.email` retains case from input; lockout works because writes lowercase, but reads might miss
**Severity: MINOR** (currently safe; tripwire)
**Files:** `apps/server/src/modules/auth/login-attempts.service.ts:17,32`

`recordLoginAttempt` writes `email.toLowerCase()`. `isAccountLocked` also queries with `email.toLowerCase()`. Symmetric — works today. But the schema has no `@db.Citext` or normalization constraint, and any code path that writes without lowercasing (e.g., a future bulk import or an admin script) would silently break lockout for that account. Defensive option: a Prisma middleware that normalizes `email` on `LoginAttempt.create`, or a CHECK constraint via raw migration.

#### CQ-16: Frontend `refreshTokenValue` is a module-level mutable singleton with test backdoor
**Severity: MINOR**
**Files:** `apps/web/src/config/api.ts:17-25,215-220`

The `__resetRedirectingForTest` pattern is well-isolated (guarded by NODE_ENV), but the broader design — a mutable module-level `refreshTokenValue` plus exported `setRefreshToken`/`getRefreshToken` — turns the module into a singleton store. This makes `api.ts` hard to test in isolation (tests need `setRefreshToken(null)` in `beforeEach`, which `api-interceptor.test.ts` does at line 184). If CQ-3 is fixed (cookie-only), this entire scaffold disappears. Track as a follow-up to CQ-3.

#### CQ-17: Integration test mocks `validateTokenVersion` to always return true — defeats the purpose of integration tests
**Severity: MINOR**
**Files:** `apps/server/src/__tests__/auth-refresh.integration.test.ts:28-32`, `audit-logs.integration.test.ts:19-23`

```ts
vi.mock("../modules/auth/token-version.js", () => ({
  validateTokenVersion: vi.fn().mockResolvedValue(true),
  ...
}));
```

Mocking the `trusted` callback means the integration test doesn't exercise the actual tokenVersion check. A regression where the JWT lacks `tokenVersion` would not be caught here. Per CLAUDE.md Rule 11, integration tests exist precisely to catch what unit tests miss. Mocking the security gate makes the integration test partly cosmetic.

**Fix:** stop mocking `validateTokenVersion`. Provide a stub for `prisma.user.findUnique` that returns `{ tokenVersion: <expected> }` so the real callback can run. Tests will then catch JWT-payload-shape regressions for free.

#### CQ-18: `recordLoginAttempt` writes happen even when the account is locked
**Severity: MINOR** (rolling lockout intentional, but worth flagging)
**Files:** `apps/server/src/modules/auth/service.ts:41-72`

`isAccountLocked` runs first; if locked, we throw. But if the credentials happen to be checked anyway (refactor risk), failed attempts continue to fill the table and roll the unlock window forward indefinitely. The current code path correctly short-circuits, but a defensive pattern would be to record failed attempts only when the account is *not already locked*. Discuss before implementing — the rolling-lockout-on-attack behavior may be the intent.

#### CQ-19: `AuditLog.userId` is not a foreign key, but the admin filter accepts any string
**Severity: MINOR**
**Files:** `apps/server/src/modules/audit/routes.ts:38`, `service.ts:43`

`getAuditLogs({ userId: query.userId })` filters by exact string match. An admin querying `?userId=` (empty string) hits `where: { userId: "" }` — empty result, no error. A malformed cuid causes no validation error. Either accept any string and document that the filter is a substring/exact match against the stored userId, or validate against `z.string().cuid().optional()` to make typos explicit.

### Verdict on the fixes from `b2efdfb`

The fix commit successfully closes the C-1 (OIDC refresh) and C-2 (integration tests) findings from the first review. The OIDC refresh-token cookie path (`/api/auth/refresh`) matches the frontend's call site, and `forwardSetCookie` in the proxy passes Set-Cookie through verbatim. Maxage units are correct (seconds). The logout flow now revokes refresh tokens and clears both cookies.

**But the fix pass introduced no new defenses against the issues this review surfaces:** privilege-escalation rotation is still incomplete (CQ-1), the rotation transaction is still racy (CQ-2), and the password-login refresh-token-in-body design is still XSS-stealable (CQ-3). These three are the most consequential findings and were not addressed by either the original implementation or the fix commit.

### Summary by severity

| Severity | Count | IDs |
|---------|-------|-----|
| Critical | 3 | CQ-1 (privilege rotation), CQ-2 (rotation race), CQ-3 (refresh-token in body) |
| Important | 6 | CQ-4 (cookie secure inconsistency), CQ-5 (OIDC cookie maxAge), CQ-6 (audit IP), CQ-7 (migration), CQ-8 (audit bypass), CQ-9 (token-version helper) |
| Minor | 10 | CQ-10 through CQ-19 |

### Recommendation

Do not close Phase 5 Batch 4 on CQ-1, CQ-2, CQ-3 — all three undermine the very guarantees the batch claims to deliver. CQ-7 and CQ-8 should also be resolved before considering the batch complete (developer friction and audit bypass, respectively). The rest can be triaged into TODO-POST-PHASE-5 unless the maintainer's standard ("zero technical debt") applies — in which case they should all be addressed.


