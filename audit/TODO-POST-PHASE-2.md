# Phase 2 — Post-Review Follow-ups

> Items identified by reviewers during Phase 2 Architecture Restructuring verification.
> C1, C2 fixed immediately after review. W2-W8, W11-W12, S8-S9, S12-S13 fixed in follow-up batch.
> Remaining items (W1, W9, W10) are non-actionable guidance — forwarded to relevant future phases.

---

## Critical Issues (Fixed Immediately)

- [x] **C1 — shared package ESM/CJS incompatibility** — Resolved via full ESM migration: added `"type": "module"` to server, migrated all 59 server files (~152 relative imports) to `.js` extensions, `require()` → dynamic `import()`, shared package now builds with tsc, turbo pipeline updated with `dev.dependsOn: [^build]`
  - Files: `apps/server/package.json`, all `apps/server/src/**/*.ts`, `packages/shared/tsconfig.json`, `packages/config/tsconfig/server.json`, `turbo.json`

- [x] **C2 — `body: "raw"` missing `duplex: "half"` flag** — Extended condition to set `duplex: "half"` for both `body: "raw"` and `body: "duplex"` (both stream `req.body` as ReadableStream)
  - File: `apps/web/src/lib/proxy.ts`

---

## High Priority

- [x] **W11 — Dockerfile runtime stage missing packages/shared/dist/** — Added `COPY --from=server-builder /app/packages ./packages` in the runner stage
  - File: `Dockerfile`

---

## Medium Priority

- [x] **W2 — allResponseHeaders forwards hop-by-hop headers** — Added `HOP_BY_HOP_HEADERS` filter set, use `.append()` for Set-Cookie
  - File: `apps/web/src/lib/proxy.ts`

- [x] **W3 — DELETE methods now send empty JSON body** — Skip body/Content-Type for DELETE unless bodyTransform is configured
  - File: `apps/web/src/lib/proxy.ts`

- [x] **W4 — NextResponse.redirect coerces to 307** — Replaced with `new NextResponse(null, { status: apiRes.status, headers: { location } })`, resolves relative URLs
  - File: `apps/web/src/lib/proxy.ts`

---

## Low Priority

- [x] **W5 — Abort timeout timer leaks on error** — Replaced manual setTimeout/clearTimeout with `AbortSignal.timeout()` (subsumed by W6)
  - File: `apps/web/src/lib/proxy.ts`

- [x] **W6 — Client disconnect not propagated to backend** — Now always forwards `req.signal`; combined with `AbortSignal.any([req.signal, AbortSignal.timeout()])` when timeout configured
  - File: `apps/web/src/lib/proxy.ts`

- [x] **W7 — reverse-shares/files/:fileId GET dead route** — Deleted the unused route entry
  - File: `apps/web/src/lib/proxy-routes.ts`

- [x] **W8 — Dead endpoint definitions for folders/check and auth/oidc** — Deleted `checkFolder`, `getOIDCConfig`, `initiateOIDCLogin` functions and their associated types (no callers found)
  - Files: `apps/web/src/http/endpoints/folders/index.ts`, `types.ts`, `apps/web/src/http/endpoints/auth/index.ts`, `types.ts`

- [x] **W12 — wrapFiles silently drops data on missing key** — Added `Array.isArray()` validation, throws descriptive error if key missing
  - File: `apps/web/src/lib/proxy-routes.ts`

- [ ] **W1 — OAuth authorize response shape changed** — *Not a code fix; forwarded to Phase 8 for QA validation*
  - Needs end-to-end test of OAuth authorize flow to verify `text()` vs `json()` handling

- [ ] **W9 — Keep subpath export pattern for shared package** — *Architectural guidance; forwarded to Phase 3*
  - When adding utilities to `packages/shared`, use subpath exports (`./foo`) not barrel `"."` export

- [ ] **W10 — Dockerfile pnpm symlink chain fragility** — *Future improvement; forwarded to Phase 6*
  - Consider `pnpm deploy` for portable runtime when Docker setup is overhauled

---

## Suggestions

### Fixed

- ~~**S8 — Dockerfile npx vs pnpm**~~ — Standardized to `pnpm exec` and `pnpm run build`
- ~~**S9 — biome.json excludes comment**~~ — Added `_comment` field explaining shadcn/ui generated files
- ~~**S11 — shared tsconfig noEmit contradiction**~~ — Fixed during C1 ESM migration
- ~~**S12 — server tsconfig outDir/rootDir cleanup**~~ — Removed from base preset (resolved relative to wrong location). Kept in child configs where they're necessary and correct
- ~~**S13 — API_BASE_URL trailing slash**~~ — Added `.replace(/\/+$/, "")` defensive trim

### Forwarded to Future Phases

- **S1 → Phase 8** — Route matcher O(n) perf; fine at 122 routes, optimize if growth
- **S2 → Phase 3** — Route ordering maintenance trap; add unit test to verify route resolution
- **S3 → Phase 5** — Inconsistent cookie:false on public endpoints; standardize
- **S4 → Phase 5** — X-Forwarded-For trust; already covered by item 5.7 (trustProxy config)
- **S5 → Phase 3** — extractFilenameFromContentDisposition regex cleanup
- **S6 → Phase 5** — Redirect URL validation; defense in depth for OAuth flows

### Not Actionable

- **S7** — packages/config and packages/shared have no version metadata. Fine for private workspace packages.
- **S10** — Catalog could cover more single-app deps. Consistent with "2+ apps" rule. No change needed.
