# B-34 — A preview should not count as a download (non-previewable types)

## Problem

In a public share, **previewing a file marks the recipient as "Téléchargé"** (sets
`ShareRecipient.downloadCount` / `lastDownloadedAt`, and `Share.lastDownloadedAt`), for **every**
file type — including non-previewable ones (`.zip`, `.docx`, …) where no content is actually shown.

### Confirmed root cause (verified end-to-end)

Tracking happens at **presigned-URL generation time**, not at byte-fetch time:

- The web client **never sends `shareId`** to the server. The request body of `POST /files/download-url`
  is only `{ objectName, password }` (`apps/server/src/modules/file/routes.ts:1173-1180`). The
  `shareId` argument in the client helpers is **only used to scope the client-side URL cache**
  (`apps/web/src/http/endpoints/files/index.ts:94-95` — *"shareId is no longer sent to the server… kept
  only so the cache can scope per share"*).
- For a share file, `objectName` is an **opaque per-share token** (`st1_…`) that encodes
  `{ shareId, fileId }`. The server decodes it in `resolveDownloadTarget` →
  `verifyShareFileToken` (`apps/server/src/modules/share/share-file-token.ts`), so
  `shareId` is **always** resolved server-side.
- Both endpoints then do `if (shareId) trackShareDownload(...)`
  (`file/routes.ts:1245` for `/files/download-url`, `:1352` for the streamed `/files/download`).
  `trackShareDownload` (`:253-410`) increments `ShareRecipient.downloadCount` + `lastDownloadedAt`
  (token-identified recipient, `:370-376`) and sets `Share.lastDownloadedAt` (`:384`).

⇒ Preview and download hit the **same** endpoint with the same token, the server resolves the share,
and tracking runs for both. The comment in `use-file-preview.ts:34-40` ("preview deliberately omits
shareId") is **misleading** — omitting the client-side `shareId` changes only the cache key, never the
server tracking.

The recipient "Téléchargé" badge is driven solely by `lastDownloadedAt != null`
(`share-details-recipients-list.tsx`, `recipient-selector.tsx`).

### Other paths (ruled out)

- `GET /shares/:id?t=<token>` (access) creates a `ShareVisit { action: "access" }` but does **not**
  touch `downloadCount`/`lastDownloadedAt` — the 👁 "access/views" counter is independent.
- Only `/files/download-url` and `/files/download` write those fields (both via `trackShareDownload`).
- Owner file-manager downloads use a **raw** objectName (no share token) → no `shareId` resolved → never
  tracked. Unaffected by this change.

## Chosen behavior — option (b)

A preview counts as a download **only for genuinely previewable types** (image / text / pdf / audio /
video — i.e. the content is actually delivered to the recipient). A preview of a **non-previewable**
type (`getFileType(name) === "other"`) must **not** count. Explicit downloads always count.

Rationale: for a previewable type the bytes are delivered (image rendered, text/pdf/av fetched) — "the
information is out", so counting is correct. For a non-previewable type the modal only shows a
"no preview available" affordance and the bytes are not consumed, so counting is misleading.

## Design

Introduce an explicit **`track` flag** on the download-URL request instead of inferring intent from the
(server-resolved) share binding.

- **Source of truth for "previewable"**: the existing client `getFileType()`
  (`apps/web/src/utils/file-types.ts`, returns `"pdf"|"image"|"audio"|"video"|"text"|"other"`). This is
  the SAME function the preview switch already uses, so **no new list and no server-side duplication**.
- **Trust model**: this is owner-facing analytics, not security. A recipient suppressing their own
  preview tracking is harmless, so a client-driven flag is acceptable (and avoids duplicating a
  previewable-MIME list on the server).
- **Default `true`**: an omitted `track` means "track" → every existing caller (all real downloads) is
  unchanged. Only the preview path sends `track: false` for non-previewable files.
- **Cache key unchanged**: `track` is a stable property of a file (its type doesn't change), and preview
  vs download already cache separately via the `shareId`-in-key scoping. So `track` must **not** enter
  the cache key. (Re-opening a previewable preview returns the cached URL and does not re-track — desired,
  no double counting.)

## Tasks

### 1 — Server: gate tracking on `track` (both endpoints)
`apps/server/src/modules/file/routes.ts`
- `POST /files/download-url` body schema (`~:1173`): add `track: z.boolean().optional()`.
- `POST /files/download` body schema (`~:1276`): add the same.
- Both handlers: read `track` from body; change `if (shareId)` → `if (shareId && track !== false)` at the
  `trackShareDownload(...)` call sites (`~:1245`, `~:1352`).
- **Audit**: keep logging the `FILE_DOWNLOAD` event (a presigned URL was genuinely issued — auditable),
  but add `intent: track === false ? "preview" : "download"` to its `metadata` so the audit log no longer
  mislabels previews as downloads. (Small, improves accuracy; does not change what is tracked for the
  recipient.)

### 2 — Client HTTP layer: thread `track`
- `apps/web/src/http/endpoints/files/index.ts` — `getDownloadUrl(...)`: add a `track?: boolean` param;
  when `track === false`, set `body.track = false` (omit otherwise so the default holds). Update the
  JSDoc (the misleading `_shareId` note).
- `apps/web/src/lib/download-url-cache.ts` — `getCachedDownloadUrl(objectName, options?, shareId?, track?)`:
  accept `track?: boolean`, forward it to `getDownloadUrl`. Do **not** add it to `getCacheKey`; add a
  one-line comment explaining why.

### 3 — Client: send `track: false` only for non-previewable previews
`apps/web/src/hooks/use-file-preview.ts`
- In `loadPreview` (the non-reverse branch, `~:216`): pass `track: fileType !== "other"` (the `fileType`
  const already exists at `:65`). i.e. `getCachedDownloadUrl(file.objectName, options, undefined, fileType !== "other")`.
- Leave `handleDownload` (`~:273`) unchanged (defaults to track). Leave the reverse-share branch
  (`getCachedReverseShareDownloadUrl`, `~:211`) unchanged — see Out of scope.
- Update/replace the misleading comment block (`:34-40`) to describe the real mechanism (`track` flag,
  server resolves the share from the token).

### 4 — Tests
- **Server (integration, `app.inject`)** — extend `apps/server/src/__tests__/share-download-access.integration.test.ts`
  (or the closest existing download-tracking suite):
  - share token + `track` omitted → recipient `lastDownloadedAt`/`downloadCount` updated (unchanged behavior).
  - share token + `track: false` → `trackShareDownload` NOT applied (recipient fields untouched, no
    "download" ShareVisit), while the presigned URL is still returned and the `FILE_DOWNLOAD` audit logs
    `intent: "preview"`.
- **Client (unit)** — `use-file-preview`: mock `getCachedDownloadUrl`; assert `loadPreview` passes
  `track === false` for a non-previewable name (`x.zip`) and `track !== false` for a previewable one
  (`x.png` / `x.txt`); assert `handleDownload` never passes `track: false`.
- Run full affected suites: `pnpm --filter ouitransfer-api test`, `pnpm --filter ouitransfer-web test`,
  plus type-check + lint.

### 5 — Docs
- Add **B-34** to `features/BUGS.md` (Resolved) and a `features/SESSIONS.md` entry.

## Out of scope / follow-ups
- **Reverse shares**: file previews there use `getCachedReverseShareDownloadUrl` (a different endpoint),
  and reverse shares track *uploads* (`uploadedAt`), not downloads. Verify separately whether an analogous
  "preview counts" issue exists; not addressed here.
- **Audit semantics** beyond adding `intent` are unchanged.

## Risk
Low. The only behavioral change is: a preview of a **non-previewable** file no longer marks the recipient
"Téléchargé". Every real download and every previewable preview is unchanged (default `track: true`).
Owner downloads and the access/views counter are untouched.

## Validation checklist
- [ ] Non-previewable preview (`.zip`) → recipient NOT marked downloaded.
- [ ] Previewable preview (image/text/pdf) → recipient marked downloaded (unchanged).
- [ ] Explicit download (button / bulk / folder zip) → recipient marked downloaded (unchanged).
- [ ] Owner file-manager preview/download → no recipient tracking (unchanged).
- [ ] Re-opening a previewable preview does not double-count.
- [ ] Server + web suites green; type-check + lint clean.
