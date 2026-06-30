# B-34 Plan — Design Review

**Plan reviewed:** `features/plans/b-34-preview-not-counted-as-download.md`
**Reviewer:** Architecture / design review (pre-implementation)
**Scope:** Is the chosen design (client-sent `track` boolean, default true, set false by the preview path for non-previewable types) the cleanest, most durable solution — or is a different design better?

---

## Verdict

**No — prefer an alternative.** The plan's *diagnosis* is accurate and well-verified (I confirmed every load-bearing claim against the code). But the chosen *mechanism* — a client-supplied `track` boolean threaded through the cache and gated `if (shareId && track !== false)` — has one **Critical** correctness bug (cache coherence between a `track:false` preview URL and a later real download of the same file) and a **questionable product semantics** (option (b): "a preview of a previewable type IS a download"). Both are avoidable with a cleaner design.

My recommendation, in order of preference:

1. **Best: server-authoritative `intent=preview` that records a distinct "view" event, not a download.** Stop overloading `downloadCount`/`lastDownloadedAt`. A preview is a view; record it as one (ShareVisit `action:"preview"` and/or per-recipient `lastViewedAt`). Downloads remain downloads. This resolves the bug, the semantics question, and the trust question simultaneously, and is the only option consistent with the project's "first-class concept, zero tech debt" bar.
2. **Acceptable fallback: option (a) "a preview never counts as a download," implemented server-side via an `intent` flag** that the server maps (no client previewability oracle). Simpler than the first-class event, predictable ("previews never count, downloads always count"), and kills the `getFileType` coupling.
3. **As-planned option (b) with a client `track` boolean: not recommended.** Even after fixing the Critical cache bug, it conflates view-vs-download, couples tracking to a client-side previewability list, and adds a second `shareId`-style param whose semantics ("default true, but the preview path sometimes sends false") the next reader will have to reverse-engineer.

The rest of this review explains why, with the concrete fixes.

---

## Verified facts (the plan's diagnosis is correct)

- `POST /files/download-url` body is `{ objectName, password }` only (`routes.ts:1173-1180`); the client genuinely never sends `shareId` (`http/endpoints/files/index.ts:104`, `_shareId` is dead). ✓
- `objectName` for a share file is the opaque `st1_` token binding `{shareId, fileId}` (`share-file-token.ts:50-87`); `resolveDownloadTarget` resolves `shareId` server-side for **both** preview and download. ✓
- Both endpoints gate tracking with `if (shareId) trackShareDownload(...)` (`routes.ts:1245`, `:1352`). ✓
- `trackShareDownload` writes: a `ShareVisit { action:"download" }` (`:346-359`), bumps `ShareRecipient.downloadCount`/`lastDownloadedAt` **only for `identificationSource === "token"`** (`:370-377`), and sets `Share.lastDownloadedAt` + clears `inactivityAlertSent` (`:381-386`), then sends the `share_downloaded` email. ✓
- The streamed `POST /files/download` is **not reachable from the web client** — no caller invokes `downloadFile`; the web only ever uses `getCachedDownloadUrl` → `/files/download-url` (and zip uses presigned URLs too). The plan's edit to the streamed endpoint is therefore parity-only/defensive, which is fine. ✓
- The "Téléchargé" badge keys off `lastDownloadedAt != null`; `remindNonDownloaders` keys off `notifiedAt != null && lastDownloadedAt == null` (`service.ts:1150-1152`). ✓

So: the bug is real, the root cause is correctly identified, and the *file/line* targets in the plan are accurate.

---

## Findings

### CRITICAL

#### C-1. Cache coherence: a `track:false` preview URL is reused for a later real download → the download silently stops counting

The plan's decision (plan lines 66-69) is: `track` is a stable property of a file, so it must **not** enter the cache key. That is wrong for the non-previewable case, which is exactly the case being changed.

Trace it:
- Plan task 3 makes `loadPreview` call `getCachedDownloadUrl(file.objectName, options, undefined /*no shareId*/, track)`. For a `.zip`, `track=false`. The cache key is `getCacheKey(objectName, options, shareId=undefined)` = **`objectName`** (`download-url-cache.ts:23-31`). So a `track:false` presigned URL is cached under bare `objectName`.
- The real download paths for that same file in the **public share viewer** do **not** all pass `shareId`:
  - `use-share-download.ts:69` (bulk/zip): `getCachedDownloadUrl(item.objectName!)` — no shareId, no track → cache key `objectName`.
  - `use-share-download.ts:132` (single-file share download): `getCachedDownloadUrl(file.objectName)` — no shareId → cache key `objectName`.
