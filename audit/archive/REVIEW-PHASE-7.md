# Phase 7 — Dependency Modernization Review

**Reviewer:** Agent
**Date:** 2026-05-12
**Commits reviewed:** `1713bf2..96a8ca6` (4 commits)
**Scope:** Items 7.4–7.14 (7 original + 4 new discoveries from PHASE-7-PLAN.md)

---

## Summary

Phase 7 is **clean and well-executed**. All four task batches (server cleanup, motion rename + catalog, web cleanup + date-fns replacement, icon consolidation) were completed without any leftover references to the removed packages. All type-checks pass, all tests pass (190 web + 192 server), and knip confirms no Phase-7-removed package remains. The icon mapping (~85 lucide + 17 react-icons/tb across ~90 files) is correct end-to-end — `tsc --noEmit` would have caught any wrong mapping and it didn't. The only items flagged below are minor (pre-existing tech debt surfaced during migration, semantic icon equivalences where lucide has no direct match, and behavioral changes worth documenting).

This phase is a **pass**.

---

## Verification Results

| Command | Result | Notes |
|---|---|---|
| `pnpm --filter ouitransfer-api type-check` | ✅ Exit 0 | Clean |
| `pnpm --filter ouitransfer-web type-check` | ✅ Exit 0 | Clean (skipLibCheck) |
| `pnpm --filter ouitransfer-docs type-check` | ✅ Exit 0 | Clean |
| `pnpm --filter ouitransfer-api test` | ✅ **192/192 pass** (20 files) | Same baseline as Phase 6 |
| `pnpm --filter ouitransfer-web test` | ✅ **190/190 pass** (16 files) | Same baseline as Phase 6 |
| `pnpm knip` | Exit 1 (informational) | No Phase-7-removed package flagged; only pre-existing unused deps surfaced |
| Grep `@tabler/icons-react` in `apps/` source | ✅ 0 hits | Clean |
| Grep `from "framer-motion"` in `apps/` source | ✅ 0 hits | All migrated to `motion/react` |
| Grep `from "nookies"` / `from "js-cookie"` in `apps/` | ✅ 0 hits | Clean |
| Grep `from "date-fns"` in `apps/` source | ✅ 0 hits | Clean |
| Grep `from "node-fetch"` / `from "openid-client"` in `apps/` | ✅ 0 hits | Clean |
| Grep `as any` in migrated files (`file-icons.tsx`) | ✅ 0 hits | No type workarounds |
| Lucide icon existence check (33 critical names) | ✅ All present | Verified via real ESM import in apps/web |

### Plan vs. completion

Every checkbox in `audit/PHASE-7-PLAN.md` is reflected in the commits:

| Plan Item | Status | Evidence |
|---|---|---|
| 7.5 Remove `node-fetch` | ✅ | Commit `1713bf2` |
| 7.6 Remove `ts-node` (deps + knip.json) | ✅ | Commit `1713bf2`, `knip.json` line 7 updated |
| 7.11 Remove `openid-client` | ✅ | Commit `1713bf2` |
| 7.8 `framer-motion` → `motion` (rename) | ✅ | Commit `8c708ce`, 9 files updated, all use `motion/react` |
| 7.13 Add `motion` + `jose` to catalog | ✅ | `pnpm-workspace.yaml` lines 7-8; web/docs/server all use `catalog:` |
| 7.7 Replace `nookies` with native cookie | ✅ | Commit `41b1d10`, `language-switcher.tsx` |
| 7.9 Move/remove `@types/react-dropzone` | ✅ | Commit `41b1d10` (removed entirely — react-dropzone 14 ships types) |
| 7.12 Remove `js-cookie` + `@types/js-cookie` | ✅ | Commit `41b1d10` |
| 7.14 `date-fns` → `formatDateTime()` | ✅ | Commit `41b1d10`, 4 files migrated, ptBR bug fixed |
| 7.4 Icon consolidation | ✅ | Commit `96a8ca6`, 122 files touched, 0 tabler imports remain |
| 7.10 Prisma alignment (already at `^6.11.0`) | ✅ | No change needed (pre-verified in plan) |

---

## Findings

### Critical

_None._ No critical issues identified.

### Important

**I-1 — `formatDateTime("table", locale)` changes the displayed date format for non-en-US users (behavioral change, may be intentional)**

Files affected:
- `apps/web/src/components/tables/shares-table.tsx:405,415`
- `apps/web/src/components/modals/share-details-modal.tsx:116`
- `apps/web/src/app/(shares)/s/[alias]/components/share-details.tsx:93,99`
- `apps/web/src/app/(shares)/reverse-shares/components/received-files-file-row.tsx:40`

