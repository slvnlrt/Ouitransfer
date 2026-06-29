# B-34 — Record file previews as a first-class per-file "viewed" event (not a download)

> Supersedes the original `track`-boolean plan, which the Opus design review rejected
> (`features/reviews/b-34-plan-review.md`: 1 Critical + 3 Important). This revision implements the
> review's recommended option — a **first-class, server-recorded "preview" event** — and resolves every
> finding. Decision confirmed with the product owner: option (1).

## Problem (recap)

In a public share, **previewing a file marks the recipient as "Téléchargé"** (bumps
`ShareRecipient.downloadCount`/`lastDownloadedAt`, `Share.lastDownloadedAt`, and records a
`ShareVisit{action:"download"}`), for every file type. Tracking fires at presigned-URL generation time:
the opaque `st1_` token (`objectName`) binds `{shareId,fileId}`, the server resolves `shareId`
(`resolveDownloadTarget`), and both preview and download hit `POST /files/download-url` →
`if (shareId) trackShareDownload(...)` (`file/routes.ts:1245`). The client never sends an intent, so the
server cannot tell a view from a download.

Two product gaps the owner also raised:
- The existing 👁 **"consulté"** signal is **share-level** (`ShareVisit{action:"access"}`, no file) — a
  preview must be a **distinct, file-level** event, not confused with share access.
- **Downloads have no per-file detail** either: `downloadCount`/`lastDownloadedAt` are per-recipient
  aggregates, so with several files you can't tell *which* file was downloaded.

## Key enablers (already in place — verified)

- **`ShareVisit.fileId` already exists** (`schema.prisma:246`) and is **already populated for downloads**
  (`file/routes.ts:349`). For `action:"access"` it is null (share-level). ⇒ per-file detail is a data
  fact today; it just isn't surfaced.
- **An activity log already exists**: `GET /shares/:shareId/visits` (`share/routes.ts:~1130`, returns
  `action` + `fileId`) consumed by `share-details-activity-section.tsx`, which already renders
  access (Eye) vs download (Download) rows with filters.
- `ShareVisit.action` is a plain `String` (no DB enum) → adding `"preview"` needs **no migration**.
- Recipient stats only move for `identificationSource === "token"` (verified link) — the existing
  anti-spoof safeguard (`file/routes.ts:370-377`).

## Design (option 1 — first-class per-file "viewed" event)

1. **A preview is a view, never a download.** Record a `ShareVisit{ action:"preview", fileId }`. Do
   **not** touch `downloadCount`/`lastDownloadedAt`/`Share.lastDownloadedAt`, and send no
   `share_downloaded` email. ⇒ resolves review **I-1** (no view/download conflation; `remindNonDownloaders`,
   which keys off `lastDownloadedAt == null`, stays correct).
2. **No previewability oracle.** A preview is recorded as a preview for **every** file type — we drop the
   `getFileType(name) !== "other"` classification entirely. ⇒ resolves **I-2** (no client previewable list,
   no SVG-style drift).
3. **Server decides the *action*; the client only declares *intent*.** Add an explicit
   `intent: "preview" | "download"` to `POST /files/download-url` (default `"download"` → all existing
   callers unchanged). The server maps `intent` → which event it records. Intent is inherently
   client-side knowledge (preview vs download fetch the *same* bytes), so it cannot be made fully
   server-authoritative; but **recipient attribution stays server-side safeguarded** (token-only). The
   single residual spoof (a recipient sending `intent:"preview"` on a real download): the download is then
   recorded as a preview, `lastDownloadedAt` is **not** set, so the recipient *stays in the
   `remindNonDownloaders` set* (`service.ts:1150` keys off `lastDownloadedAt == null`). i.e. spoofing only
   over-reminds the spoofer; it can **never hide a real download from the owner**, so the owner's
   "downloaded ⇒ it was downloaded" guarantee is intact. This is strictly better than v1 and acceptable.
   A named `intent` enum is self-documenting (resolves **M-1**, the `track`/`_shareId` vestigial-param smell).
4. **C-1 is closed primarily by the server `intent` branch — the cache key is a secondary guard.** Because
   a preview now records `action:"preview"` and writes **no** download stats, a later real download is a
   genuinely distinct server action regardless of cache identity. As belt-and-suspenders, `intent` is also
   added to the **client presigned-URL cache key**, with a stable default of `"download"` in a fixed
   position (so every key carries an intent segment and no two logically-equal requests split into two
   keys — see task 3). ⇒ resolves **C-1** (the Critical regression the prior plan introduced) and the M-2
   "correctness depends on cache identity" smell.
5. **Preview lives in the activity log, not as a recipient badge.** Surface previews **only** in the
   per-file activity log (distinct from the recipient-row 👁 "accès" aggregate, so the two never visually
   collide). No new `ShareRecipient`/`Share` aggregate columns. Keeps the change small and the recipient
   row unambiguous.
6. **Surface the file name for download AND preview rows** in the activity log, answering "which file?".

## Tasks

