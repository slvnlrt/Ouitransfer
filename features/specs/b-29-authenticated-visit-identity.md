# B-29 — Identify authenticated Ouitransfer users in the share activity log

**Status:** Spec
**Type:** Bug / tracking gap (Low severity)
**Relates to:** 8.1 Audit, 8.3 Download Tracking (the share-visit system)

## Problem

When a logged-in Ouitransfer user accesses a share (`GET /shares/:shareId`), their known identity
(`userId` from the JWT) is never recorded on the `ShareVisit`:

1. **Owner** — `getShare` returns early (bypasses password) **before** any visit is tracked, so the
   owner's own accesses never appear in the activity log at all.
2. **Non-owner authenticated user** — they pass the password check, but the visit is recorded with
   `identificationSource ∈ {token, self_declared, null}` only; there is no
   `"authenticated_user"` source and no `userId` link, so a known, logged-in user shows as
   **"anonymous"** even though the server knows exactly who they are.

The same gap exists on the **download** path (`file/routes.ts`), which builds `ShareVisit` rows the
same way — for consistency the fix covers both.

## Decisions

- **Store `userId` on `ShareVisit`** (FK → `User`, `onDelete: SetNull`) plus a new
  `identificationSource = "authenticated_user"`. This is a **verified** identity (JWT-backed),
  unlike the spoofable `self_declared`/`cookie` source.
- **Snapshot `visitorName`/`visitorEmail`** from the user record (username + email) at visit time —
  consistent with how `self_declared` visits already persist `visitorEmail`, keeps the existing
  activity rendering and the owner "share accessed" notification working without an extra join. On
  user deletion the FK goes `SetNull` and `deleteUser` nulls the `visitorEmail`/`visitorName`
  snapshots in other owners' ShareVisit rows (GDPR erasure — runs before the user row is deleted
  so the `userId` FK is still valid for the WHERE clause).
- **Owner self-accesses are NOT tracked** (post-review revision). `GET /shares/:shareId` is the
  owner's share-details/management modal, which refetches on every open and on every
  `invalidateShare()` (edit, refresh trigger). Tracking it fills the activity log with
  self-referential noise that drowns real visitor activity. The owner-download path also does not
  track owners, so skipping here restores access/download consistency. `isOwner` is kept in the
  `/visits` response shape (derived from `visit.userId === share.creatorId`) for any future or
  edge owner-attributed rows, but routine owner management views are no longer logged.
- **Resolution precedence** for `identificationSource` on a visit (first match wins): tracking
  `token` → identification `self_declared` (matched cookie recipient) → **`authenticated_user`**
  (logged-in, no token/matched-recipient) → `anonymous`. An **unmatched** cookie (no `recipientId`
  resolved) is overridden by a verified JWT identity: the authenticated user wins and their
  confirmed name/email replaces the spoofable cookie display. A **matched** cookie
  (`self_declared` with `recipientId` set) still takes precedence — the `!recipientId` guard
  in the authenticated fallback preserves that.

## Schema

`apps/server/prisma/schema.prisma`, model `ShareVisit`:
```
userId String?
user   User?   @relation(fields: [userId], references: [id], onDelete: SetNull)
```
Back-relation on `User`: `shareVisits ShareVisit[]`. New migration (e.g. `share_visit_user`).
`identificationSource` stays `String?` (no enum migration) — new allowed value
`"authenticated_user"`.

## Server

`apps/server/src/modules/share/service.ts` — `getShare`:
- **Owner branch**: before the early return, fire-and-forget a `ShareVisit` with
  `userId`, `identificationSource = "authenticated_user"`, `action = "access"`,
  `visitorName = username`, `visitorEmail = email`, **no notification**. (Load `creator`'s
  `username`/`email` — already have the `share` with `creatorId`; select the user, or include
  `creator` in the share query.)
- **Non-owner branch**: after recipient/cookie resolution, if no `recipientId` was attributed **and**
  `userId` is set, fill `userId` + `identificationSource = "authenticated_user"` + snapshot
  `visitorName`/`visitorEmail` from the user. The owner `share_accessed` notification still fires
  for real (non-owner) visitors, now with a name.

`apps/server/src/modules/file/routes.ts` (download path) — mirror the non-owner case: when the
downloader is authenticated and not attributed via token/cookie, store `userId` +
`authenticated_user` + snapshot name/email.

`apps/server/src/modules/share/routes.ts` — `GET /shares/:shareId/visits`:
- Response schema: add `"authenticated_user"` to the `identificationSource` enum; add
  `isOwner: z.boolean()`.
- Mapping: stored `"authenticated_user"` → API `"authenticated_user"`; compute
  `isOwner = visit.userId != null && visit.userId === share.creatorId`.
- The `identified=true` filter WHERE clause: also treat a non-null `userId` as identified.

## Frontend

`apps/web/src/http/endpoints/shares/types.ts` — `ShareVisit`:
- `identificationSource: "tracking_token" | "cookie" | "anonymous" | "authenticated_user"`.
- add `isOwner: boolean`.

`apps/web/src/components/modals/share-details/share-details-activity-section.tsx` — `VisitEntry`:
- Add `authenticated_user` to `SOURCE_LABEL_KEY`, rendered as a **plain verified badge** (NOT the
  spoofable-cookie tooltip path) — it is a verified registered user.
- When `visit.isOwner`, show a subtle "You" / owner indicator instead of (or alongside) the email.

## i18n

New keys in all 23 locales:
- `shareDetails.activity.source.authenticated_user` (e.g. "Registered user")
- `shareDetails.activity.you` (e.g. "You") — owner self-visit label

## Tests

- Service: owner access creates a visit with `authenticated_user` + userId and **no** notification;
  non-owner authenticated (no token/cookie) → `authenticated_user` + userId + name snapshot +
  notification still fires; token/cookie still take precedence over authenticated.
- `app.inject()` integration on `GET /shares/:shareId` (authenticated) → a visit row with the right
  source; `/shares/:id/visits` returns `authenticated_user` + `isOwner`.
- Download path: authenticated downloader is identified.
- Frontend: `VisitEntry` renders the verified badge for `authenticated_user` (no spoofable hint) and
  the "You" indicator when `isOwner`.

## Out of scope

- Owner self-visits are now not generated at all (see Decisions above), so filtering them is moot.
- Per-visit `userId` index (queries are by `shareId`).