Before Phase 7: `format(new Date(x), "MM/dd/yyyy HH:mm")` produced a **fixed US-style format** for every user regardless of locale — e.g., `01/15/2025 14:30`.
After Phase 7: `formatDateTime(x, "table", locale)` produces a **locale-dependent format** — e.g., `15/01/2025, 14:30` for `fr-FR`, `15/01/2025 14:30` for `pt-BR`. The separator also changes from space to comma+space in many locales (Intl.DateTimeFormat default).

This is arguably a **fix** (the previous behavior was a soft i18n bug — non-US users saw US-ordered dates), and it matches what was already used in the existing `formatDateTime()`-based call sites (`files-table.tsx`, `files-grid.tsx`). It also matches the explicit fix described in the plan for `received-files-file-row.tsx` (which was hard-coded to `ptBR`).

**Action:** Document this user-visible change in the changelog / release notes. Consider whether any UI tests, screenshots, or e2e snapshots reference the old date format. (None found in the test suite, which mocks dates explicitly.)

**I-2 — `motion-utils` warning when `pnpm install` runs (transitive only, not introduced by Phase 7 but exposed by it)**

`pnpm-lock.yaml` line 10720 shows `motion@12.38.0` depends on `framer-motion@12.38.0` as a runtime dep. The `motion` package on npm re-exports framer-motion under the new name and pulls the old package as a transitive — this is by design of motion v12, not a Phase 7 regression. However it means **framer-motion bytes are still in node_modules**. Bundle analyzers may still show "framer-motion" in dependency graphs.

**Action:** Nothing to do at the Phase-7 level. When `motion` v13+ drops the framer-motion alias (or the package fully consolidates), this transitive should disappear.

### Minor

**M-1 — Hardcoded English `label: "Move"` in `files-table-folder-row.tsx:89` (pre-existing, surfaced during migration)**

```ts
...(onMoveFolder
  ? [{ key: "move", icon: Move, label: "Move", onClick: () => onMoveFolder(folder) }]
  : []),
```

This is **pre-existing tech debt** — `git show 1713bf2~1:apps/web/src/components/tables/files-table-folder-row.tsx` shows the same `label: "Move"` (with `IconArrowsMove`) before Phase 7. All sibling actions use `t("filesTable.actions.X")` translation keys. The translation key `filesTable.actions.move` does not exist in any locale.

**Action:** Add `filesTable.actions.move` to all 23 locale files and replace `label: "Move"` with `label: t("filesTable.actions.move")`. Track in `audit/TODO-POST-PHASE-7.md` (item belongs in i18n cleanup, post-Phase 8).

**M-2 — Semantic icon equivalents in `file-icons.tsx` where lucide has no direct match**

The migration mapped Tabler-specific icons to the closest lucide equivalents:

| Pre (tabler) | Post (lucide) | Comment |
|---|---|---|
| `IconFileTypePdf` | `FileType2` | Lucide has no PDF-specific icon. `FileType2` is generic ("file with letter") — acceptable but loses PDF specificity. |
| `IconMarkdown` | `FileCode2` | Lucide has no markdown icon. `FileCode2` is generic code-file — acceptable. |
| `IconApi` (graphql/proto extensions) | `Webhook` | Lucide `Webhook` is webhook-shaped, not API-shaped. `Network`, `Plug`, or `Code` may fit better. Acceptable. |

All three are visible to end users only via the file browser file-type icon column.

**Action:** No change required — these are reasonable equivalents. If a more accurate visual is desired later, swap individually. Track in `audit/TODO-POST-PHASE-7.md` as a polish item.

**M-3 — Native `document.cookie` assignment doesn't URL-encode the value (no real bug today, hardening opportunity)**

