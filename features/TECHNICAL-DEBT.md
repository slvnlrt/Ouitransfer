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

---

## ~~TD-4 — Zod type provider configured but not leveraged — 104 type assertions across all controllers~~ ✅ RESOLVED

Resolved in TD-4 session (May 2026). Branch `refactor/td4-zod-type-provider`.

All 18 controller classes deleted. All 18 route files migrated to `FastifyPluginAsyncZod`
with `.route()` + inline handlers. All `as` casts on `request.body/params/query` eliminated
(1 intentional widening cast retained with comment). Cookie utilities centralized in
`utils/auth-cookies.ts` (`setAuthCookies`, `clearAuthCookies`, `signAndSetCookies`,
`getClientInfo`). `createJwtPreValidation()` factory extracted to
`middleware/jwt-prevalidation.ts`. Full test suite: 372 tests passing, zero type errors.

Commits: `57c96ff`, `7a25254`, `f2d73ed`, `66215a5`, `3e1aa28`, `ae2e66e`, `1559181`, `0416e89`.

---

## TD-5 — Audit needed: other "infrastructure set up but not used" patterns

**Context:** TD-4 revealed that a core piece of infrastructure (Zod type provider) was
configured but never actually leveraged across any route. This pattern — where refactoring
sets up the right tool but existing code isn't migrated to use it — may exist elsewhere.

**Items to audit:**
- [ ] Are there other TypeScript type-safety gaps where `as` casts mask schema drift?
- [ ] Are Fastify lifecycle hooks (onRequest, preHandler, etc.) properly typed?
- [ ] Is the Prisma client used with full type inference or are there `as unknown as X` casts?
- [ ] Are Zod schemas shared between route definitions and service layer, or duplicated?
- [ ] Are there middleware/plugins that lose type information at boundaries?
- [ ] Review all `as` casts in `apps/server/src/` — each one is a potential type-safety hole

**Found during:** 5.3 LDAP post-fix review remediation
**Severity:** Low-Medium — architectural hygiene, no runtime bugs, but undermines the
value of TypeScript strict mode

---

## TD-6 — Prisma major version upgrade: 6.x → 7.x

**Context:** Prisma CLI reports `Update available 6.19.3 -> 7.8.0` (major version).
Prisma 7 introduces breaking changes to imports, the generated client structure, and
potentially migration behaviour. Requires reading the official migration guide at
`https://pris.ly/d/major-version-upgrade`.

**Packages to update** (in `apps/server/package.json` and `pnpm-workspace.yaml` catalogs):
- `prisma` (devDependency)
- `@prisma/client` (dependency)

**Likely changes:**
- Import paths for `PrismaClient` and generated types may change
- CLI command behaviour / config API may differ
- `prisma.config.ts` API may have additions

**Fix:**
1. Read the Prisma v7 migration guide
2. Update `prisma` + `@prisma/client` in the workspace
3. Adapt imports and any config that changed
4. Run full test suite and `tsc --noEmit`

**Found during:** local dev session (May 2026)
**Severity:** Low (no runtime impact today) — but staying far behind on Prisma majors
accumulates risk and misses bug fixes / performance improvements

---

## TD-7 — Turborepo minor update: 2.9.6 → 2.9.14

**Context:** `just dev` shows `Update available v2.9.6 ≫ v2.9.14`. This is a patch/minor
update (not a major), so it should be safe to apply directly.

**Fix:**
```
pnpm dlx @turbo/codemod@latest update
```
or manually bump `turbo` in the root `package.json` / workspace.

**Found during:** local dev session (May 2026)
**Severity:** Very low — patch update, no breaking changes expected

---

## ~~TD-9 — 4 unused exported types in `file/dto.ts` (knip)~~ ✅ RESOLVED

After TD-4, `RegisterFileInput`, `CheckFileInput`, `MoveFileInput`, `ListFilesInput` in
`apps/server/src/modules/file/dto.ts` became dead exports (were only used by deleted
`FileController`). Resolved by deleting the 4 `export type` lines — schemas are still used
directly in `file/routes.ts`.

---

## TD-8 — Group API quota fields lack validation (no upper bound, no integer check)

**Context:** The Quota module (`apps/server/src/modules/quota/dto.ts`) validates
`maxFileSizeOverride` and `maxTotalStorageOverride` with:
- Upper bound of 1 PB (`ONE_PB = 1125899906842624n`)
- Integer check (must be a valid BigInt-parseable value)
- Explicit null/0/positive semantics

However, the Group routes (`apps/server/src/modules/group/routes.ts:99-106,133-134`)
use a bare `z.union([z.number(), z.string(), z.null()])` with **no upper bound and no
integer validation**. An admin can `POST /groups` with
`"maxFileSizeOverride": "99999999999999999999"` and the schema accepts it.

**Fix:**
1. Extract a shared Zod schema for BigInt quota fields (used in both Quota and Group modules)
2. Apply the same 1 PB cap and integer validation to Group routes
3. Add a test verifying that oversized values are rejected

**Found during:** Documentation quality review (docs-update session)
**Severity:** Low — no data corruption (Prisma stores as BigInt), but inconsistent
validation between two APIs that manage the same concept
