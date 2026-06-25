# Review: TD-28 — Zod v3 → v4 Migration

**Reviewer:** Code Review Agent
**Date:** 2026-06-10
**Commits:** b983e8d..a91bc90

## Verification Performed
- Read the full diff (`b983e8d~1..a91bc90`, excluding lockfile) and every key file.
- Inspected the installed `@fastify/type-provider-zod@1.0.0` source (`dist/esm/errors.js`) to confirm the runtime validation-error shape.
- Ran behavioral probes against the installed Zod v4.4.3 for `coerce`, `.default()`, `.pipe()`, `z.input`, `.describe()`.
- Ran `pnpm --filter @ouitransfer/server test --run` → **exit 0** (all pass).
- Ran `pnpm --filter @ouitransfer/server run type-check` → **exit 0**.
- Ran `pnpm --filter @ouitransfer/web run type-check` → **exit 0**.
- Grepped the whole monorepo for residual v3-isms (`z.NEVER`, `ZodIssueCode`, `required_error`, `invalid_type_error`, `errorMap`, single-arg `z.record`) → none remain.

## Strengths
- **Error-handler shape change is correct.** `dist/esm/errors.js:38-51` (`createValidationError`) emits `instancePath: "/" + issue.path.join("/")` and `message`. The handler at `apps/server/src/utils/error-handler.ts:106-109` reads exactly those fields and rebuilds the dotted path via `replace(/^\//,"").replaceAll("/", ".")`, with a sensible `|| "unknown"` fallback for top-level issues (empty `path`). Verified against the package internals, not just the test mock.
- **Test mock faithfully mirrors the real shape.** `error-handler.test.ts:85-96` now matches `createValidationError` (incl. `schemaPath` with the trailing `/<code>` segment and empty `params`), so the unit test exercises the genuine v1 contract rather than a stale v3 shape.
- **Clean, exhaustive find-and-replace.** All 26 import sites switched to `@fastify/type-provider-zod`; the `zod@^4.0.0` pin override was correctly dropped from `pnpm-workspace.yaml:5-8` since the catalog (`:34`) now resolves v4 directly. No leftover dual-package state.
- **`z.NEVER` → `undefined as never`** in `quota-schema.ts` is the correct v4 idiom for "abort transform after `addIssue`" and preserves the original control flow exactly.
- **`required_error`/`invalid_type_error` → `error` function** in `file/dto.ts:9-10,21-22` correctly reproduces the v3 dual-message behavior using `issue.input === undefined` to distinguish "missing" from "wrong type".

## Issues

### Critical (Must Fix)
_None._ (The migration compiles, all tests pass, and no runtime-breaking v3-ism remains.)

### Important (Should Fix)
- [x] **`z.coerce.boolean()` silently inverts `?force=false` into a destructive delete** (`apps/server/src/modules/file/routes.ts:943`, `apps/server/src/modules/folder/routes.ts:609`) — In Zod v4, `z.coerce.boolean()` uses JS `Boolean()` semantics: **any non-empty string is `true`**, so the literal string `"false"` coerces to `true`. Verified empirically: `z.coerce.boolean().safeParse("false").data === true`. Both routes gate a destructive cascade (delete a file/folder that still belongs to active shares) on `force`. A direct API/Swagger client that calls `DELETE /api/files/:id?force=false` — the natural way to express "no, don't force" — will silently bypass the 409 guard and **permanently delete shared content**. The first-party web client happens to be safe today because it only ever sends `?force=true` or omits the key (`apps/web/src/http/endpoints/files/index.ts:117`, `folders/index.ts:69`), but the public OpenAPI contract is now actively dangerous for a destructive operation. This is a real v4 semantic change that the migration's "coerce was assessed" claim missed.
  **Fix:** replace `z.coerce.boolean()` with an explicit string→boolean parse that only treats `"true"` as true, e.g.
  ```ts
  force: z
    .enum(["true", "false"])
    .optional()
    .default("false")
    .transform((v) => v === "true"),
  ```
  (or a shared `booleanQueryParam` helper, since both routes need it). Add an integration test asserting `?force=false` yields 409 — see the test-gap item below.

- [x] **Test coverage gap: `?force=false` is never exercised** (`apps/server/src/__tests__/file-delete-share-check.integration.test.ts`, `folder-delete-share-check.integration.test.ts`) — Both suites only test `force=true` and `force` omitted; neither tests the explicit-false case, which is precisely the path the v4 coercion broke. This gap is *why* the bug above slipped through. After fixing the coercion, add a test: "returns 409 when file/folder belongs to a share and `?force=false` is passed explicitly."

### Minor (Nice to Have)
- [x] **Inconsistent coerce pattern left behind** (`apps/server/src/modules/config/config-validation.ts:131`) — The migration deliberately rewrote `intMin` from `.pipe(z.coerce.number(...))` to `.transform(Number).pipe(z.number(...))` (lines 56-62), but `auditRetentionDaysSchema` two functions down still uses bare `z.coerce.number()`. I verified both forms are behaviorally identical in v4 (same NaN rejection, same custom-message propagation), and the `auditRetentionDays` validator additionally pre-guards the empty string at line 143, so this is **not a bug** — only a style inconsistency. Either revert `intMin` to the simpler `z.coerce` form (since the change was a behavioral no-op) or align `auditRetentionDaysSchema` to the new pattern, so the file doesn't teach two idioms for the same thing. The simpler `z.coerce.number()` is fine to keep.
- [x] **`.describe()` (620 uses) and `.email()`/`.url()` instance methods (37 uses) are deprecated-but-functional in v4** — Left as-is. They compile and work (verified `z.string().describe("x").description === "x"`). Not a ticking time bomb for *this* migration, but they will break on the eventual v5 major. Worth a tracked follow-up (TECHNICAL-DEBT) to codemod `.describe()` → `.meta({ description })` and `.email()`/`.url()` → `z.email()`/`z.url()` rather than discovering 657 call sites under v5 pressure. Not required for TD-28.
- [x] **`z.input<>` (3 uses, `auth-providers/dto.ts:121-131`) correctly unchanged** — Confirmed still valid in v4 (compile-time only; type-check passes). No action; noting for completeness since it was a review focus.

## Recommendations
1. Introduce a single shared `booleanQueryParam` schema helper (e.g. in `apps/server/src/shared/`) and use it everywhere a boolean is parsed from a query string. `z.coerce.boolean()` should be considered banned in this codebase for query/string inputs — its v4 semantics are a footgun for exactly the kind of "false-means-false" intent these flags carry.
2. Add a lint guard (Biome/grep CI step) forbidding `z.coerce.boolean(` to prevent regressions.
3. File the `.describe()`/`.email()`/`.url()` deprecation cleanup as a low-priority TD item so the v5 jump isn't a cliff.

## Assessment
**Ready to merge?** With fixes.
**Reasoning:** The mechanical migration is thorough and correct — imports, error-handler shape, `z.NEVER`/`ZodIssueCode`/`z.record`/`required_error` rewrites all verified against package internals and a green test + type-check run. The one substantive defect is the missed `z.coerce.boolean()` semantic change, which turns `?force=false` into a destructive delete on two routes; it's shielded from the first-party UI but breaks the public API contract on irreversible operations, so it must be fixed (plus the accompanying `force=false` test) before merge.
