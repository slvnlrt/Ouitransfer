# Phase 5 — Batch 1 Review (Tasks 1-2)

**Reviewer:** Principal engineer (critical review mode)
**Scope:** commits `64e88eb` (Task 1) and `885804c` (Task 2)
**Method:** Read each modified file and compared against `docs/superpowers/plans/2026-05-11-phase-5-backend-hardening.md` lines 44–668. Ran the new test suites and `tsc --noEmit`.

## Spec Compliance Review

### Task 1: Server config hardening

#### 5.9 — `Math.random()` → `crypto.randomUUID()`
- ✅ `apps/server/src/modules/file/controller.ts:1,45-46` — `crypto` imported, `sanitizeFilename` + `crypto.randomUUID()` used.
- ✅ `apps/server/src/modules/file/multipart.controller.ts:1,25-26` — same pattern.
- ✅ `apps/server/src/config/directories.config.ts:1,51` — `crypto.randomUUID().slice(0, 8)` as specified.
- ✅ TDD test `apps/server/src/__tests__/server-config.test.ts` exists. Note: test fixture path uses `../../${file}` (line 13) rather than the spec's `../${file}` (test file is at `src/__tests__/`, two levels up from `src/modules/...` — implementer adjusted correctly).
- ✅ Test runs: 3/3 pass. Codebase-wide grep confirms no remaining `Math.random` outside the test file's own assertion strings.

#### 5.12 — Configurable PORT
- ✅ `apps/server/src/env.ts:21` — `PORT: z.coerce.number().int().min(1).max(65535).optional().default(3333)` matches spec exactly.
- ✅ `apps/server/src/server.ts:86,90` — uses `env.PORT` directly. No `parseInt`. The bind host is hardcoded to `"0.0.0.0"` which the spec accepts.

#### 5.7 — TRUST_PROXY env var + parseTrustProxy
- ✅ `apps/server/src/env.ts:31-35` — definition with `.transform(v => v.toLowerCase())` matches spec.
- ✅ `apps/server/src/app.ts:30-37` — `parseTrustProxy()` implementation matches spec character-for-character.
- ✅ `apps/server/src/app.ts:54` — `trustProxy: parseTrustProxy(env.TRUST_PROXY)`.

#### 5.8 — Gate Swagger / API docs
- ✅ `apps/server/src/env.ts:36` — `ENABLE_API_DOCS: z.union([z.literal("true"), z.literal("false")]).optional()` matches.
- ✅ `apps/server/src/app.ts:159-176` — `isDevMode || env.ENABLE_API_DOCS === "true"` gate; no else branch. Matches spec.
- ✅ Scalar registration is inside the same `if` block (dynamic import preserved).

#### 5.18 — `@fastify/helmet` + restrictive CSP + HSTS
- ✅ `apps/server/package.json:45` — `@fastify/helmet ^13.0.2` installed.
- ✅ `apps/server/src/app.ts:130-145` — registration with `defaultSrc: ['none']`, `frameAncestors: ['none']`, HSTS `maxAge: 31536000`, `includeSubDomains: true`. Matches spec.
- ⚠️ **Minor (ordering):** Helmet is registered AFTER `@fastify/rate-limit` (line 117) rather than as the first plugin. This works for HTTP response headers because Fastify still applies the `onSend` hook before the response leaves, but the convention is to register security headers as early as possible so that even error responses from earlier plugins carry them. Not a spec violation — spec only says "add early in `buildApp()` (before route registration)" and helmet is before route registration. Acceptable but worth noting if you later add `await app.register(...)` calls that send responses.

#### 5.19 — Per-route `bodyLimit: 64 KB`
- ✅ `apps/server/src/modules/auth/routes.ts:38,82,119,136,163` — 5 routes (`login`, `2fa/login`, `logout`, `forgot-password`, `reset-password`). Note the spec example mentions "Login, register, forgot-password, reset-password, 2FA endpoints" — there is no `register` route in `authRoutes`, but logout was added to keep the count at 5 auth routes. **This is a sensible deviation** since the spec count is "5 routes" and all five mutating POST endpoints in this router are now covered.
- ✅ `apps/server/src/modules/app/routes.ts:79,150` — 2 admin config PATCH routes (`PATCH /app/configs/:key`, `PATCH /app/configs`). Matches "admin (2 routes)" in the spec.
- ℹ️ `POST /app/test-smtp`, `POST /app/logo`, `DELETE /app/logo` (admin but not config-write/JSON) were correctly left without `bodyLimit` (logo upload would clash with 64 KB).

