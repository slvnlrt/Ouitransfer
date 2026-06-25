# Phase 5 — Final Global Review

## Summary

Phase 5 (Backend Hardening) represents a comprehensive, well-executed security and architecture overhaul of the Ouitransfer server. Across 22 commits and 142 changed files, 26 items were implemented covering config hardening, CSRF protection, token security, file validation, error architecture, audit logging, and brute-force protection. Four batch reviews surfaced 42+ follow-up items — all resolved. The final code is internally consistent, well-tested (174 server + 190 web + 11 shared tests, all passing), and type-checks cleanly across all packages (10/10 Turborepo tasks succeed).

## Verification

```
pnpm --filter ouitransfer-api test    → 174 passed (174)  ✅
pnpm --filter ouitransfer-web test    → 190 passed (190)  ✅
pnpm --filter @ouitransfer/shared test → 11 passed (11)   ✅
pnpm run validate                     → Tasks: 10 successful, 10 total  ✅
```

All tests pass. Full type-check + lint + build succeeds across the monorepo.

## Cross-Cutting Issues

### Critical

None found.

### Important

**I-1: Portuguese error messages remain in several Zod schemas and middleware**  
- Files: `apps/server/src/modules/file/dto.ts:4-13` (`"O nome do arquivo é obrigatório"`, `"A extensão é obrigatória"`, etc.), `apps/server/src/modules/file/routes.ts:29` (`"Token inválido ou ausente."`)
- What's wrong: These validation error messages are in Portuguese while the entire codebase (API responses, AppError messages, other schemas) uses English. The server API is not i18n'd — it returns English error messages that the frontend maps to translated strings via `next-intl`. Portuguese messages would appear raw in API error responses to non-Portuguese users.
- Why it matters: Inconsistent UX for API consumers. The `globalErrorHandler` surfaces Zod validation errors directly (via `handleZodValidationError`), meaning these Portuguese strings reach the client verbatim. This is a pre-existing issue, not introduced by Phase 5, but was encountered along the way.
- Suggested fix: Replace all Portuguese strings in Zod schemas with English equivalents. Example: `z.string().min(1, "File name is required")`. Scope: `file/dto.ts`, `file/routes.ts`.

**I-2: `loginAttempt.ipAddress` is stored but not used in lockout logic**  
- File: `apps/server/src/modules/auth/login-attempts.service.ts:56-63`
- What's wrong: `isAccountLocked` queries only by `email` (line 58), ignoring the `ipAddress` parameter for the lockout check. The `ipAddress` is only used for audit logging (line 82). The `recordLoginAttempt` function stores `ipAddress` with every attempt record, but this data is never consulted for lockout decisions.
- Why it matters: This is actually a defensible design choice — email-only lockout prevents IP rotation attacks. However, the function signature accepting `ipAddress` creates the false impression that lockout is per-email+IP pair. Additionally, the stored `ipAddress` data in `LoginAttempt` rows is effectively dead weight for the lockout system (though useful for forensic audit).
- Assessment: This is **not a bug** — it's a design decision. The current email-only approach is arguably more secure than per-IP lockout. However, if the team ever wants per-account-per-IP lockout, the infrastructure is already in place. No fix needed — but a comment documenting the intentional email-only design would prevent future confusion.

### Minor

**M-1: `generateBackupCodes` is unnecessarily `async`**  
- File: `apps/server/src/modules/two-factor/service.ts:324-336`
- What's wrong: The private `generateBackupCodes()` method is marked `async` but contains no `await` calls — it only uses synchronous `crypto.randomBytes`. All 3 callers `await` it, adding unnecessary microtask overhead.
- Suggested fix: Remove the `async` keyword and change the return type from `Promise<BackupCode[]>` to `BackupCode[]`.

**M-2: Potential timing leak in backup code lookup during `verifyToken`**  
- File: `apps/server/src/modules/two-factor/service.ts:147-149`
- What's wrong: `backupCodes.findIndex(bc => !bc.used && timingSafeEqual(bc.code, token))` short-circuits on the first match. The `timingSafeEqual` comparison itself is constant-time, but `findIndex` reveals the position of the valid backup code through total iteration count (observable via timing). An attacker could potentially learn which backup code index is valid.
- Why it matters: Extremely low practical risk — backup codes are single-use, high-entropy random strings, and the timing difference is in the nanosecond range (one extra comparison per code). The existing approach is standard practice for backup code verification.
- Assessment: No fix required — this is a theoretical concern only. Documenting it for completeness.

