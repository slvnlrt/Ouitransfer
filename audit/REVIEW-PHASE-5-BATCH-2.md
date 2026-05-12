# Phase 5 Batch 2 — Implementation Review (Tasks 3, 4, 5)

**Reviewer:** Principal engineer, critical review mode.
**Method:** Read every implementation file and compare against the spec line by line. Ran `pnpm --filter ouitransfer-api test`, `pnpm --filter @ouitransfer/shared test`, `pnpm --filter ouitransfer-web test`. Verified BOM hypothesis by reading raw bytes of changed files and comparing against the parent commit.

---

## Verdict summary

| Task | Verdict |
|------|---------|
| **3 — Admin detection / proxy cookies / OAuth redirect** | ✅ Spec compliant |
| **4 — 2FA disable hardening** | ❌ Issues found (regression: BOM in 22 locale files breaks locale-keys parity test) |
| **5 — CSRF + timing-safe comparisons** | ❌ Issues found (missing CSRF exemption for one public route → functional regression; minor: no CSRF_SECRET ≠ JWT_SECRET enforcement) |

Tests: `ouitransfer-api` 71/71 ✅, `@ouitransfer/shared` 11/11 ✅, `ouitransfer-web` 183/185 — **2 failures**, both in `src/__tests__/locale-keys.test.ts` and caused by Task 4.

---

## Task 3 — 5.6, 5.14, 5.15 — ✅ Spec compliant

### 5.6 — Admin detection (`apps/server/src/modules/app/routes.ts:11-36`)

- ✅ `usersCount === 0` (was `<= 1`) — `routes.ts:21`
- ✅ DB call sits **outside** any try/catch, so errors propagate to `globalErrorHandler` — `routes.ts:14`
- ✅ JWT failures go through a dedicated try/catch and use `request.log.warn` (not `.error`) — `routes.ts:26-31`
- ✅ Setup-window caveat is explicitly documented in a NOTE comment — `routes.ts:18-20`

### 5.14 — Standardize `cookie: false` on 8 public routes (`apps/web/src/lib/proxy-routes.ts`)

All 8 routes verified present with `cookie: false`:

| Route | Line | OK |
|-------|------|----|
| `POST auth/2fa/login` | 107 | ✅ |
| `GET auth/providers/:provider/authorize` | 129-134 | ✅ |
| `GET auth/providers/:provider/callback` | 135-140 | ✅ |
| `GET auth/providers` | 145-149 | ✅ |
| `GET shares/alias/get/:alias` | 364 | ✅ |
| `POST shares/alias/:alias/access` | 365 | ✅ |
| `GET shares/details/:shareId` | 385 | ✅ |
| `POST shares/:shareId/access` | 386 | ✅ |

`auth: true` is **not** set on `authorize` / `callback` / providers list (correct — they are public). `POST auth/logout` (119) and `GET auth/me` (120) keep cookies as required.

### 5.15 — OAuth redirect validation (`apps/web/src/lib/proxy.ts`)

- ✅ `isAllowedRedirectUrl(location, requestUrl)` exported — `proxy.ts:51`
- ✅ Relative URLs (`/...` but not `//...`) allowed — `proxy.ts:53-55`
- ✅ Protocol-relative `//evil.com` blocked: `new URL("//evil.com/x")` throws → caught → returns `false` — verified by test `proxy-oauth-redirect.test.ts:36-38`
- ✅ Same-origin allowed — `proxy.ts:62-64`
- ✅ Built-in hosts: 6 hosts present and exactly matching the spec — `proxy.ts:23-30`
- ✅ Env extension via `OAUTH_ALLOWED_REDIRECT_HOSTS`, comma-separated, read **at invocation time** inside `getAllowedRedirectHosts()` — `proxy.ts:32-42`. Hostname comparison lowercased on both sides (`proxy.ts:37, 68`)
- ✅ Used in `handleProxyRequest` redirect path; blocked → 502 — `proxy.ts:396-399`
- ✅ 7 tests in `apps/web/src/lib/__tests__/proxy-oauth-redirect.test.ts`. All assertions reasonable.

Minor note (not a defect): the test file uses `from "../proxy.js"` even though the source is `.ts`. This is consistent with project ESM conventions and Vitest resolves it correctly.

---

## Task 4 — 5.13 — 2FA disable hardening — ❌ Issues found