#### 5.20 — CORS fail-fast in production
- ✅ `apps/server/src/app.ts:99-104` — `throw new Error(...)` replaces the previous warn. Message matches spec. Throw happens before `app.register(fastifyCors)`, so the server cannot start mis-configured.

#### 5.21 — Presigned URL expiry split
- ✅ `env.ts:22-23` — both `PRESIGNED_URL_EXPIRATION` (default 3600) and `PRESIGNED_GET_URL_EXPIRATION` (default 900) defined with `z.coerce.number().int().min(60).max(86400)`.
- ✅ `modules/file/download.controller.ts:76` — uses `env.PRESIGNED_GET_URL_EXPIRATION`.
- ✅ `modules/reverse-share/service.ts:242` — uses `env.PRESIGNED_GET_URL_EXPIRATION` (`downloadReverseShareFile`).
- ✅ Upload paths preserved: `modules/file/controller.ts:47`, `modules/file/multipart.controller.ts:65`, `modules/reverse-share/upload.service.ts:69,124`, `modules/reverse-share/multipart.service.ts:71` all still use `PRESIGNED_URL_EXPIRATION` (PUT/part URLs).
- ✅ All `parseInt(env.PRESIGNED_URL_EXPIRATION, 10)` calls eliminated codebase-wide (grep confirms 0 matches).

### Task 2: Filename/Content-Disposition hardening

#### 5.17 — `filename*` priority parser
- ✅ `packages/shared/src/mime-types.ts:400-419` — two-pass parser. UTF-8 ext-value tried first inside `try/catch`, falls through on malformed percent-encoding. Then plain `filename=` (quoted | unquoted).
- ✅ `packages/shared/src/__tests__/mime-types.test.ts` — 9 tests, all pass (including M-3 charset fallback, malformed percent-encoding, null input).
- ❌ **Important (latent bug, also present in spec):** the plain-filename branch at `mime-types.ts:418` calls `decodeURIComponent(filename)` **without** a try/catch. A header such as `Content-Disposition: attachment; filename="50%off.pdf"` will throw `URI malformed` from a frontend proxy and propagate as an uncaught error. The spec sample has the same bug — both should wrap the second pass in `try/catch` mirroring the first pass. Recommended fix:
  ```ts
  if (filename) {
    try { return decodeURIComponent(filename); } catch { return filename; }
  }
  return null;
  ```
- ℹ️ **Minor (RFC strictness):** the regex `filename\*=UTF-8''([^;\s]+)` rejects RFC 5987 ext-values with a language tag (e.g. `UTF-8'en'caf%C3%A9.pdf`). These would fall through to `filename=`. Real-world senders rarely include the language tag, and the spec only requires UTF-8 with empty language, so this is acceptable.

#### 5.10 — `sanitizeFilename` utility
- ✅ `apps/server/src/utils/sanitize-filename.ts` — implementation matches spec line-for-line (path separators, null bytes, leading dots, trailing dots/spaces, Windows reserved with `^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i`, 255-byte UTF-8-safe truncation, fallback `"unnamed"`).
- ✅ `apps/server/src/utils/__tests__/sanitize-filename.test.ts` — 9 tests covering all spec cases. All pass.
- ✅ Wired into `modules/file/controller.ts:45` and `modules/file/multipart.controller.ts:25` — replaces the temporary inline `replace()` hack from Task 1.
- ℹ️ **Minor (potential strengthening, out of spec):** the Windows reserved-name regex doesn't include `AUX` in the spec docstring example but does include it in the code (line 18). Good — the spec docstring on lines 8 also says "CON, PRN, NUL, COM1-9, LPT1-9" missing AUX, but the code is correct. No bug.
- ℹ️ **Minor (consistency):** `directories.config.ts:49` still uses a hand-rolled `replace(/[^a-zA-Z0-9\-_./]/g, "_")` for temp-file naming. Not in scope for Task 1/2, but a follow-up could route it through `sanitizeFilename` for consistency.

#### 5.3 — Delete redundant `LoginSchema`
- ✅ `apps/server/src/modules/auth/dto.ts:15-19` — `LoginSchema` removed; `LoginInput` is now a plain `interface` matching the dynamic schema's output. Matches spec.
- ✅ `apps/server/src/modules/auth/controller.ts:9,30` — `LoginSchema` import removed; redundant `LoginSchema.parse(request.body)` replaced with `request.body as LoginInput`. Matches spec.
- ✅ Grep confirms no other `LoginSchema` server usages. The frontend has an unrelated `createLoginSchema` builder in `apps/web/src/app/login/schemas/schema.ts` — different symbol, different scope, correctly untouched.

