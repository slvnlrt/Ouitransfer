# B-34 Plan — Design Review (v2, second pass)

**Plan reviewed:** `features/plans/b-34-preview-not-counted-as-download.md` (v2)
**Supersedes:** `features/reviews/b-34-plan-review.md` (v1 review: 1 Critical + 3 Important + 5 Minor)
**Reviewer:** Architecture / design review (pre-implementation, second pass)
**Scope:** Does v2 actually resolve the v1 findings, is it consistent with the real code, and does it introduce new problems?

---

## Verdict

**Approve with required changes.**

v2 adopts the v1-recommended design (option 1: a first-class server-recorded `preview` event that never touches download stats) and that design genuinely resolves the substantive v1 findings — C-1, I-1, I-2 are closed, and I-3 is honestly shrunk to a documented low-stakes trade-off. The direction is correct and I would not reject it.

But the plan has **two concrete inaccuracies that will mislead the implementer** and must be fixed in the plan text before implementation:

1. **The `/visits` File-name join is described as a Prisma `include` / "LEFT JOIN File" — but `ShareVisit` has no `file` relation.** `fileId` is a bare `String?` with no `@relation` (schema.prisma:246). You cannot `include` it. This silently contradicts the plan's own "no schema migration" claim: either add a relation (= migration) or do a manual batch lookup. The plan must say which, and must handle the deleted-file / null-name case.
2. **The cache-key fix is over-credited.** Adding `intent` to the key does close C-1, but in the public-share viewer the preview and download paths *already* cache under different keys today (preview omits `shareId`, every download passes it). The real C-1 closure comes from the server now branching on `intent` so a preview no longer records a download at all — the cache key is a secondary guard. The plan should state the primary mechanism correctly and pin down `intent`'s placement in `getCacheKey` (see I-1 below) so it doesn't create a new collision/efficiency wart.

Neither is fatal; both are plan-text precision problems that, left as written, will cause the implementer to attempt an `include` that doesn't compile and to mis-reason about the cache. Fix the plan, then proceed.

I considered recommending the cleaner end-state (a dedicated tracking endpoint that removes the cache from the correctness path — see I-3). It is architecturally better and I document it, but it is **not required**: v2's server-side `intent` branch already makes tracking correctness independent of cache identity, so the residual benefit is modest. Recommend noting it as the future direction in TECHNICAL-DEBT rather than blocking on it.

---

## Verified against the real code

| Plan claim | Verified? | Notes |
|---|---|---|
| `ShareVisit.fileId` exists, populated for downloads | ✓ | schema.prisma:246; written at file/routes.ts:349 |
| `ShareVisit.action` is a plain `String` (no migration to add `"preview"`) | ✓ | schema.prisma:245 |
| Tracking fires for both preview & download via `if (shareId) trackShareDownload` | ✓ | file/routes.ts:1245; `shareId` resolved server-side from the token (`resolveDownloadTarget`), never sent by client |
| Recipient stats move only for `identificationSource === "token"` | ✓ | file/routes.ts:370-377 |
| Owner-skip guard exists | ✓ | file/routes.ts:286-288 (`if (isOwner) return`) |
| `remindNonDownloaders` keys off `lastDownloadedAt == null` | ✓ | service.ts:1150-1151 — preview leaving `lastDownloadedAt` untouched keeps it correct |
| `GET /shares/:shareId/visits` returns `action` + `fileId` | ✓ | share/routes.ts:1162-1163 |
| `/visits` `action` filter enum is `["access","download"]` | ✓ | share/routes.ts:1143 — must add `"preview"` |
| Activity section renders access(Eye)/download(Download) with filters | ✓ | share-details-activity-section.tsx:41-56, 101, 168-170 |
| streamed `POST /files/download` not web-reachable (parity-only edit) | ✓ | no web caller of `downloadFile`; web uses `getCachedDownloadUrl` only |
| `getDownloadUrl` ignores `_shareId` (cache-scope only) | ✓ | http/endpoints/files/index.ts:98-108; body is `{objectName, password}` |
| 23 locales, activity keys present in **all** of them | ✓ | not just en/fr — see M-2 |

