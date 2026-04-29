# Phase 4 — Frontend Modernization — Execution Plan

> Total: ~40h estimated, 15 items
> Goal: Server-state management, error boundaries, performance, accessibility.

## Execution Order

### Batch 1 — Deduplication cleanup (5h) ✅ DONE
- **4.14** — Extract shared UI primitives (EditableField, ItemActions, useEditableItem, useSelectionManager, formatDateTime) — 6 consumer files reduced by 797 lines
- **4.15** — Consolidate 29 duplicate File/Folder type interfaces (10 exact→imports, 13 subsets→Pick<>, 4 dead removed, 1 kept for API null boundary)

### Batch 2 — Error/Loading boundaries (4h) ✅ DONE
- **4.1** — error.tsx boundaries (ErrorDisplay component, reportError utility, global-error.tsx, error.tsx, not-found.tsx, share-specific errors, settings refactored; 25 tests)
- **4.2** — loading.tsx (self-contained CSS spinner, no provider dependency)
- **Cleanup** — 3 ad-hoc error UIs replaced with ErrorDisplay (ShareNotFound deleted, login "no auth methods", storage-usage error state)

### Batch 3 — Server-state management (16h) ✅ DONE
- **4.3** — TanStack Query v5 integration — query-client (smart retry), query-keys (hierarchical, 10 domains), QueryProvider. 13 hooks + 6 components migrated to useQuery/useMutation. 28 new tests.
- **4.4** — Axios 401 interceptor — hard-nav to /login, skips auth+public pages, anti-cascade flag
- **4.5** — State unification — 2 zustand stores eliminated (useAppInfo, useHomeStore), ShareContext eliminated, AuthContext backed by TQ queries
- **Not migrated (by design)**: upload workflows (imperative), auth callbacks (one-shot), download-url-cache (own TTL), component-level modal mutations (already work via invalidateQueries)

### Batch 4 — Performance (8h) ✅ DONE
- **4.6** — Lazy fonts — `preload: false` on 10 non-default fonts, only Outfit preloaded
- **4.7** — Code splitting — DynamicIcon (lazy per-pack react-icons, eliminated critical login bundle issue), IconPicker via next/dynamic, LazyQRCode + LazyReactCrop wrappers
- **4.8** — next/image — 7 `<img>` → `<Image>` with `unoptimized` for presigned/proxy URLs

### Batch 5 — Accessibility (4h)
- **4.9** — Skip-to-content link
- **4.10** — Focus management on route changes
- **4.11** — Keyboard alternative for DnD
- **4.12** — Fix RTL for Persian/Hebrew

### Batch 6 — Middleware (2h) ✅ DONE
- **4.13** — Next.js middleware route protection (99L) — jose JWT verification, Edge Runtime, cookie-based auth gating. Also pulled forward 6.13 (JWT_SECRET mandatory env var)

## Workflow (per CLAUDE.md)
1. Execute items
2. Reviewer agent verifies each batch
3. Follow-ups go into `audit/TODO-POST-PHASE-4.md`
4. Completed items tracked in `audit/DONE.md`