- Result: after previewing the `.zip` (which mints a `track:false` URL under key `objectName`), the visitor clicks download → `getCachedDownloadUrl` returns the **cached `track:false` URL**, makes **no new request**, and the download is **never tracked**. The bug the plan is trying to scope (preview wrongly counting) is replaced by the inverse, worse bug (a genuine download not counting).

Note the plan's own premise — "preview vs download already cache separately via the shareId-in-key scoping" (plan line 68) — only holds for `useFilePreview.handleDownload` (`use-file-preview.ts:273`, which *does* pass `shareId`). It does **not** hold for the bulk/zip/single-file download hooks, which omit `shareId`. The presigned URL is identical regardless of `track` (tracking is a side effect of *generating* it, not a property of the URL), so reusing it is precisely what drops the tracking call.

**Fix options (any one closes it):**
- If keeping any client-flag design: `track` **must** be part of the cache key, OR (cleaner) a `track:false` ("preview") fetch must never be written to the shared cache at all, so it can never satisfy a later download read.
- Better: move intent to the server (see I-1/recommendation) so the cache stops being load-bearing for tracking correctness.

This alone makes the plan as-written incorrect. It must be addressed before implementation, and it argues against the "don't add to cache key" decision specifically.

---

### IMPORTANT

#### I-1. Wrong concept: a preview is a *view*, not a *download*. Option (b) conflates two events that will bite later.

The plan (lines 43-52) decides that previewing a previewable type *is* a download because "the bytes are delivered." But the data model already has a first-class distinction the plan ignores: `ShareVisit.action` is `"access" | "download"` (and B-29 just added `"preview"`-style owner-view reasoning). Overloading `downloadCount`/`lastDownloadedAt` for "viewed an image inline" means:

- **Reporting / reminders**: `remindNonDownloaders` (`service.ts:1150`) treats "downloaded" as "received the file and is done." Marking image/PDF *previewers* as downloaded means a recipient who glanced at a preview but never saved the file is excluded from reminders — the owner stops nudging someone who never actually took the file. That is a behavior regression dressed up as a fix.
- **Explainability**: the team will have to answer "why did viewing a PNG mark the recipient as downloaded, but viewing a ZIP didn't?" — the exact question the prompt flags. Option (b) bakes that asymmetry into the product permanently.
- **GDPR / audit**: "downloaded the file" and "viewed a preview" are legally and operationally different statements; collapsing them into one timestamp is lossy and hard to undo later.

**Option comparison:**

| | (a) preview never counts | (b) preview of previewable counts *(the plan)* | first-class "viewed" event *(recommended)* |
|---|---|---|---|
| Predictable rule | Yes — "previews never count" | No — depends on file type | Yes — "previews are views, downloads are downloads" |
| Client previewability oracle needed | No | **Yes** (`getFileType`, see I-2) | No |
| Owner can distinguish view vs download | No (loses preview signal) | No (collapses into download) | **Yes** |
| `remindNonDownloaders` stays correct | Yes | **No** (previewers excluded) | Yes |
| Matches existing `ShareVisit.action` model | Partially | No | **Yes** |
| Effort | Low | Low-medium | Medium |

The first-class "viewed" event is the only option that satisfies the project's stated bar ("first-class concept, prefer the clean solution even if more refactoring"). If that is judged too large for a bug fix, **(a) is strictly better than (b)**: it is more predictable, needs no client previewability oracle, and avoids the reminder regression. (b) is the worst of the three on every axis except raw LOC.

**Recommendation:** record previews as `ShareVisit { action:"preview" }` (and optionally a per-recipient `lastViewedAt`) and do **not** touch `downloadCount`/`lastDownloadedAt`/`Share.lastDownloadedAt` on preview. If a "viewed" event is out of budget for this bug, fall back to (a), not (b).

#### I-2. Durable coupling: `getFileType(name) !== "other"` is the wrong oracle, and putting it on the client is doubly wrong.

`getFileType` (`utils/file-types.ts`) is a ~300-extension allow-list maintained for the *preview switch's UI rendering*, not as a tracking contract. Coupling "does this count" to it means:

- **Drift**: the modal's actual capability and `getFileType` can diverge. E.g. `.svg` maps to both `image` (line 8) and `text` (line 28) — `image` wins, so an SVG is "previewable," yet the storage layer forces `Content-Disposition: attachment` on SVG/HTML so it is **never rendered inline** (`routes.ts:1146-1148`). Under (b) an SVG would be counted as "downloaded" on preview even though the modal shows nothing inline — a direct counter-example to the plan's own rationale ("bytes delivered / information is out").
- **Authority**: tracking semantics should be server-authoritative. The server already resolves the file (`fileRecord.name`) and could derive previewability itself if (b) were kept. Trusting the client to classify is unnecessary even under the plan's own "it's just analytics" framing.

Both (a) and the first-class-view design eliminate this oracle entirely (intent is "preview" vs "download", not "previewable vs not"). That is a strong additional reason to drop (b).

