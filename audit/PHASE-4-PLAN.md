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

### Batch 3 — Server-state management (16h)
- **4.3** — TanStack Query integration (the big one)
- **4.4** — Axios 401 interceptor (depends on 4.3)
- **4.5** — Unify state management (depends on 4.3)

### Batch 4 — Performance (8h)
- **4.6** — Lazy-load Google Fonts
- **4.7** — `next/dynamic` for heavy components
- **4.8** — Replace `<img>` with `next/image`

### Batch 5 — Accessibility (4h)
- **4.9** — Skip-to-content link
- **4.10** — Focus management on route changes
- **4.11** — Keyboard alternative for DnD
- **4.12** — Fix RTL for Persian/Hebrew

### Batch 6 — Middleware (2h)
- **4.13** — Next.js middleware for route protection

## Workflow (per CLAUDE.md)
1. Execute items
2. Reviewer agent verifies each batch
3. Follow-ups go into `audit/TODO-POST-PHASE-4.md`
4. Completed items tracked in `audit/DONE.md`