**Claim that is WRONG:** the plan's "`include` the file name where `fileId != null` (LEFT JOIN File)" (task 2). There is **no `file` relation on `ShareVisit`** and no `shareVisits` back-relation on `File`. Prisma `include` is impossible as written.

**Claim that is imprecise:** "preview vs download already cache separately via shareId-in-key scoping" reasoning is inverted from v1, but the net effect in the *public viewer* is that they already differ (preview omits shareId at use-file-preview.ts:216; downloads pass it at use-public-share-download.ts:54/86/132/157/219/243 and use-file-preview.ts:273). The cache key is therefore not the load-bearing fix — the server `intent` branch is.

---

## Prior-finding resolution status

| v1 finding | v2 status | Evidence |
|---|---|---|
| **C-1** cache coherence (download silently stops counting) | **Resolved** | Server now branches on `intent`; a preview records `action:"preview"` and never writes download stats, so a later download is a genuinely distinct server action regardless of cache. `intent` in the key is a belt-and-suspenders guard. |
| **I-1** view vs download conflation | **Resolved** | Preview is its own `ShareVisit{action:"preview"}`; `downloadCount`/`lastDownloadedAt`/`Share.lastDownloadedAt`/email untouched ⇒ `remindNonDownloaders` stays correct (service.ts:1150). |
| **I-2** client previewability oracle (`getFileType`) | **Resolved** | Oracle dropped entirely; preview recorded for every type. No SVG/HTML attachment-disposition drift. |
| **I-3** spoofable tracking on authoritative path | **Reduced, acceptable** | Only *intent* is client-declared now; recipient attribution stays token-gated server-side (routes.ts:370-377). Residual spoof analyzed below — low stakes, correctly characterized. |
| **M-1** vestigial `track`/`_shareId` param | **Resolved** | Named `intent` enum, server-mapped, self-documenting. |
| **M-2** double-count via cache reliance | **Resolved (mostly)** | Correctness no longer depends on cache identity. One residual: cross-window preview re-open re-records a preview — see new M-3. |
| **M-3** audit `intent` | **Resolved** | `intent` (server-resolved) added to `FILE_DOWNLOAD` metadata. |
| **M-4** reverse-share scope tracked | **Resolved** | Promoted to TECHNICAL-DEBT (task 7). |
| **M-5** cross-path cache test | **Resolved** | Explicit preview-then-download regression test (task 6). |

All nine prior findings are addressed in intent. The new findings below are about plan *precision* and a few new edges v2 introduces.

---

## Findings

### IMPORTANT

#### I-1 (new). The `/visits` "file name" join is not implementable as written; it contradicts "no migration."
Task 2 says to `include` File / LEFT JOIN File. `ShareVisit` has no `file` relation (schema.prisma:233-256) and `File` has no `shareVisits` back-relation. Two real options — the plan must pick one and spell it out:

- **(a) Manual batch lookup (recommended, keeps "no migration").** After `findMany`, collect non-null `fileId`s, `prisma.file.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true } })`, build a `Map<id,name>`, attach `fileName`. One extra query per page (≤ `limit` ids) — **not** an N+1. Deleted/expired files → `fileName: null`; the UI must render a graceful fallback (e.g. "fichier supprimé" or just the action without a name).
- **(b) Add a `file File? @relation(...)` to `ShareVisit`** — cleaner queries but requires a Prisma migration, which the plan's Risk/§"no migration" explicitly disclaims. If chosen, update the Risk section.

Required plan edit: replace "`include` ... (LEFT JOIN File)" with the chosen mechanism, state the deleted-file null handling, and (if (b)) drop the "no migration" claim.