**M-3: `isAccountLocked` re-queried inside `recordLoginAttempt` for failures**
- File: `apps/server/src/modules/auth/login-attempts.service.ts:34-36`
- What's wrong: When recording a failed attempt, `recordLoginAttempt` calls `isAccountLocked` to check if the account is already locked (to prevent rolling lockout). But the caller (`auth/service.ts:41`) already calls `isAccountLocked` before `recordLoginAttempt`. This means for every failed login, `isAccountLocked` runs twice with the same parameters, executing duplicate Prisma queries.
- Why it matters: Minor performance overhead (one extra DB query per failed login attempt). The logic is correct — the guard in `recordLoginAttempt` is a defense-in-depth mechanism in case the function is called from other paths without a prior lockout check.
- Suggested fix: Accept an optional `skipLockCheck` parameter, or document the intentional double-check.

**M-4: `ConfigService` instantiated multiple times across controllers**
- Files: Multiple controllers (`AuthController`, `TwoFactorController`, `FileController`, `AppController`, etc.) each create `new ConfigService()`.
- What's wrong: `ConfigService` is stateless — it wraps `prisma.appConfig.findUnique` calls with no caching. Each controller instantiation creates a new instance that does the same thing. This is fine functionally but could be simplified to a shared singleton or static methods.
- Assessment: Pre-existing pattern, not introduced by Phase 5. No fix needed for this phase.

**M-5: `refresh_token` cookie path `/api/auth/refresh` assumes proxy path structure**
- Files: `apps/server/src/modules/auth/controller.ts:81`, `apps/server/src/modules/auth/routes.ts:409`, `apps/server/src/modules/auth-providers/controller.ts:356`
- What's wrong: The refresh token cookie's `path` is hardcoded to `/api/auth/refresh`, which is the Next.js proxy path — not the Fastify route path (`/auth/refresh`). This creates an implicit coupling between the server's cookie configuration and the frontend's proxy URL structure.
- Assessment: This is **intentionally correct** — the browser needs the cookie scoped to the proxy path since it never contacts the Fastify server directly. However, if the proxy URL structure changes, the server-side cookie path must also change. A shared constant or environment variable would be more robust.

## Architecture Assessment

The overall architecture after Phase 5 is **coherent and well-layered**:

1. **Error architecture** is clean: `AppError` hierarchy → `globalErrorHandler` → `ErrorResponseSchema` forms a consistent pipeline. All 17 controllers and 17 services throw `AppError` subclasses. No controller has residual try/catch blocks that swallow errors or return ad-hoc JSON error responses. The `ErrorResponseSchema` is shared across ~176 error response declarations.

2. **CSRF protection** uses a sound dual-mechanism approach: primary per-route `config: { csrfExempt: true }` (type-safe, co-located with route definitions via `FastifyContextConfig` augmentation) plus fallback `CSRF_EXEMPT_ROUTES` set (defense-in-depth for routes outside module files). The trailing-slash normalization prevents bypass. CSRF exemptions are correctly applied only to unauthenticated public mutation endpoints.

3. **Token security lifecycle** is complete: 15-minute access tokens (JWT in httpOnly cookie) + 7-day refresh tokens (opaque, httpOnly cookie) with rotation, replay detection (revoke-all on reuse), and cleanup. Token version validation runs on every `jwtVerify()` with 30s cache. Privilege changes (password, isAdmin, isActive, 2FA toggle) increment tokenVersion and revoke all refresh tokens.

4. **`app.ts` is NOT too large** — at 252 lines, it contains only infrastructure setup (Fastify instance, plugins, CSRF hook, Swagger) and no business logic. All business logic is in module routes/controllers/services. This is appropriate for a single-server monolith.

5. **Separation of concerns** is well-maintained: each module has controller (HTTP layer), service (business logic), routes (route registration + schemas), and dto (validation schemas). Security services (`token-version.ts`, `refresh-token.service.ts`, `login-attempts.service.ts`, `audit/service.ts`) are cleanly factored.

6. **Frontend integration** is solid: the Axios interceptor handles CSRF token acquisition, 401 → refresh → retry → redirect flow, and CSRF 403 recovery (clear token only on CSRF-specific errors). The mutex prevents concurrent refresh attempts. The proxy correctly forwards `x-csrf-token` headers and `_csrf` cookies.

## Security Assessment

The security model is **comprehensive and consistent**:

1. **CSRF**: Double-submit cookie pattern with HMAC-based tokens (via `@fastify/csrf-protection`). Server validates on every state-changing request except explicitly exempt public endpoints. The `CSRF_SECRET` must differ from `JWT_SECRET` (enforced by Zod `.refine()`). Frontend fetches tokens on demand and attaches to mutation requests.

2. **Token lifecycle**: Short-lived access tokens (15min) + rotated refresh tokens (7 days). Replay detection revokes all user tokens on reuse. Token version invalidation on privilege changes ensures immediate session revocation within 30 seconds (cache TTL).

3. **Brute-force protection**: 10 failed attempts per email within 15 minutes triggers lockout. Email normalization prevents case-sensitivity bypass. Locked accounts don't record additional attempts (prevents rolling lockout). Hourly cleanup of old attempts.