#### I-3. Trust model is weaker than stated — a spoofable flag undermines the reminder feature.

The plan (lines 61-63) says client-driven `track` is fine because it is "owner-facing analytics, not security." But the owner *acts* on this data: `remindNonDownloaders` and the "Téléchargé" badge are decisions, not vanity metrics. With the plan's design, *every* download-URL request carries a client-controlled `track`. A recipient (or any script replaying the request) can send `track:false` on a **real** download and suppress the evidence the owner relies on — keeping themselves permanently in the "remind non-downloaders" set or, conversely, the asymmetry lets them mark/avoid-marking at will.

The current code is deliberately careful here: per-recipient stats only move for `identificationSource === "token"` precisely *because* self-declared identity is spoofable (`routes.ts:366-377`). Introducing a freely-spoofable `track:false` on the authoritative path reopens a hole the codebase already closed elsewhere. "It's only analytics" is not consistent with how the rest of this module treats download evidence.

A server-derived intent (preview endpoint / `intent` param the server maps to behavior, with the *previewability* decision on the server) removes the spoof surface: a visitor can call the preview path, but the preview path simply never writes download stats, so there is nothing to spoof.

---

### MINOR

#### M-1. The `track` param is another `_shareId`-style vestigial trap.
The plan itself documents that `_shareId` became a misleading dead param the next reader had to untangle (plan lines 14-17, confirmed at `index.ts:101`). Adding `track?: boolean` with the convention "omit = true, preview sometimes sends false, and by the way it's intentionally NOT in the cache key" creates the same category of subtle, comment-dependent API wart. A named, server-side `intent: "preview" | "download"` (or a separate preview endpoint) is self-documenting and harder to misuse.

#### M-2. Double-count / re-open is handled only by the cache, which C-1 shows is fragile.
The plan relies on the cache to prevent re-tracking on preview re-open (plan line 69). For previewable types that happen to share a cache key with a download (C-1), that same mechanism causes under-counting. A server that records a *view* on preview and a *download* on download doesn't depend on cache identity for correctness at all — re-opening a preview is just another view, which is fine.

#### M-3. Audit `intent` addition is good but insufficient as the "fix."
Adding `metadata.intent: "preview"|"download"` to `FILE_DOWNLOAD` (plan task 1) is a genuine improvement and should stay. But note that if the recommended design is adopted, a preview is arguably not a `FILE_DOWNLOAD` audit event at all — consider a distinct audit action or at least ensure the `intent` field is the *server's* determination, not an echo of the client flag.

#### M-4. Scope: deferring reverse-shares is defensible here.
Reverse shares use a different endpoint (`getCachedReverseShareDownloadUrl`) and track *uploads* (`uploadedAt`), not downloads — there is no `downloadCount`/`lastDownloadedAt` analog on that path, so the B-34 symptom genuinely cannot occur there. Deferring is fine, but the follow-up note in the plan should be promoted to a tracked item in `TECHNICAL-DEBT.md` / `BUGS.md` rather than living only in the plan's "out of scope" section, per the project's "fix it properly / track what you defer" standard.

#### M-5. Test gap implied by C-1.
The plan's tests (task 4) cover `track omitted` and `track:false` in isolation, but not the **cross-path cache interaction** (preview a `.zip` → then download it → assert it counts). That is exactly the case C-1 breaks. Whatever design is chosen, add a test that a real download after a preview of the same file still tracks.

---

## Summary of required changes to the plan

1. **Resolve C-1 before anything else.** As written, the plan introduces a download-not-counted regression via cache reuse. Minimum fix: don't serve a preview-minted URL to a download read (don't cache `track:false`, or key on intent). Preferred: remove the cache from the tracking-correctness path by moving intent server-side.
2. **Reconsider option (b).** Adopt either a first-class "viewed" event (best, matches `ShareVisit.action` and the project's quality bar) or option (a) "previews never count" (acceptable). Both eliminate I-2 (client oracle) and I-3 (spoof surface) for free. Option (b) is not recommended.
3. **Make intent server-authoritative** (preview endpoint or server-mapped `intent`), so previewability is decided on the server and the tracking decision is not client-spoofable.
4. Keep the audit `intent` improvement (M-3), promote the reverse-share deferral to a tracked item (M-4), and add the cross-path cache test (M-5).

---

## Counts

- **Critical:** 1 (C-1 cache coherence — download silently stops counting)
- **Important:** 3 (I-1 view-vs-download conflation, I-2 client previewability oracle coupling, I-3 spoofable tracking on the authoritative path)
- **Minor:** 5 (M-1 vestigial param, M-2 double-count reliance, M-3 audit, M-4 scope tracking, M-5 test gap)
