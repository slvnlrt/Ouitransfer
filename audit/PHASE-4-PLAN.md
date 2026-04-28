# Phase 4 — Frontend Modernization — Execution Plan

> Total: ~40h estimated, 15 items
> Goal: Server-state management, error boundaries, performance, accessibility.

## Execution Order

### Batch 1 — Deduplication cleanup (5h)
- **4.14** — Extract `<EditableField>` + `<SelectionCheckbox>` from duplicated file/folder rows
- **4.15** — Consolidate 21 duplicated File/Folder type interfaces into canonical imports

### Batch 2 — Quick accessibility wins (1h)
- **4.9** — Skip-to-content link
- **4.12** — Fix RTL for Persian/Hebrew

### Batch 3 — Error/Loading boundaries (4h)
- **4.1** — `error.tsx` boundaries on every route segment
- **4.2** — `loading.tsx` streaming boundaries with skeleton UI

### Batch 4 — Server-state management (16h)
- **4.3** — TanStack Query integration (the big one)
- **4.4** — Axios 401 interceptor (depends on 4.3)
- **4.5** — Unify state management (depends on 4.3)

### Batch 5 — Performance (8h)
- **4.6** — Lazy-load Google Fonts
- **4.7** — `next/dynamic` for heavy components
- **4.8** — Replace `<img>` with `next/image`

### Batch 6 — Remaining accessibility (3h)
- **4.10** — Focus management on route changes
- **4.11** — Keyboard alternative for DnD

### Batch 7 — Middleware (2h)
- **4.13** — Next.js middleware for route protection

## Workflow (per CLAUDE.md)
1. Execute items
2. Reviewer agent verifies each batch
3. Follow-ups go into `audit/TODO-POST-PHASE-4.md`
4. Completed items tracked in `audit/DONE.md`