### What is correct

- ✅ `disable2FA(userId, password, totpCode)` — third param added — `apps/server/src/modules/two-factor/service.ts:163`
- ✅ TOTP verified via `OTPAuth.TOTP.validate({ token, window: 1 })` after `replace(/[\s-]/g, "")` normalization (same pattern as `verifyToken`) — `service.ts:202-210`
- ✅ Backup code fallback marks the consumed code as used — `service.ts:214-230`
- ✅ Uses `timingSafeEqual` for the backup code comparison — `service.ts:218`
- ✅ `DisableSchema` adds `totpCode` (min 6 chars) — `controller.ts:24-30`
- ✅ Frontend `DisableTwoFactorRequest.totpCode: string` — `types.ts:36-39`
- ✅ Hook adds `disableTotpCode` state, clears on success, emits `missing_totp` sentinel — `use-two-factor.ts:43, 114-116, 137-140`
- ✅ Modal has the TOTP input gated alongside the password — `two-factor-form.tsx:444-456, 470`
- ✅ en-US.json: `twoFactor.disable.totpLabel` + `totpHint` — `en-US.json:1747-1748`
- ✅ 3 tests in `service.test.ts` (success / invalid TOTP / wrong password) — all pass

### ❌ Issue 1 — Critical — BOM corruption of 22 locale files

Commit `0df4484` introduced a UTF-8 BOM (`EF BB BF`) at the start of **every non-English locale file**:

```
ar-SA.json, de-DE.json, el-GR.json, es-ES.json, fa-IR.json, fr-FR.json,
he-IL.json, hi-IN.json, id-ID.json, it-IT.json, ja-JP.json, ko-KR.json,
nl-NL.json, pl-PL.json, pt-BR.json, ru-RU.json, sv-SE.json, th-TH.json,
tr-TR.json, uk-UA.json, vi-VN.json, zh-CN.json
```

Confirmed:
- Raw bytes of `de-DE.json` HEAD: `EF BB BF 7B 0A 20`
- Raw bytes of `de-DE.json` at parent commit `29a31b7`: `7B …` (no BOM)
- `en-US.json` is clean (`7B 0A …`)

**Impact:** breaks `apps/web/src/__tests__/locale-keys.test.ts` which uses `JSON.parse(readFileSync(..., "utf-8"))`. `JSON.parse` does **not** strip the BOM — it throws `SyntaxError: Unexpected token '﻿', "﻿{ "a11y"... is not valid JSON`. Both nested-paths and top-level parity tests fail.

This is a **functional regression introduced by Task 4 that the implementer didn't catch** despite the failing test being in the same package. The implementer claimed "3 tests pass" — true for the unit tests they wrote, but they didn't run the **full** web test suite, which is what `pnpm --filter ouitransfer-web test` would have flagged immediately.

Likely root cause: the implementer used PowerShell `Out-File` / `Set-Content` (default encoding on Windows is UTF-8 with BOM on older versions, or `Default` codepage) to add the i18n keys to all 22 files, rather than `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))` which writes without BOM.

**Fix:** strip the BOM from all 22 files, e.g.:
```powershell
Get-ChildItem D:\Code\Ouitransfer\apps\web\messages\*.json | Where-Object {
  $bytes = [System.IO.File]::ReadAllBytes($_.FullName);
  $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
} | ForEach-Object {
  $content = Get-Content -Raw $_.FullName
  $content = $content -replace "^\uFEFF", ""
  [System.IO.File]::WriteAllText($_.FullName, $content, [System.Text.UTF8Encoding]::new($false))
}
```

This is a **stop-the-line** finding — the `validate` pipeline (which runs `pnpm test`) will fail on every CI run until fixed.

### Minor

- `DisableSchema.totpCode` accepts `min(6)` but does not reject pure whitespace (`"      "`). The server-side normalization strips spaces and ends up with an empty string, which then makes `OTPAuth.TOTP.validate` return `null`, throwing "Invalid verification code" — still safe, just a less specific error. Not worth fixing.

---

## Task 5 — 5.4, 5.22 — CSRF + timing-safe — ❌ Issues found

### What is correct