#### I-2 (new). Pin down where `intent` goes in the cache key, or you trade C-1 for a cache-efficiency/collision wart.
`getCacheKey` is `[objectName, password, shareId].filter(Boolean).join("|")` (download-url-cache.ts:23-31). `.filter(Boolean)` drops falsy segments. If `intent` is appended and a *download* caller omits it while another passes the default `"download"`, you get `obj|shareId` vs `obj|shareId|download` — two keys for the same logical request (double presign, harmless but wasteful). Worse, positional `filter(Boolean)` means a missing `shareId` shifts `intent` into the shareId slot conceptually — fine for collision here, but fragile.

Required plan edit: specify that `getCacheKey` **defaults `intent` to `"download"`** internally (so every key carries a stable intent segment) and place it in a fixed position, e.g. `[objectName, password, shareId, intent].filter(Boolean)` with intent never empty. Add the unit assertion that `preview` vs `download` (same objectName, same shareId) yield different keys (task 6 already names this — make it assert the default-intent case too).

### MINOR

#### M-1 (carried, I-3 residual). Document the one spoof that still exists and confirm it's harmless.
A recipient can send `intent:"preview"` on what is really a download. Consequence: the *download* is recorded as a preview, so `lastDownloadedAt` is not set and the recipient **stays in the `remindNonDownloaders` set**. That is the inverse of v1's spoof (which suppressed reminders) — here a spoofer keeps getting reminded, i.e. spoofing only annoys the spoofer and never hides a download from the owner in a way that benefits the spoofer. The owner's *guarantee* ("if it says downloaded, it was") is preserved; only "previewed but not downloaded" can be self-inflicted. This is acceptable and strictly better than v1. The plan's §3 says this but should state the specific `remindNonDownloaders` consequence so a future reader doesn't re-litigate it.

#### M-2 (new). i18n scope is understated vs the project's actual convention.
The plan says new preview keys go "en/fr translated, rest fall back per existing convention." But all 23 locales already carry the full `shareDetails.activity.*` set (verified de-DE, ar-SA), and the repo has `translations:check` + sync scripts using `[TO_TRANSLATE]` markers. The convention is **keys present in all 23 locales**, not runtime fallback. CLAUDE.md rule 5 ("Preserve i18n") and the quality bar apply. Required plan edit: task 5 should add the new keys to all 23 locale files (en/fr authored, the rest via the translation sync workflow) and run `pnpm --filter web translations:check`.

#### M-3 (new). Preview re-open across cache windows records a second preview.
Re-opening the same preview within the 55-min cache window is a cache hit (no server call, no second event) — fine. Across windows (or different sessions) it records another `action:"preview"` row. For an activity *log* this is arguably correct (it is a distinct viewing event), unlike a download counter. Call this out as intended in the plan so it isn't flagged later as double-counting; if the owner expects "viewed once" semantics, that needs a per-recipient aggregate (explicitly out of scope — fine).

#### M-4 (new). Owner-preview parity — make the guard explicit in `trackShareFilePreview`.
`trackShareDownload` early-returns for the owner (routes.ts:286-288). Task 1 says "mirror the owner-skip guard," which is correct — just ensure the new function reproduces the *same* `shareWithFile`/`isOwner` resolution (it needs the share lookup to know the creator). The validation checklist already covers "owner self-preview records nothing" — good; keep that test.

#### M-5 (new). Activity-log visual distinction (access vs preview) must be unambiguous, and the action filter type must widen.
Today access and preview would both naturally want an "eye". The plan calls for a distinct icon (file-with-eye) + distinct label, which is right, but: (a) the client `ActionFilter` type is `"all" | "access" | "download"` (activity-section.tsx:101) and must gain `"preview"`; (b) the server `getShareVisits` querystring enum (routes.ts:1143) must gain `"preview"`; (c) the web `getShareVisits` params type is loose (`action?: string`) so it compiles, but tighten it for safety. Cosmetic ask: ensure access (share-level, no file) reads clearly different from preview (file-level, with filename) — the plan's "A consulté le partage" vs "A consulté le fichier {fileName}" wording achieves that.

---

## Answers to the specific questions

