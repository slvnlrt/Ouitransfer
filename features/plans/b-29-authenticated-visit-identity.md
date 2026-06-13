# B-29 — Implementation Plan

Spec: `features/specs/b-29-authenticated-visit-identity.md`

## Batches (sequential)

### Batch 1 — Server (schema + service + download + endpoint + tests)
- Schema: `ShareVisit.userId` (FK → User, SetNull) + `User.shareVisits` back-relation. Author
  migration via `prisma migrate dev` (name `share_visit_user`), commit it. Recreate dev DB if needed.
- `share/service.ts` `getShare`:
  - owner branch → fire-and-forget visit (`authenticated_user`, userId, name/email snapshot, no
    notification) before the early return;
  - non-owner branch → authenticated fallback (only when no token/cookie recipient match), set
    userId + source + name/email snapshot; existing owner notification still fires for real visitors.
  - Resolve the visitor user's `username`/`email` (select from User by userId / include `creator`).
- `file/routes.ts` download path → mirror the authenticated fallback.
- `share/routes.ts` `/shares/:shareId/visits` → enum gains `authenticated_user`; add `isOwner`;
  map stored value; include `userId` in the `identified=true` filter.
- Tests: visitor-tracking + new cases (owner tracked w/o notify; non-owner authenticated identified;
  precedence; `/visits` shape; download identified). Update any mocks for the new field.
- Verify: `pnpm --filter ouitransfer-api type-check` + `test` (+ `db:generate`).

### Batch 2 — Frontend (types, component, en/fr i18n, web tests)
- `shares/types.ts`: union + `isOwner`.
- `share-details-activity-section.tsx`: verified badge for `authenticated_user`; "You" when isOwner.
- i18n en-US + fr-FR: `source.authenticated_user`, `activity.you`.
- Web tests for the two render paths.
- Verify: `pnpm --filter ouitransfer-web type-check` + `lint` + `test`.

### Batch 3 — i18n 21 locales (mechanical)
- Add the 2 new keys, translated, to the 21 remaining locales. Parity test green.

### Review → fix-all → Done
- Reviewer → `features/reviews/b-29-authenticated-visit-identity.md`; fix every finding.
- Update `BUGS.md` (B-29 resolved), `README.md`, `SESSIONS.md`.