- ✅ `@fastify/csrf-protection@7.1.0` installed — confirmed via `node_modules/.pnpm`
- ✅ `CSRF_SECRET` env var, min 32 chars — `env.ts:31-34`
- ✅ Plugin registered **after** `@fastify/cookie` — `app.ts:130, 147`
- ✅ `cookieOpts`: `httpOnly: true`, `sameSite: "lax"`, `secure: env.SECURE_SITE === "true"`, `path: "/"`, `signed: false` — `app.ts:149-155`
- ✅ HMAC key from `CSRF_SECRET` via `csrfOpts.hmacKey` — `app.ts:157-159`
- ✅ `getToken: req => req.headers["x-csrf-token"]` — `app.ts:156`
- ✅ `GET /csrf-token` endpoint, rate-limited 30/min — `app.ts:163-174`
- ✅ Global `onRequest` hook skips safe methods + exempt routes, otherwise calls `app.csrfProtection(req, reply, done)` (callback-style — matches the plugin's `decorate('csrfProtection', csrfProtection)` API verified in `node_modules/.pnpm/@fastify+csrf-protection@7.1.0/.../index.js`) — `app.ts:211-233`
- ✅ Exempt routes set includes the 7 documented public mutations + `/csrf-token` + `/health` — `app.ts:181-190`
- ✅ Frontend Axios interceptor: fetches/caches token, sends `X-CSRF-Token` on mutations, clears on 403, dedupes concurrent fetches — `apps/web/src/config/api.ts:14-62, 88-90`
- ✅ Proxy forwards `x-csrf-token` header — `apps/web/src/lib/proxy.ts:162-165`
- ✅ Proxy route table exposes `csrf-token` — `proxy-routes.ts:100`
- ✅ `.env.example` updated — `apps/server/.env.example:9`
- ✅ 12 tests pass (counted `it()` blocks at lines 55, 69, 84, 101, 106, 113, 123, 133, 143, 153, 163, 178 in `csrf.test.ts`) — `pnpm --filter ouitransfer-api test`: 71 pass, 0 fail

### ✅ Timing-safe utility (5.22)

- ✅ `apps/server/src/utils/timing-safe.ts` — 14 lines, uses `crypto.timingSafeEqual`, length pre-check is the only short-circuit (well-documented)
- ✅ Both backup-code comparisons in `two-factor/service.ts` use `timingSafeEqual` — lines 138 and 218
- ✅ 6 tests in `utils/__tests__/timing-safe.test.ts`: identical / different-equal-length / different-length / empty / unicode / backup-code-format — all pass
- ✅ `rg "bc\.code ===|backupCode ===|code === token|code === totpCode" apps/server` → no matches (full migration verified)

### ❌ Issue 1 — Important — Missing CSRF exemption for `POST /reverse-shares/:id/upload/access`

The spec lists "reverse-share flows" among exempt routes, and the proxy already marks `reverse-shares/upload/:id/access` (frontend path) with `cookie: false` (`proxy-routes.ts:306-308`) — confirming the design intent that this is a public mutation by anonymous senders posting a password to access a password-protected reverse share.

The backend path is `POST /reverse-shares/:id/upload/access` (`reverse-share/routes.ts:204`). The CSRF exemption rules in `app.ts:196-209` cover:
- `startsWith("/reverse-shares/alias/")` → covers all alias paths
- `endsWith("/presigned-url")`, `/register-file`, `/check-password`

But **none** of these matches `/reverse-shares/<uuid>/upload/access`. Result: anonymous users uploading to a password-protected reverse share via the `/reverse-shares/upload/:id/access` proxy route will be **rejected with 403 "Missing csrf secret"** (since they're anonymous, they don't have a `_csrf` cookie unless they coincidentally fetched `/api/csrf-token` first).

**Fix:** add to `CSRF_EXEMPT_DYNAMIC` in `app.ts:196-209`:
```ts
// POST /reverse-shares/:id/upload/access (anonymous upload to password-protected reverse share)
(url) => url.startsWith("/reverse-shares/") && url.endsWith("/upload/access"),
```

This will also cover the alias variant `/reverse-shares/alias/:alias/upload/access`, which is already covered by the broader `startsWith("/reverse-shares/alias/")` rule.

### ❌ Issue 2 — Minor — Spec said `CSRF_SECRET` "separate from JWT_SECRET" but no runtime check

The Zod `.describe()` mentions "must be distinct from JWT_SECRET" (`env.ts:34`) but there is no `.refine()` validator. An operator who copies the same value into both variables will pass validation. The spec language ("separate from") implies enforcement. Trivial fix:

```ts
}).refine(
  (env) => env.JWT_SECRET !== env.CSRF_SECRET,
  { message: "CSRF_SECRET must differ from JWT_SECRET (HMAC keys must be distinct)" },
);
```

Verdict: minor — defense-in-depth, not exploited if both are properly random; the doc string is correct, only the validator is missing.

### Minor observations (not defects)

- The hook strips query strings before route matching (`app.ts:218`). Good — prevents `/auth/login?foo=bar` from being denied.
- `CSRF_EXEMPT_ROUTES` includes `/health` and `/csrf-token`. `/health` is GET-only so it's already skipped by the safe-method branch — exempting it is harmless. `/csrf-token` is GET, same.
- The frontend interceptor uses `axios.get("/api/csrf-token", { withCredentials: true })` directly rather than `apiInstance` to avoid the interceptor recursing — correct.
- `csrfFetchPromise` is correctly nulled in `.finally()` to free the dedup lock even on rejection — correct.

---

## Cross-cutting observations

1. **Test discipline:** Task 4's implementer ran only the unit tests they authored (`two-factor`) and did not run `pnpm --filter ouitransfer-web test`. The locale-parity test, which exists explicitly to catch i18n regressions, would have flagged the BOMs immediately. This is exactly the failure mode the verification-before-completion principle is meant to prevent.
2. **Spec ambiguity surface:** the "reverse-share flows" line in the CSRF spec was vague. The implementer interpreted it as the alias subtree + a couple of suffix patterns, but `POST /:id/upload/access` is a real public mutation that slipped through. Suffix-based matching is fragile — consider a single authoritative "public mutation" list per route (server-side metadata, e.g. a `config.public: true` on the route) in a future iteration.

---

## Required fixes before merging

1. **Strip BOMs from all 22 non-English locale files** so `locale-keys.test.ts` passes. (Task 4)
2. **Add CSRF exemption for `/reverse-shares/<id>/upload/access`** so anonymous password-protected uploads work. (Task 5)
3. **Add Zod `.refine` for `CSRF_SECRET !== JWT_SECRET`** to match spec wording. (Task 5)

All three are mechanical changes. After fixing, run `pnpm --filter ouitransfer-web test`, `pnpm --filter ouitransfer-api test`, and ideally start the dev stack to manually exercise an anonymous password-protected reverse-share upload to confirm Issue 1 is resolved end-to-end.

---

# Code Quality Review — Phase 5 Batch 2

**Reviewer:** Principal engineer, critical review mode.
**Scope:** Commits `29a31b7`, `0df4484`, `cbdbde8`, `e32182c` (Tasks 3, 4, 5 + fixes).
**Method:** Verified every claim against the actual code (not just diffs). Traced the disable-2FA request flow end-to-end. Inspected `fastify-type-provider-zod@4.0.2` source to confirm route-body stripping behavior. Cross-checked CSRF exemption patterns against the actual reverse-share/share/auth route definitions.

## Strengths

- **`isAllowedRedirectUrl` is well-shaped.** Pure function, env-driven extension hook, fail-closed on malformed URLs, properly handles relative vs. protocol-relative (`//evil.com`) distinction, lowercase host normalization. Unit tests cover the relevant cases including the `vi.stubEnv` extension path.
- **Admin pre-validation refactor (5.6) cleanly separates concerns**: count → setup-window early return → JWT verification → admin gate. The DB call is now outside any try/catch (correct — propagates to `globalErrorHandler`). JWT failure uses `log.warn` instead of `log.error`, reflecting that a stale/missing token is not a server error.
- **CSRF token request deduplication is correct.** The `csrfFetchPromise` pattern collapses concurrent first-fetches into one round-trip and is cleared in `.finally()` so rejection doesn't poison the lock. SSR guards (`typeof window === "undefined"`) are placed correctly on both `fetchCsrfToken` and the interceptor.
- **CSRF cookie hardening (`cookie: false` on 8 proxy routes) is principled.** It prevents the proxy from forwarding the `token` JWT cookie to backend endpoints that are meant to be public/unauthenticated, reducing the blast radius of any session-fixation or cookie-leak issue on those endpoints.
- **Distinct-secret `.refine` in env.ts** is the right place to enforce `CSRF_SECRET !== JWT_SECRET` — fail-fast at boot, no runtime branch.
- **`timing-safe.ts` is a thin, correct abstraction** over `crypto.timingSafeEqual`. The 14-line size matches the responsibility: one job, well-tested.

## Issues

### Critical

**C-1 — `/2fa/disable` route schema strips `totpCode`, controller demands it → endpoint is broken end-to-end.**

`apps/server/src/modules/two-factor/routes.ts:120-122` declares `body: z.object({ password: z.string().min(1)... })`. `fastify-type-provider-zod@4.0.2` (verified at `dist/src/core.js:68-73`) replaces `request.body` with `schema.safeParse(data).data`, and Zod's default object mode is `.strip()` — unknown keys are removed from the parsed output. Confirmed empirically:

```js
z.object({password: z.string()}).parse({password: 'p', totpCode: '123456'})
// → { password: 'p' }   // totpCode gone
```

The controller (`controller.ts:121-123`) then runs `DisableSchema.parse(request.body)` where `DisableSchema` requires `totpCode` — this throws, the catch returns `400 { error: "totpCode: Required" }`. **Every disable-2FA call will fail, regardless of TOTP correctness.** No integration test covers this because the only new test (`service.test.ts`) bypasses the route by calling the service directly.

Fix: update the route-level body schema in `routes.ts` to include `totpCode: z.string().trim().min(6)`. Add a route-level test using `app.inject` to confirm the round-trip.

**C-2 — `/auth/register` is in `CSRF_EXEMPT_ROUTES` but is an admin-only endpoint (after first user).**

`apps/server/src/app.ts:183` adds `/auth/register` to the exempt set. But `apps/server/src/modules/user/routes.ts:13-34, 55-57` shows that route runs `preValidation` which **requires admin** once `usersCount > 0`. The exemption is needed only for the first-user-setup window; once any user exists, this is a CSRF gap on admin user creation. An attacker who lures an admin to a malicious page can register a new (potentially admin) user via cross-site POST.

Fix options: (a) move the first-user-setup to a distinct unauthenticated route like `/auth/bootstrap`, and remove `/auth/register` from the exempt list; (b) keep the exemption but tighten the route handler to only accept anonymous calls when `usersCount === 0` (the route already does this via preValidation, but CSRF is a separate concern — the exemption should not be unconditional). Option (a) is cleaner and matches "no production, no legacy" policy.

### Important

**I-1 — CSRF exemption test surface is shallow: no test asserts that an authenticated mutation is actually protected.**

`csrf.test.ts` exercises:
- GET `/csrf-token` (positive)
- POST `/test/protected` without token (403) ✓
- POST `/test/protected` with token+cookie (200) ✓
- The exempt list (positive)
- Tampered/missing-cookie cases (403) ✓

But it does not exercise any *real* authenticated route (e.g. `POST /auth/logout`, `POST /shares`, `DELETE /reverse-shares/:id`). The custom `/test/protected` route is created in `beforeAll` and is **registered after CSRF setup**, so it sees the same hook — but a regression where a real route bypasses the hook (e.g. because it's registered *before* the hook in a future refactor) would not be caught. Add at least one assertion against a route from the actual route table, e.g. `POST /shares` without auth+CSRF returns 403, with auth alone still returns 403, with both returns 401 (auth check would then fire).

**I-2 — `CSRF_EXEMPT_DYNAMIC` is fragile and unmaintainable.**

Five suffix-match arrow functions in an array, all sharing the prefix `/reverse-shares/`. This pattern:
1. Already missed `/upload/access` in the first cut (fixed in `e32182c`) — Spec issue 1.
2. Will silently exempt any future route ending in those suffixes under `/reverse-shares/`, even if added with admin auth. E.g., a future `POST /reverse-shares/admin/:id/check-password` (admin-only) would be silently CSRF-bypassed.
3. Does not encode the HTTP method — `(url) => url.startsWith("/reverse-shares/alias/")` exempts **all methods** on that subtree. As of today every such route is public, but this is invariant-by-luck, not by design.

The auditable approach: tag routes with `config.csrfExempt: true` at definition time and read that flag in the hook. Self-documenting, single source of truth, impossible to drift between route definition and exemption list. Defer if necessary, but track it.

**I-3 — Trailing-slash handling breaks CSRF exemption when `ignoreTrailingSlash: true`.**

`apps/server/src/app.ts:41` sets `ignoreTrailingSlash: true`. A client sending `POST /auth/login/` (with trailing slash) reaches the same route handler, but `request.url.split("?")[0]` returns `/auth/login/`, which is **not** in `CSRF_EXEMPT_ROUTES` (which stores `/auth/login`). Result: legitimate login with trailing slash returns 403 instead of dispatching to the login handler. UX bug, not a security bypass (the asymmetry favors stricter behavior).

Fix: normalize before the exempt check — `const url = request.url.split("?")[0].replace(/\/+$/, "") || "/";`

**I-4 — Backup-code path in `disable2FA` is inconsistent with `verifyToken` (no normalization).**

`service.ts:209-210` normalizes the TOTP candidate (`replace(/[\s-]/g, "")`) before validating against the TOTP secret. But on line 218, the backup-code fallback uses the **un-normalized** `totpCode` for the `timingSafeEqual` comparison. So a user pasting `A1B2-C3D4` matches the stored format ✓, but `A1B2 C3D4` (space) or `a1b2-c3d4` (lowercased) fails — even though for TOTP we'd normalize.

`verifyToken` has the same shape (line 138: `timingSafeEqual(bc.code, token)` — un-normalized token), so this is pre-existing behavior. Two options: (a) keep current behavior, document that backup codes are case-sensitive and exact-match; (b) define a single `normalizeBackupCode` helper and apply it on both sides (store and compare). (b) is what most 2FA libraries do.

**I-5 — `DisableSchema` is missing `.trim()` whereas `VerifyTokenSchema` has it.**

`controller.ts:20-22` vs `controller.ts:24-30`. Trim matters for users who paste codes with surrounding whitespace from password managers / SMS forwarders. Inconsistency within the same file. Add `.trim()` to `totpCode`.

**I-6 — Frontend `AUTH_API_PREFIXES` includes a dead entry: `/api/auth/request-password-reset`.**

`apps/web/src/config/api.ts:72`. The proxy route table (`proxy-routes.ts:117`) maps `auth/forgot-password` → `/auth/forgot-password`. There is no `request-password-reset` proxy route. This entry never matches. Pre-existing, but touched indirectly by Batch 2 (the file was substantially modified). Replace with `/api/auth/forgot-password` for consistency with the actual route.

**I-7 — `403 → clear CSRF token` heuristic over-invalidates.**

`api.ts:88-90`: any 403 response clears the cached CSRF token. But 403 is also returned for legitimate authorization failures (admin-only endpoints, insufficient permissions). Clearing the token then forces a `/csrf-token` round-trip on the very next mutation. Functionally harmless (token gets refetched), but wastes a request per 403. If the goal is "rotate on actual CSRF rejection", introspect the response body — the plugin returns `{ statusCode: 403, code: "FST_CSRF_INVALID_TOKEN", ... }`. Match on `error.response?.data?.code === "FST_CSRF_INVALID_TOKEN"` instead.

**I-8 — No test for CSRF token expiry / rotation flow on the frontend.**

`api.ts` correctly clears `csrfToken` on 403, but there's no test asserting that the next mutation triggers a fresh fetch. With axios+vitest+`vi.mock("axios")` this is testable and cheap. The deduplication code (`csrfFetchPromise`) is also untested — a regression where two parallel mutations both fire `/csrf-token` requests would go unnoticed.

### Minor

**M-1 — `timingSafeEqual` uses JS string length for the short-circuit, not byte length.**

`utils/timing-safe.ts:12`: `if (a.length !== b.length) return false`. For ASCII this is identical, but for multi-byte UTF-8 inputs of equal *string* length but different *byte* length, the short-circuit would be skipped and `crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))` would throw `"Input buffers must have the same byte length"`. Backup codes are ASCII (A-Z, 0-9, `-`), so unreachable today. But the utility is named generically and may be reused. Either compare buffer lengths instead of string lengths, or document the contract (ASCII only).

**M-2 — `disable2FA` uses an "empty-then-fallback" branch shape that's hard to read.**

`service.ts:212-233`:
```ts
if (totpVerified) {
  // TOTP code is valid — proceed to disable
} else if (user.twoFactorBackupCodes) {
  // ... backup-code logic
} else {
  throw new Error("Invalid verification code");
}
```

An empty `if` body with the meaningful work in `else if` reads inverted. Cleaner:

```ts
if (!totpVerified) {
  if (!user.twoFactorBackupCodes) throw new Error("Invalid verification code");
  const backupCodes: BackupCode[] = JSON.parse(user.twoFactorBackupCodes);
  const idx = backupCodes.findIndex((bc) => !bc.used && timingSafeEqual(bc.code, totpCode));
  if (idx === -1) throw new Error("Invalid verification code");
  backupCodes[idx].used = true;
  await prisma.user.update({ where: { id: userId }, data: { twoFactorBackupCodes: JSON.stringify(backupCodes) } });
}
```

**M-3 — `getAllowedRedirectHosts` rebuilds the Set on every redirect.**

`apps/web/src/lib/proxy.ts:32-42`: env is read and the Set is built on each call. OAuth redirects are rare, but this also evaluates inside a hot proxy path. Tests need fresh env on each call (`vi.stubEnv`), so caching has to be invalidatable — but a simple "build once on module load, expose a `reset()` for tests" pattern would be cleaner. Defer if env stability isn't a concern.

**M-4 — CSRF protection grows `app.ts` to 257 lines; the hook + exempt configuration is 75 lines of inline logic.**

The CSRF block (lines 142-235) is most of the new size. The exempt-routes set, dynamic-exemption array, and `onRequest` hook are tightly coupled and ripe for extraction to `apps/server/src/security/csrf.ts` exporting `registerCsrfProtection(app)`. Keeps `app.ts` as a high-level wiring file; matches the existing pattern (`error-handler.ts`, `logger.ts`).

**M-5 — `csrf.test.ts` re-declares the exempt routes by hand inside `beforeAll`.**

Lines 27-45 register stub handlers for `/auth/login`, `/auth/forgot-password`, etc. — duplicating, by name, the production exempt list. If a route name changes in `app.ts` but not in the test, the test still passes (the stub matches itself). The whole point of integration testing is to catch drift. Either import the production exempt set (export it from `app.ts`) or, better, register the real route modules.

**M-6 — `TOTP code or backup code` description on `totpCode` is unhelpful at the API layer.**

Swagger consumers see `"TOTP code or backup code"` but the field accepts either a 6-digit numeric or a `[A-Z0-9-]{9}` backup code. Document the actual accepted formats or split into two optional fields with a `.refine` that requires one.

**M-7 — `disableTotpCode` is unconditionally cleared in `onSuccess` but not in error paths.**

`use-two-factor.ts:127`. On disable failure, the previously-entered TOTP code is retained in state. With 30-second TOTP windows, the retained code is likely already expired by the time the user retries. Reset on error too, or auto-clear when the user opens the modal.

**M-8 — `csrfToken` and `csrfFetchPromise` are module-level mutable state with no reset hook.**

`api.ts:21-22`. Mirrors the existing `isRedirecting` pattern (which has `__resetRedirectingForTest`). For consistency and testability, expose a `__resetCsrfForTest` guarded by `NODE_ENV === "test"`.

## Decomposition / file size

- **`app.ts`** (now 257 lines): single-responsibility erosion. App bootstrap is mixed with CSRF policy. Extract per M-4.
- **`proxy.ts`** (433 lines): the OAuth-redirect validation block (lines 18-77) is unrelated to proxy mechanics. Extract `isAllowedRedirectUrl` + `getAllowedRedirectHosts` to `apps/web/src/lib/redirect-validation.ts`. Tests already import from `./proxy.js` — they'd point to the new module instead. Small but improves cohesion.
- **`service.ts` (two-factor)**: 336 lines, growing. Now contains TOTP setup, verify, disable (×3 branches each), backup-code generation. Decomposition isn't urgent but `verifyToken` and `disable2FA` share the same backup-code-validation logic and same TOTP-construction boilerplate — extract `verifyTotpOrBackup(user, code): Promise<{ method: "totp" | "backup", updatedBackupCodes?: string }>`.
- **`csrf.test.ts`** (192 lines, 11 cases): fine.
- **`timing-safe.ts`** (14 lines): exemplary sizing.
- **`use-two-factor.ts`**: already split per Phase 4 convention; no concern.

## Security-specific verification

| Vector | Status |
|---|---|
| CSRF bypass via method case (`pOsT`) | Mitigated: `request.method.toUpperCase()` |
| CSRF bypass via query string trick (`/auth/login?x=y`) | Mitigated: `.split("?")[0]` |
| CSRF bypass via trailing slash (`/auth/login/`) | **Not mitigated** — see I-3 |
| CSRF bypass via case in path (`/Auth/login`) | Mitigated: Fastify is case-sensitive, would 404 first |
| CSRF bypass via path traversal (`/auth/login/../foo`) | Mitigated: Node parses path; `..` is normalized before reaching the hook |
| Double-submit replay | Mitigated by HMAC: token is bound to the cookie secret, can't be forged with knowledge of the cookie alone |
| Token leakage via `?csrf=` query | Mitigated: only `X-CSRF-Token` header is read |
| OAuth open-redirect | Mitigated: `isAllowedRedirectUrl` blocks unknown hosts; relative paths OK; protocol-relative blocked |
| `crypto.timingSafeEqual` throw on length mismatch | Mitigated for ASCII inputs only — see M-1 |
| Disable-2FA bypass via reused password | Mitigated by TOTP requirement (5.13) — **but the route is broken, see C-1** |

## SSR safety / frontend

- `typeof window === "undefined"` guards are correct in both `fetchCsrfToken` and the request interceptor.
- The interceptor does not register on server-side `apiInstance` consumers — Next.js server actions / RSC fetch via `fetch()` directly, bypassing `apiInstance`. **No server-side mutation paths exist** (verified via grep — all mutations go through `apiInstance`).
- Concurrent first-fetch deduplication: correct.
- Token rotation: correct in principle (cleared on 403), but over-eager — see I-7.
- Edge case missed: an inflight request that was sent with an old token but received a 403 will clear `csrfToken`, but does **not retry** with the new token. The user has to re-trigger the action. Acceptable for v1; document if not adding retry-once semantics.

## Tests

- **CSRF**: 11 cases, good coverage of basic behavior. Missing: real-route assertions (I-1), trailing-slash (I-3), token rotation (I-7), concurrent dedup (I-8).
- **timingSafe**: 6 cases including unicode and backup-code format. Missing: byte-length-mismatch with unicode (M-1).
- **OAuth redirect**: 7 cases, well-targeted. Missing: URLs with userinfo (`https://google.com@evil.com/`), URLs with non-default ports.
- **disable2FA (service)**: 3 cases covering happy path and the two rejection modes. **Missing the integration test that would have caught C-1.** Also missing backup-code-as-fallback success path.

## Assessment

**Verdict: do NOT merge as-is.** The disable-2FA endpoint is **broken in production** (C-1), and `/auth/register` has a real CSRF gap (C-2). Both are latent because the test surface stops at the service layer or uses synthetic routes. The spec-compliance review (above) caught BOM + missing exemption + missing refine; the code-quality review catches two further critical bugs that the spec reviewer's "✅ Spec compliant" verdict for Task 4 missed.

Counts: **2 critical** (C-1, C-2), **8 important** (I-1 to I-8), **8 minor** (M-1 to M-8).

The implementation has solid structural choices (double-submit pattern, request dedup, fail-closed redirect validation, env-based extension hooks, refine for distinct secrets) but is undermined by missing integration tests. The pattern of "test the service, don't test the route" hides route/schema bugs and should not be repeated.

### Required before merge

1. **Fix C-1**: add `totpCode` to the route-level body schema in `two-factor/routes.ts:120`. Add a route-level integration test using `app.inject({ method: "POST", url: "/2fa/disable", payload: { password, totpCode } })`.
2. **Fix C-2**: either move first-user bootstrap to a separate route, or gate the `/auth/register` exemption behind `usersCount === 0` at hook-evaluation time. Add a test asserting that `/auth/register` without a CSRF token returns 403 when at least one user exists.
3. **Fix I-3**: normalize trailing slash before the exempt check.
4. **Fix I-5**: add `.trim()` to `DisableSchema.totpCode`.

### Recommended

5. Extract CSRF setup to `security/csrf.ts` (M-4).
6. Replace `CSRF_EXEMPT_DYNAMIC` suffix patterns with a per-route `config.csrfExempt: true` flag (I-2).
7. Refine the 403→token-clear heuristic to match `FST_CSRF_INVALID_TOKEN` (I-7).
8. Add CSRF tests against real route definitions, including rotation/dedup (I-1, I-8).