1. **Does v2 close C-1?** Yes — but via the **server `intent` branch**, not primarily the cache key. In the public viewer, preview (no shareId) and download (shareId) already key differently; the durable fix is that a preview no longer records a download server-side at all. Add `intent` to the key with a stable default so no two logical-equal requests split keys (I-2). No download path can collide with a preview entry: download keys carry `shareId`, preview keys carry the `preview` intent segment and omit shareId.

2. **I-1/I-2/I-3 resolved?** I-1 yes (preview never touches download stats; `remindNonDownloaders` stays correct). I-2 yes (oracle fully removed). I-3 acceptably reduced — the only residual spoof makes the spoofer over-reminded, never hides a real download from the owner (M-1). Honestly characterized.

3. **New issues?** (a) The `/visits` File join is not a real relation (I-1) — biggest concrete defect. (b) Cache-key intent placement needs pinning (I-2). (c) i18n scope understated (M-2). (d) cross-window preview re-records (M-3, intended). (e) decoupling tracking from URL minting is the cleaner end-state but not required (see below). No N+1 if the batch-lookup form is used.

4. **Scope calls.** "No per-recipient preview badge" is defensible — previews live in the activity log; adding a recipient aggregate is a separate feature, not a half-done gap. "Reverse-shares deferred" is defensible: that path tracks uploads, has no download stats, so the B-34 symptom cannot occur — tracking it in TECHNICAL-DEBT satisfies the project's "track what you defer" standard. Neither violates CLAUDE.md.

5. **Best end-state?** v2's option 1 is good and sufficient. The strictly cleaner variant — a dedicated `POST /shares/:id/files/:fileId/(view|download)` tracking call that removes the presigned-URL cache from the correctness path — is architecturally superior (tracking no longer piggybacks on URL minting, so cache windows can never affect counts) but is **not worth blocking this fix**: the server `intent` branch already decouples *correctness* from the cache. Recommend recording the dedicated-endpoint refactor as a TECHNICAL-DEBT note and shipping option 1.

---

## Required changes to the plan (before implementation)

1. **Task 2:** Replace "`include` the file name (LEFT JOIN File)" with the **manual batch-lookup** form (collect `fileId`s → one `file.findMany` → map → `fileName`), or add a real `file` relation and drop the "no migration" claim. Specify `fileName: null` for deleted files and a UI fallback. *(I-1)*
2. **Task 3:** Specify `getCacheKey` defaults `intent` to `"download"` and includes it in a fixed position so every key carries a stable intent segment; add the same-shareId preview-vs-download key-difference assertion. *(I-2)*
3. **Task 5:** Add new i18n keys to **all 23 locales** (en/fr authored, rest via translation sync) and run `translations:check`; widen the client `ActionFilter` and the web `getShareVisits` `action` param to include `"preview"`; widen the server querystring enum to `access|preview|download`. *(M-2, M-5)*
4. **Design §3:** State the precise `remindNonDownloaders` consequence of an `intent:"preview"` spoof (spoofer stays reminded; owner's "downloaded ⇒ true" guarantee intact). *(M-1)*
5. **Out of scope / TECHNICAL-DEBT:** Add a note that the cleaner long-term design is a dedicated `view|download` tracking endpoint that removes the presigned-URL cache from the tracking-correctness path. *(Q5)*
6. **Risk section:** Note the cross-window preview re-record is intended log behavior. *(M-3)*

---

## Counts

- **Critical:** 0
- **Important:** 2 (I-1 non-existent File relation / "no migration" contradiction; I-2 cache-key intent placement under-specified)
- **Minor:** 5 (M-1 spoof characterization, M-2 i18n scope, M-3 cross-window re-record, M-4 owner-preview guard parity, M-5 action-filter type widening + visual distinction)

**Prior findings:** C-1, I-1, I-2 resolved; I-3 reduced to acceptable; M-1..M-5 resolved. No prior finding remains open. The two new Important items are plan-text precision defects, not design regressions.
