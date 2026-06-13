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
  activity rendering and the owner "share accessed" notification working without an extra join, and
  on user deletion the FK goes `SetNull` (visit degrades gracefully, same PII profile as today's
  external visits).
- **Track owner self-accesses too**, but **without** firing the `share_accessed` owner
  notification (you don't notify someone of their own visit) and without the password path. The
  `/visits` response exposes `isOwner` (`visit.userId === share.creatorId`) so the UI can label it
  "You" / owner rather than as an external visitor.
- **Resolution precedence** for `identificationSource` on a visit (first match wins): tracking
  `token` → identification `cookie`/`self_declared` → **`authenticated_user`** (logged-in, no
  token/cookie match) → `anonymous`. I.e. a personalized link / self-declared email still takes
  precedence (richer recipient linkage); the authenticated fallback only fills the previously-
  anonymous case.

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

- Default-filtering owner self-visits out of the log (they're labeled, not hidden) — revisit only if
  it proves noisy.
- Per-visit `userId` index (queries are by `shareId`).