## Verification

| Check | Result |
| --- | --- |
| `pnpm --filter ouitransfer-api type-check` | exit 0 |
| `pnpm --filter ouitransfer-api test src/__tests__/server-config.test.ts src/utils/__tests__/sanitize-filename.test.ts` | 12/12 pass |
| `pnpm --filter @ouitransfer/shared test` | 9/9 pass |
| `grep Math.random apps/server/src` | only in test assertion strings |
| `grep "parseInt(env\." apps/server/src` | 0 matches on presigned URL vars |

## Summary

- **Verdict: ✅ Spec compliant** for all 11 in-scope items (5.9, 5.12, 5.7, 5.8, 5.18, 5.19, 5.20, 5.21 / 5.17, 5.10, 5.3).
- **One latent bug worth fixing** that originates in the spec itself:
  - `packages/shared/src/mime-types.ts:418` — `decodeURIComponent` on the plain-filename branch is not wrapped in `try/catch`. A literal `%` in a quoted/unquoted `filename=` header throws `URI malformed`. **Recommendation:** wrap the second-pass decode and on failure return the raw filename string. This should be added to `audit/TODO-POST-PHASE-5.md` (Task 1/2 follow-up).
- **No extra/unneeded work** — implementer stayed within scope. The only deviation from spec wording is adding `bodyLimit` to `POST /auth/logout` instead of a non-existent `/auth/register`, which is the correct interpretation of "auth (5 routes)".
- **No misunderstandings** — every spec item is faithfully implemented; tests cover the spec's edge cases (M-2 trailing dots / Windows reserved / UTF-8 truncation, M-3 non-UTF-8 charset fallback).
- **Minor stylistic notes** (non-blocking):
  - Helmet registration order — after rate-limit rather than first. Functional but unconventional.
  - `directories.config.ts:49` still uses a bespoke sanitizer; could be unified with `sanitizeFilename` in a later pass.
  - The shared `decodeURIComponent` fragility is the only item that should land in the follow-up TODO.

---

## Code Quality Review

**Reviewer:** Principal engineer (critical review mode, second pass)
**Method:** Read every file in `git diff 06c21bb..HEAD`; cross-checked against existing code (`reverse-share/upload.service.ts`, `directories.config.ts`, server bootstrap) for consistency; ran `pnpm --filter ouitransfer-api test` (43 pass) and `pnpm --filter @ouitransfer/shared test` (9 pass).

### Strengths

- **`sanitizeFilename` is genuinely well-designed.** Order of operations is correct (separators → null bytes → leading dots → trailing dots/spaces → Windows-reserved → byte-length truncate → final trailing-dot re-strip after truncation). The post-truncation re-strip on line 53 is a thoughtful detail that prevents a truncated `"file.txt....."` from re-emerging as `"file.txt.."`. The `TextDecoder({ fatal: false })` + `\uFFFD` strip pattern at lines 48–51 is the correct way to UTF-8-truncate without corrupting multi-byte code points.
- **`parseTrustProxy` is small, pure, branch-tabulated, and well-documented.** The JSDoc enumerates every supported shape, which compensates for its low test coverage.
- **The two-pass `extractFilenameFromContentDisposition` matches the RFC 6266 precedence rule.** UTF-8-only restriction on `filename*` is the right safety/scope trade-off and is explicitly documented at line 394.
- **bodyLimit values are correct (64 KB).** Auth JSON payloads with bcrypt-bounded passwords + email fit comfortably; admin config patches (key/value strings) likewise. Logo upload and `test-smtp` are correctly excluded.
- **CORS fail-fast throws before `register(fastifyCors)`**, so a misconfigured prod deployment cannot accept traffic — this is the strict interpretation of "fail-fast".
- **`env.PORT` uses `z.coerce.number().int().min(1).max(65535)`** — strictly correct port range. No more `parseInt` ambiguity.
- **Presigned URL split is consistent across every call site.** All 7 call sites verified: PUT/part URLs still use `PRESIGNED_URL_EXPIRATION` (3600s), GET URLs use `PRESIGNED_GET_URL_EXPIRATION` (900s). No mis-wiring.
- **Tests are real assertions, not snapshots or smoke tests.** UTF-8 byte-boundary test, malformed percent-encoding test, M-3 charset fallback test all exercise concrete edge cases.