4. **File validation**: Two-layer approach — MIME/extension consistency check (synchronous denylist) + magic-byte verification (reads first 4KB from S3). Dangerous extensions and blocked MIME types are denied. Object name validation prevents path traversal (`..`, null bytes, namespace prefix check).

5. **Filename sanitization**: Comprehensive sanitizer handles path separators, null bytes, leading dots, trailing dots/spaces, Windows reserved names, and UTF-8 truncation. Applied consistently at presigned URL generation, file registration, and reverse-share uploads.

6. **OAuth redirect validation**: Allowlist-based validation for OAuth redirects — built-in providers + env-configurable custom hosts. Relative URLs always allowed. Malformed URLs rejected.

7. **2FA disable**: Requires both password AND valid TOTP code (or backup code), preventing single-factor 2FA downgrade. Timing-safe comparison for backup codes.

8. **Audit logging**: 11 audit actions at 8 security-sensitive locations. Fire-and-forget pattern with `.catch()` prevents audit failures from blocking security operations. Admin endpoint with pagination and filtering, gated by JWT + admin check.

**Gaps/Notes:**

- The `CORS_ORIGINS` env var is only enforced (`throw`) in production mode. In dev, it defaults to `http://localhost:5487`. This is appropriate.
- Rate limiting on `/csrf-token` (30/min) and auth endpoints (5/min for login, 3/min for password reset) is reasonable.
- The `CSRF_EXEMPT_ROUTES` fallback set does not include `/auth/register` — this is correct since registration becomes admin-only after the first user.

## Test Coverage Assessment

**Strengths:**
- 174 server tests cover the critical security paths with both unit tests and integration tests.
- Integration tests using `app.inject()` exercise the full Fastify lifecycle (route registration → schema validation → CSRF hook → handler → error handler → response serialization).
- Key security flows tested:
  - CSRF: 20 tests covering token lifecycle, exempt routes, bypass prevention, per-route config
  - Refresh tokens: 5 integration tests (CSRF exempt, missing token, valid rotation, invalid token, replay detection, race condition)
  - Audit logs: 4 integration tests (admin gate, filtering, pagination)
  - File validation: 5 integration tests (MIME consistency, magic-byte verification, dangerous extensions, object name validation)
  - Login attempts: 8 unit tests (lockout, consecutive failures, reset on success, cleanup)
  - Token version: 3 unit tests (validate, cache, increment)

**Coverage gaps (none critical):**
- No integration test for the full login → 2FA → refresh cycle end-to-end. Individual steps are tested but not chained.
- No integration test for the OAuth callback → refresh token → OIDC session lifecycle. The callback sets refresh token cookies, but this path isn't exercised through `app.inject()` (it would require mocking the OAuth provider).
- No test for `cleanupExpiredTokens` or `cleanupOldAttempts` via the periodic interval (tested via direct service calls, which is sufficient).

## Strengths

1. **Thorough batch review process**: 4 batch reviews with 42+ follow-up items, all resolved. Critical issues like the Zod schema desync (totpCode stripped), CSRF trailing-slash bypass, and OIDC refresh token omission were caught and fixed before reaching final review.

2. **Defense-in-depth design**: Multiple layers for every security mechanism — CSRF has per-route config + fallback set, file validation has MIME check + magic bytes + dangerous extension denylist, token security has version check + refresh rotation + replay detection.

3. **Clean error architecture**: The `AppError` → `globalErrorHandler` → `ErrorResponseSchema` pipeline eliminates ad-hoc error handling. The convention that AppError messages are always client-safe is well-enforced and documented.

4. **Comprehensive Prisma schema**: Proper indexes on `LoginAttempt` (email+createdAt, createdAt), `RefreshToken` (userId, expiresAt, unique on token), and `AuditLog` (userId+createdAt, action+createdAt, createdAt). Foreign keys with `onDelete: Cascade` for proper cleanup.

5. **Minimal frontend impact**: Phase 5 was primarily a backend phase. Frontend changes were surgical — CSRF token management in the Axios interceptor, totpCode field in the disable 2FA form, and refresh token handling. No UI redesign required.

6. **Consistent token versioning**: Every privilege-changing operation (password change, admin toggle, active toggle, 2FA enable/disable, password reset, account deactivation, user deletion) correctly increments tokenVersion and/or revokes refresh tokens. The password reset uses an inline `$transaction` with a documenting comment explaining why `incrementTokenVersion` helper isn't used.

## Verdict

**Ready for Phase 6: Yes.**

The codebase is in excellent shape after Phase 5. All 26 items were implemented, all 42+ review follow-up items were resolved, and the code is internally consistent. The only actionable items are I-1 (Portuguese error messages — pre-existing issue, should be tracked for cleanup in a future phase) and the minor items which are all low-priority improvements.

No blocking issues. No security gaps. No architectural concerns. The backend hardening is complete and ready for the next phase.
