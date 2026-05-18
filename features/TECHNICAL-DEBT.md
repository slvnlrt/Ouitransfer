# Technical Debt — Items to Fix in Future Sessions

Items discovered during feature work that are out of scope for the current session
but must be addressed. Each item includes context and the fix needed.

---

## ~~TD-1 — API endpoint return types are type-unsafe (I-7 from 7.1 review)~~ ✅ RESOLVED

Resolved in B-7/TD session. Commits `fe94cef`, `1e1f508`, `7ea7cfa`, `ae0b451`.
Removed unsafe `<TData>` generic from 88 endpoint functions across 10 files.
Normalized two-factor and invite patterns. All endpoint functions now use concrete return types.

---

## ~~TD-2 — Account lockout throws ForbiddenError without specific error code~~ ✅ RESOLVED

Resolved in B-7/TD session. Commits `564cb42`, `fba3c43`, `dd02dce`.
Added `ACCOUNT_LOCKED` error code, frontend lockout message with `{minutes}` placeholder
in all 23 locales, `app.inject()` integration test, `LOGIN_LOCKED` audit action,
and 401/403 response schemas on auth routes.

---

## TD-3 — 2FA brute-force gap: no per-account rate limiting on TOTP verification

**Context:** `apps/server/src/modules/auth/service.ts` — `completeTwoFactorLogin()` throws
`UnauthorizedError` on invalid TOTP/backup codes but does NOT call `recordLoginAttempt()`
from `login-attempts.service.ts`. This means the per-account lockout mechanism (10 failed
attempts → 15-minute lock) is bypassed for the 2FA step.

The route-level `rateLimit: { max: 5, timeWindow: "1 minute" }` on `/auth/2fa/login`
(`apps/server/src/modules/auth/routes.ts`) is per-IP only, trivially defeated by rotating IPs.

An attacker who obtains valid credentials (email + password) receives a `challengeToken` and
can then brute-force the 6-digit TOTP code without triggering account lockout.

**Fix:**
1. Call `recordLoginAttempt(emailOrUsername, clientIp)` in `completeTwoFactorLogin()` on
   TOTP/backup code failure (before throwing `UnauthorizedError`)
2. Check `isAccountLocked()` at the start of `completeTwoFactorLogin()` — same pattern as
   the password login path
3. Add integration test verifying that failed 2FA attempts trigger lockout after threshold

**Found during:** B-7/TD session final review (finding I-5)
**Severity:** Medium — security gap, but requires valid credentials as prerequisite