### Issues

#### Critical

None. No security regressions, no broken contracts, no data-corruption paths.

#### Important

1. **`parseTrustProxy` has zero behavioural test coverage.**
   `apps/server/src/__tests__/server-config.test.ts` only verifies that `Math.random()` has been removed from three files (`grep`-style assertions on file contents — see lines 11–16). The function `parseTrustProxy` is not exercised at all. It has five distinct branches:
   - `"true"` → `true`
   - `"false"` → `false`
   - `/^\d+$/` → `Number`
   - comma-separated → `string[]`
   - fallback → `string`

   A typo, a regex error, or a future "helpful" refactor would silently change Fastify's trust-proxy behaviour with no test failing. `trustProxy` is a security-relevant setting (it controls how IP addresses are derived from `X-Forwarded-For`, which then feeds rate-limit `keyGenerator` and any IP-based logic). It must be tested.

   **Fix:** add a unit test covering every branch and at least one edge case (whitespace in comma list, mixed casing). Pure function, ~10 lines of test. The function is currently file-private in `app.ts`; to test it cleanly, move it to `utils/parse-trust-proxy.ts` (single responsibility — `app.ts` shouldn't own utility parsing) and match the pattern just established for `sanitizeFilename`.

2. **`extractFilenameFromContentDisposition` will throw on a stray `%` in the plain-filename branch.**
   `packages/shared/src/mime-types.ts:418` calls `decodeURIComponent(filename)` without a try/catch. A response with `Content-Disposition: attachment; filename="50%off.pdf"` produces `URI malformed` — and because `extractFilenameFromContentDisposition` is consumed by `detectMimeTypeWithFallback` in the frontend proxy path (`apps/web` reads it via `@ouitransfer/shared/mime-types`), this surfaces as a 500 in the download proxy. The first pass at line 408 already has the right pattern; the second pass should mirror it.

   The spec compliance section above already noted this. I reiterate it under "Important" because:
   - it is a real, reachable runtime bug (not hypothetical),
   - it is in shipped code on `main` after this batch,
   - the fix is two lines.

   **Fix:**
   ```ts
   if (filename) {
     try { return decodeURIComponent(filename); } catch { return filename; }
   }
   return null;
   ```
   And add a test case: `filename="50%off.pdf"` → `"50%off.pdf"` (not a throw).

3. **`getTempFilePath` still uses a bespoke sanitizer instead of `sanitizeFilename`.**
   `apps/server/src/config/directories.config.ts:49` keeps the old `objectName.replace(/[^a-zA-Z0-9\-_./]/g, "_")` hand-roll. The whole point of extracting `sanitizeFilename` in 5.10 is to have a single trusted utility. Two sanitizers in the same codebase will drift — one already differs (this one preserves `/`, the other strips it; this one allows leading dots, the other strips them; this one does no length cap, the other caps at 255 bytes). The spec compliance section flags this as "out of scope". I disagree: 5.10 says "introduce `sanitizeFilename` and route untrusted filenames through it" — `getTempFilePath` is called from filesystem upload paths and is fed by user-controlled object names. It is in scope.

   **Fix:** replace the inline regex with `sanitizeFilename(objectName)`. Note that `sanitizeFilename` strips `/` (keeps only basename), which is the correct behaviour for a temp-file segment — the current regex preserves `/` and could produce embedded subpaths in a temp filename, which is exactly the kind of path-traversal-shaped surface this phase is meant to close.

   If preserving the existing behaviour is intentional, at minimum document why a second sanitizer must exist.

4. **`reverse-share/upload.service.ts:66,121` also still uses a bespoke sanitizer.**
   Same problem as #3. `.replace(/[^a-zA-Z0-9._-]/g, "_").substring(0, 100)` — different ruleset, different length cap, allows leading dots, doesn't handle Windows reserved names, doesn't strip null bytes. The reverse-share endpoint is **anonymous user input** (no auth), which is the highest-risk surface in the app. If `sanitizeFilename` is the trusted utility, it must be used here.

   **Fix:** `const sanitizedFilename = sanitizeFilename(filename).slice(0, 100);` (or remove the 100-cap entirely — `sanitizeFilename` already caps at 255 bytes). Apply to both `getPresignedUrlById` (line 66) and `getPresignedUrlByAlias` (line 121).

   This is the same item as 5.10, in a different file. It is not "follow-up work for a later phase" — it is the literal scope of the item.

#### Minor

5. **Helmet registered after rate-limit.** The spec compliance section notes this. Practical risk: if `@fastify/rate-limit` ever sends a `429` from its internal handler, that response won't carry the helmet headers. For an API-only server this is cosmetic, not exploitable. Acceptable, but the convention exists for a reason — register `helmet` first. Trivial reorder.

6. **`server-config.test.ts` is a content-grep, not a unit test.** Lines 11–16 read the file as text and assert it doesn't contain the substring `"Math.random()"`. This is regression-prevention, not behavioural validation. It would pass if someone wrote `Math["random"]()` or `const random = Math.random; random()`. The test serves as documentation of intent and is fine for a chore-type item like 5.9, but it should be named honestly — rename to `crypto-uuid-migration.test.ts` and add a top-level comment explaining "static check, not a behavioural test." Or, better: replace it with a real test that exercises one of the call sites (e.g. assert generated `objectName` matches `/^userId\/[0-9a-f-]{36}-/`).

7. **`parseTrustProxy` doesn't validate numeric range.** `Number("99999999999")` returns a finite number; Fastify will accept it and use it as a hop count, which is meaningless but not an error. Not a security issue. If you want to harden: `const n = Number(value); if (Number.isInteger(n) && n >= 0 && n <= 32) return n;` and fall through otherwise. Genuinely minor.

8. **`sanitizeFilename` correctly handles dot-only inputs (verified, no action needed).** Filenames consisting only of dots — the leading-dot regex `^\.+` eats all leading dots, the trailing dot/space regex `[.\s]+$` would then turn the empty remainder back into `""` → `"unnamed"`. Confirmed by test line 22 (`"file..."` → `"file"`) and the empty-fallback path. Leaving this bullet in to record verification rather than glossing over it.

9. **`bodyLimit: 64 * 1024` is duplicated five times in `auth/routes.ts` and twice in `app/routes.ts` as a magic value.** Borderline by the rule of three. If more routes get the same limit in Phase 5, lift to `apps/server/src/constants/limits.ts`. Not blocking.

10. **`docsEnabled` gate has no test.** A regression that flips the polarity (`isDevMode && env.ENABLE_API_DOCS === "true"` instead of `||`) would silently disable Swagger in development. The risk is low (devs would notice immediately), but the test would be a 3-line `app.inject()` assertion: hit `/docs` in test env, expect 200; flip env and expect 404. Worth ~10 minutes.

11. **`@fastify/helmet` CSP `defaultSrc: ['none']` will block the Swagger UI's own assets if a browser enforces CSP.** Swagger UI loads JS/CSS from its own route; with `defaultSrc: 'none'` and no other directives, the Swagger UI page may fail to render. Swagger is gated behind `ENABLE_API_DOCS` so in prod default this is fine. Worth verifying manually: open `http://localhost:3333/swagger` in a browser after this change and confirm it renders. If not, add a per-route helmet override or relax the CSP on the docs routes specifically. Not blocking but a likely follow-up.

### Assessment

**Verdict: Solid implementation with three Important issues (and one shared-utility duplication, also Important) that should be fixed before closing Phase 5.**

The two batches are spec-compliant and the new code (especially `sanitizeFilename`) is among the cleanest in the codebase. But:

- **`parseTrustProxy` untested** is unacceptable for a security-relevant utility introduced in a security-hardening phase. Phase 5's whole purpose is hardening; shipping an untested parser that controls how IPs are derived contradicts the phase's purpose.
- **Two parallel sanitizers** (`directories.config.ts` and `reverse-share/upload.service.ts`) are still present after 5.10 was supposed to consolidate filename hardening. The reverse-share one is reachable by anonymous users — exactly the surface 5.10 exists to harden. The spec-compliance pass labeled these "out of scope" or "follow-up"; on a plain reading of 5.10 they are in scope.
- **`decodeURIComponent` without try/catch** in the second pass of `extractFilenameFromContentDisposition` is a reachable runtime bug already on `main`. Two-line fix.

None of this is critical (no security hole introduced, no broken contracts), but the Important issues collectively undermine the "perfect implementation, zero technical debt" standard set in CLAUDE.md. Recommend fixing all four Important items in this batch's cleanup pass rather than carrying them to TODO-POST-PHASE-5.

The Minor items are genuine minor — flag them, fix the easy ones (helmet order, constants extraction if more accumulates), defer the rest.