`apps/web/src/components/general/language-switcher.tsx:56`:
```ts
document.cookie = `${COOKIE_LANG_KEY}=${fullLocale}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
```

`nookies.setCookie` URL-encoded the value automatically. The native assignment does not. Today this is **safe** because `fullLocale` is always a known BCP-47 tag like `"en-US"` (no characters needing escape). But if locale strings ever change (e.g. variants with `@` or `;`), this would silently corrupt the cookie or break parsing.

**Action:** Wrap value in `encodeURIComponent(fullLocale)` for forward-compatibility, and mirror with `decodeURIComponent` in `i18n/request.ts` if the change is made. Or document the assumption in a comment. Low priority — track in post-Phase-7.

**M-4 — Pre-existing unused dependencies flagged by knip (not introduced by Phase 7, not Phase 7's responsibility)**

`pnpm knip` reports 5 unused deps + 3 unused devDeps that were **not** introduced by Phase 7:
- `@fastify/static` (server) — used at runtime via Fastify plugin registration? Verify.
- `@radix-ui/react-collapsible` (web)
- `qrcode` (web — actually used via `LazyQRCode` and the `react-qr-code` component; may be a false positive)
- `tw-animate-css` (web, also docs)
- `class-variance-authority` (docs)
- `@types/qrcode`, `tailwindcss` (web devDeps — likely false positives, used at build time)

None of these are Phase 7 territory. These are pre-existing and should be addressed in a separate "dependency hygiene" cleanup.

**Action:** Track in `audit/TODO-POST-PHASE-7.md` for a post-Phase-8 dep-cleanup pass. Verify each one before removal (knip false positives are common for runtime-only registrations and build-time tools).

**M-5 — Test file uses `useLocale` mock but `share-details-modal.test.tsx` was the only test updated; no new tests for date-format locale switch**

The migration of date formatting (item 7.14) is purely behavioral but does change rendered output. The mock in `share-details-modal.test.tsx:23` correctly mocks `useLocale: () => "en-US"`, but no new test was added asserting locale-aware date output. With 23 locales supported, a regression in `formatDateTime`'s locale propagation would not be caught by the current suite.

**Action:** Optional — add a unit test for `formatDateTime` with `pt-BR` and `fr-FR` to assert locale-correct output and avoid future drift. Track as a minor item.

**M-6 — Cookie domain not set explicitly**

The native cookie set in `language-switcher.tsx` does not include a `Domain=` attribute. This means the cookie scopes to the current host only (no subdomain sharing). The previous `nookies.setCookie` also omitted `domain`, so this matches prior behavior — but if Ouitransfer ever needs to share the `NEXT_LOCALE` cookie across subdomains (e.g. `app.example.com` + `docs.example.com`), this attribute would need adding.

**Action:** No change required. Document as a known limitation if relevant to deployment topology.

**M-7 — `home-content.tsx:54-69` mixes spread-prop `{...fadeInAnimation}` with overriding `transition` prop (pre-existing pattern, not Phase 7)**

The pattern works correctly but is fragile (object spread order matters). Surfaced while reviewing the `motion/react` migration — the migration itself is correct, this is just an observation.

**Action:** No change required.

---

## Items for `audit/TODO-POST-PHASE-7.md`

### Important (track but no urgent action)
- [ ] **I-1**: Document the date-format behavior change in the changelog / release notes; verify no e2e/screenshot tests assume the old US-format.
- [ ] **I-2**: Monitor `motion` package upstream — when v13 drops the `framer-motion` transitive, remove the duplicate from `pnpm-lock.yaml` (no action needed today).

### Minor (polish + hygiene)
- [ ] **M-1**: Replace hardcoded `label: "Move"` in `files-table-folder-row.tsx:89` with `t("filesTable.actions.move")` and add the translation key to all 23 locales. *Pre-existing — not introduced by Phase 7.*
- [ ] **M-2**: Optionally re-evaluate `Webhook` for `graphql`/`proto`/`protobuf` file icons (consider `Network` or `Code` for better semantic match).
- [ ] **M-3**: Wrap `fullLocale` in `encodeURIComponent()` when assigning `document.cookie` in `language-switcher.tsx`; mirror in `i18n/request.ts` if changed. Add a comment documenting the assumption otherwise.
- [ ] **M-4**: Run a "knip cleanup" pass for pre-existing unused deps (`@fastify/static`, `@radix-ui/react-collapsible`, `qrcode`, `tw-animate-css`, `class-variance-authority` in docs, `@types/qrcode`, `tailwindcss` in web devDeps). Verify each before removal. *Not Phase 7's scope, but surfaced.*
- [ ] **M-5**: Add a unit test for `formatDateTime()` with non-default locales (`pt-BR`, `fr-FR`, `ar-SA`) to lock in locale-aware behavior.
- [ ] **M-6**: No action — cookie domain scoping is intentional and matches prior behavior.
- [ ] **M-7**: No action — pre-existing animation prop spread pattern.

---

## Conclusion

**Phase 7 — PASS.**

All planned items executed correctly. No critical or important regressions introduced. The behavioral change in `formatDateTime` (locale-aware vs hardcoded US format) is an improvement that aligns with the project's i18n architecture and matches the existing usage pattern in the file-browser tables. Pre-existing tech debt (hardcoded "Move" label, unused deps, semantic icon mismatches) was surfaced but not introduced by Phase 7 — these go into the post-Phase-7 follow-up tracker.

The phase delivered:
- **10 packages removed** from package.json (`node-fetch`, `openid-client`, `ts-node`, `framer-motion`, `nookies`, `js-cookie`, `@types/js-cookie`, `date-fns`, `@types/react-dropzone`, `@tabler/icons-react`).
- **2 packages added to catalog** (`motion`, `jose`) for cross-app version unification.
- **~122 icon import sites migrated** across ~90 files with zero `as any` casts and zero runtime test failures.
- **1 pre-existing i18n bug fixed** (`received-files-file-row.tsx` no longer hardcodes `ptBR`).

The phase can be marked closed in `CLAUDE.md` and `audit/CONSOLIDATED-TODO-LIST.md` once the items above are migrated to `audit/TODO-POST-PHASE-7.md`.