### 1 — Server: record the preview event
`apps/server/src/modules/file/routes.ts`
- `POST /files/download-url` body schema (`~:1173`): add
  `intent: z.enum(["preview", "download"]).optional().default("download")`.
- Handler (`~:1244`): branch on intent —
  - `"download"` (or default) + `shareId` → `trackShareDownload(...)` (unchanged).
  - `"preview"` + `shareId` → new `trackShareFilePreview(...)`.
- New `trackShareFilePreview(request, fileRecord, shareId, userId, ancestorFolderIds)`: mirror
  `trackShareDownload`'s recipient resolution + **owner-skip guard** (reproduce the same
  share-creator/`isOwner` lookup it uses at `routes.ts:286-288` — the function must fetch the share to
  know the creator), but create a `ShareVisit{ action:"preview", fileId: fileRecord.id, … }` and
  **nothing else** (no recipient download stats, no `Share.lastDownloadedAt`, no email). Fire-and-forget.
- `FILE_DOWNLOAD` audit metadata: add `intent` (the server's resolved value) so previews aren't logged as
  downloads (resolves **M-3**).
- Streamed `POST /files/download` (`~:1276`): **deliberately NOT given an `intent` field.** It forces
  `Content-Disposition: attachment` (`setForcedAttachmentHeaders`) so it is structurally a download — it
  can never render a preview inline — and it is not reached by the web client. Adding a "preview" branch
  there would be semantically wrong, so it stays download-only with an explanatory comment at the call site.

### 2 — Server: expose the file name (and preview action) in the activity log
`apps/server/src/modules/share/{routes,service}.ts`
- **No Prisma `include`/relation exists**: `ShareVisit.fileId` is a bare `String?` with no `file` relation
  (and `File` has no back-relation), so the file name must be resolved by a **manual batch lookup** (keeps
  the "no migration" property). After the page's `shareVisit.findMany`, collect the non-null `fileId`s,
  run one `prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true } })`
  (one query per page, ≤ `limit` ids — NOT an N+1), build a `Map<id, name>`, and attach
  `fileName: string | null` to each visit. **Deleted/expired files → `fileName: null`** (the UI renders a
  graceful fallback, e.g. the action without a name).
- Add `fileName: string | null` to the `/visits` response schema; ensure `action` may be `"preview"`;
  extend the `action` query-filter enum to `access | preview | download`.

### 3 — Client HTTP layer: thread `intent` (body + cache key)
- `apps/web/src/http/endpoints/files/index.ts` — `getDownloadUrl(...)`: add `intent?: "preview" | "download"`;
  when `intent === "preview"`, set `body.intent = "preview"`. Refresh the misleading `_shareId` JSDoc.
- `apps/web/src/lib/download-url-cache.ts` — `getCachedDownloadUrl(objectName, options?, shareId?, intent?)`:
  accept `intent`, forward to `getDownloadUrl`, **and include it in `getCacheKey`**. `getCacheKey` currently
  does `[objectName, password, shareId].filter(Boolean).join("|")`; **default `intent` to `"download"`**
  inside the key builder and place it in a fixed final position — e.g.
  `[objectName, password, shareId, intent].filter(Boolean)` where `intent` is never empty — so every key
  carries a stable intent segment and two logically-equal download calls (one omitting intent, one passing
  the default) can't split into two keys / double-presign. Comment why (secondary C-1 guard).

### 4 — Client: send `intent:"preview"` from the preview path only
`apps/web/src/hooks/use-file-preview.ts`
- `loadPreview` (non-reverse branch, `~:216`): pass `intent: "preview"` (for ALL types — no getFileType check).
- `handleDownload` and every other download call site: unchanged (default `"download"`).
- Replace the misleading comment block (`:34-40`) with the real mechanism.

### 5 — Client: render previews + file names in the activity log
`apps/web/src/components/modals/share-details/share-details-activity-section.tsx` (+ `http/endpoints/shares/types.ts`)
- Types: `ShareVisit.action: "access" | "preview" | "download"`; add `fileName: string | null`. Also widen
  the client `ActionFilter` type (`activity-section.tsx:101`, currently `"all" | "access" | "download"`)
  and the web `getShareVisits` `action` param to include `"preview"`, and the **server** querystring enum
  (`share/routes.ts:1143`, currently `["access","download"]`) to `access | preview | download`.
- `VisitEntry`: render `"preview"` with a **distinct** icon+label from share `"access"` — e.g. access →
  "A consulté le partage" (Eye, share-level, no file), preview → "A consulté le fichier {fileName}"
  (a file-with-eye icon, file-level), download → "A téléchargé {fileName}" (Download). Show `fileName` on
  download rows too; when `fileName` is null (deleted file), fall back to the action label without a name.
- Add **"Aperçu"** to the action filter (4-way: tous / accès / aperçu / téléchargement).
- New i18n keys for the preview label + filter must be added to **all 23 locale files** (en-US + fr-FR
  authored; the other 21 via the translation sync workflow / `[TO_TRANSLATE]` markers — NOT runtime
  fallback), matching the existing `shareDetails.activity.*` keys which are already present in all 23.
  Run `pnpm --filter web translations:check` (CLAUDE.md rule 5 — preserve i18n).

### 6 — Tests
- **Server integration (`app.inject`)** — extend `apps/server/src/__tests__/share-download-access.integration.test.ts`:
  - `intent:"download"` (and omitted) + share token → recipient download stats updated, `action:"download"`
    visit with `fileId` (unchanged behavior).
  - `intent:"preview"` + share token → a `ShareVisit{action:"preview", fileId}` is created, and
    `downloadCount`/`lastDownloadedAt` are **NOT** touched (and no `share_downloaded` email).
  - `/visits` returns `fileName` for download+preview rows and accepts `?action=preview`.
- **C-1 regression test** — preview a file (`intent:"preview"`) then download the **same** file
  (`intent:"download"`) → the download is still recorded (separate cache key; download stats bumped once).
- **Client unit** — `use-file-preview`: `loadPreview` passes `intent:"preview"` (any type); `handleDownload`
  never passes `intent:"preview"`. `download-url-cache`: for the same `objectName`+`shareId`, a `preview`
  call and a `download` call (including the **default/omitted-intent** download case) produce **different**
  cache keys, and every key carries a stable intent segment.
- Full suites + type-check + lint.

### 7 — Docs
- B-34 entry in `features/BUGS.md` + `features/SESSIONS.md`.
- Promote the reverse-share deferral to a tracked item in `features/TECHNICAL-DEBT.md` (resolves **M-4**).

## Out of scope / deliberate non-goals
- **Per-recipient "viewed" aggregate badge** (a `previewCount`/`lastPreviewedAt` on `ShareRecipient`):
  intentionally NOT added — previews are shown per-file in the activity log, keeping the recipient row
  unambiguous vs the existing share-access 👁. Can be added later if wanted.
- **Per-file summary badge in the files list** ("vu/téléchargé par N"): nice-to-have follow-up; needs a
  per-file aggregation query. Not in this change.
- **Reverse shares**: different endpoint (`getCachedReverseShareDownloadUrl`); they track *uploads*, not
  downloads — the B-34 symptom cannot occur there. Tracked as a follow-up in TECHNICAL-DEBT.
- **Cleaner long-term design (TECHNICAL-DEBT note):** the strictly superior end-state is a dedicated
  `POST /shares/:id/files/:fileId/(view|download)` tracking call that removes the presigned-URL cache from
  the tracking-correctness path entirely (tracking no longer piggybacks on URL minting). Not taken here —
  v2's server `intent` branch already makes correctness independent of cache identity — but recorded in
  `TECHNICAL-DEBT.md` as the future refactor direction.

## Review-finding resolution map
- **C-1** (cache coherence) → `intent` in the cache key (task 3).
- **I-1** (view vs download) → preview is its own event; download stats untouched (tasks 1, 5).
- **I-2** (client previewability oracle) → eliminated; preview is preview for all types (task 4).
- **I-3** (spoofable) → reduced to client *intent* only (no previewability to spoof); token-based
  recipient attribution unchanged; documented low-stakes trade-off (design §3).
- **M-1** (vestigial param) → named `intent` enum, server-mapped.
- **M-2** (double-count via cache) → preview re-open just records/looks-up a preview; download correctness
  no longer depends on cache identity across intents.
- **M-3** (audit) → `intent` in `FILE_DOWNLOAD` metadata, server-determined.
- **M-4** (reverse-share scope) → tracked in TECHNICAL-DEBT.
- **M-5** (cross-path cache test) → explicit preview-then-download test (task 6).

## Risk
Low–medium. Default `intent:"download"` preserves all current download behavior; only the preview path
opts into the new event. No schema migration (file name resolved by batch lookup, task 2). The one
behavioral change visible to owners: previews now appear as a distinct "Aperçu" activity instead of
inflating "Téléchargé", and the activity log shows which file each download/preview concerns.

**Intended behavior to note (not a bug):** re-opening the same preview within the presigned-URL cache
window is a cache hit (no second event); re-opening across windows/sessions records another `"preview"`
row. For an activity *log* this is correct (each is a distinct viewing event) — it is not a download
counter. "Viewed once" semantics would require a per-recipient aggregate, which is explicitly out of scope.

## Validation checklist
- [ ] Preview of any type (`.zip`, `.png`, `.txt`) → recipient NOT marked "Téléchargé"; an "Aperçu" row
      appears in the activity log with the file name.
- [ ] Explicit download (button / bulk / folder zip) → "Téléchargé" + `action:"download"` row, unchanged.
- [ ] Preview then download the same file → download still counts (C-1).
- [ ] Share access still shows as share-level "consulté" (no file), visually distinct from file "Aperçu".
- [ ] `remindNonDownloaders` still targets recipients who previewed but never downloaded.
- [ ] Owner self-preview/-download records nothing (existing guard).
- [ ] Server + web suites green; type-check + lint clean.
