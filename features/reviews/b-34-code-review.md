# B-34 — Code Review (implementation)

**Reviewed:** the single feature commit `0bbd18f` on `claude/preview-not-download`
(diff `HEAD~1..HEAD`), against the v2 plan (`features/plans/b-34-preview-not-counted-as-download.md`)
and the two design reviews.
**Scope:** does the CODE correctly + cleanly implement the approved design? (No design re-litigation.)

## Verdict

**Approve.** The implementation faithfully matches the v2 plan and resolves every prior design finding.
The `resolveShareVisitContext` extraction is behavior-preserving for the download path; the preview
path records only a `ShareVisit{action:"preview"}`; the cache key + server `intent` branch close C-1;
the `/visits` batch lookup is correct and N+1-free; i18n keys are present in all 23 locales; both
type-checks, the touched test suites (14 server + 11 web), lint, and `translations:check` pass.

Findings are all **Minor** — mostly small coverage/parity/consistency notes, no correctness or security
regression.

- **Critical:** 0
- **Important:** 0
- **Minor:** 5

---

## Verified correct (the load-bearing checks)

- **`resolveShareVisitContext` is behavior-preserving for `trackShareDownload`.** The extraction moves
  share lookup, owner-skip (`isOwner` → `return null`), cookie visitor resolution, recipient resolution,
  token recipient-record backfill, and the authenticated-user fallback verbatim into the helper; the
  download body (`routes.ts:385-460`) still does the `ShareVisit{action:"download",fileId}` insert,
  token-only recipient `downloadCount`/`lastDownloadedAt` bump (`:414`), `Share.lastDownloadedAt` +
  `inactivityAlertSent:false` reset (`:425`), and the `share_downloaded` email with the same
  deactivated-creator guard. The `let visitorName/visitorEmail` reassignment now happens inside the
  helper and is returned in `ctx` — same final values, no control-flow change. `creator` select still
  carries `email/locale/isActive` for the email. ✓
- **`trackShareFilePreview` (`routes.ts:471-509`)** records ONLY `ShareVisit{action:"preview",fileId}`
  via the same `ctx`; no recipient stats, no `Share` update, no email. Fire-and-forget with a
  `.catch(log)`. Owner-skip + identity resolution shared via `resolveShareVisitContext`. ✓
- **`/files/download-url` intent branch (`routes.ts:1340-1356`)** chooses preview vs download, both
  fire-and-forget. Audit `metadata.intent` (`:1325`) records the server-resolved value. ✓
- **`/shares/:id/visits` batch lookup (`share/routes.ts:1250-1267`)**: dedupes non-null `fileId`s
  (`Set` + type guard), one `file.findMany({ where:{ id:{ in } }, select:{id,name} })`, builds
  `Map<id,name>`, attaches `fileName = fileId ? (map.get ?? null) : null`. Deleted files → `null`.
  No N+1. `action` enum widened to `access|preview|download`; response schema gained nullable
  `fileName`; `enrichedVisits` still strips `ipAddress/userAgent/userId` via destructure
  (`:1280`). ✓
- **Cache key (`download-url-cache.ts:23-34`)**: `intent` defaults to `"download"` and is in a fixed
  final position, so preview (`obj|pwd|preview`, shareId omitted) and download
  (`obj|pwd|shareId|download`) never collide, and omitted-vs-explicit download collapse to one key.
  `getDownloadUrl` only puts `intent` on the wire when `!== "download"` — consistent with the server
  default; the cache always forwards the resolved intent. Unit test asserts all three cases. ✓
- **`loadPreview` sends `intent:"preview"`** for all types (`use-file-preview.ts:220`); `handleDownload`
  and all 13 other `getCachedDownloadUrl` call sites use ≤3 args (default download); both reverse-share
  branches (`getCachedReverseShareDownloadUrl`) are untouched. Grep confirms `:220` is the only
  `"preview"` caller. ✓
- **Activity UI (`share-details-activity-section.tsx`)**: 3-way icon (`Download`/`FileSearch`/`Eye`) +
  label key, `fileName` rendered (truncated, `title`) only when present, filter widened to 4-way, types
  widened to `"access"|"preview"|"download"`. `actionParam` (`access|preview|download|undefined`)
  matches the tightened `getShareVisits` param. ✓
- **i18n**: `shareDetails.activity.{preview,filterPreview}` present in all 23 locales (en/fr real, 21 ×
  `[TO_TRANSLATE]`). `translations:check` exits 0. ✓
- **`_shareId` fully removed** from both apps. Server + web `type-check`, biome lint on touched files,
  and the touched test suites all green.

---

## Findings (all Minor — checklist)

- [x] **M-1 — Streamed `POST /files/download` was NOT given the `intent` field (plan task 1 deviation).**
  *Resolved:* kept the streamed endpoint download-only (the correct semantics — it forces attachment
  disposition and is never web-reachable for previews) and made the decision explicit: added a comment at
  the `trackShareDownload` call site explaining why, and updated the plan's task-1 bullet to document the
  deliberate choice instead of an unstated parity gap.
  `apps/server/src/modules/file/routes.ts:1378-1383` still has body `{objectName,password}` and calls
  `trackShareDownload` unconditionally (`:1455`). The plan explicitly asked to add `intent` here "for
  parity (defensive only)." *Defensible*: this endpoint forces attachment disposition
  (`setForcedAttachmentHeaders`) and is not web-reachable for previews (the web only ever mints presigned
  URLs), so streamed = download is semantically correct. **Fix (optional, for plan-fidelity):** either
  add the `intent` field + the same preview/download branch for parity, or drop the task-1 parity bullet
  from the plan and add a one-line comment at `:1455` stating the streamed path is download-only by
  design. As-is it is a silent divergence between plan and code.

- [x] **M-2 — Client preview-intent wiring (`loadPreview → getCachedDownloadUrl(..., "preview")`) has no
  test.** The prompt notes a `use-file-preview` hook test was dropped (it hung a vitest worker); it was
  never committed, so there is no regression in the suite — but the actual wiring at
  `use-file-preview.ts:220` is unverified. Coverage today: the cache unit test proves the cache *keys* on
  intent, and the server integration test proves `intent:"preview"` → preview visit, but nothing asserts
  `loadPreview` passes `"preview"` (a future refactor could silently revert it to a download). **Fix:**
  add a small, non-hanging unit test — mock `@/lib/download-url-cache`'s `getCachedDownloadUrl` and assert
  `loadPreview()` calls it with 4th arg `"preview"` and `handleDownload()` does not. Avoid the worker hang
  by mocking the cache module rather than driving the full hook/preview pipeline.
  *Resolved:* added `apps/web/src/hooks/__tests__/use-file-preview.test.tsx` (2 tests) mocking the cache
  module — asserts opening the preview calls `getCachedDownloadUrl(objectName, undefined, undefined,
  "preview")` and that `handleDownload` calls it with the default download intent (no `"preview"`),
  forwarding the shareId for cache scoping. **Root cause of the earlier worker hang found and fixed:** the
  test's `next-intl` mock returned a *fresh* `t` function each render, so `t` changed identity → the
  `loadPreview` callback (which lists `t` in its deps) changed → the load effect re-fired → setState →
  re-render, an infinite loop that pegged the worker. The mock now returns a stable `t`, mirroring real
  next-intl. Full web suite drops from ~203s (with the hung worker) to ~24s, 48 files / 437 tests green.

- [x] **M-3 — `VisitEntry` action/fileName rendering is untested at the component level.**
  `share-details-activity-section.test.tsx` only gained `fileName: null` to the fixture; the new 3-way
  icon/label switch and the `fileName` `<p>` (incl. null fallback) have no assertion. **Fix:** add cases
  for `action:"preview"` (FileSearch + preview label + fileName shown) and `action:"download"` with a null
  `fileName` (label only, no filename line). Low effort given the existing harness.
  *Resolved:* added a `B-34 — action rendering (access / preview / download)` describe block (4 tests):
  preview renders the preview label + file name and not the access label; download renders the download
  label + file name; share-level access renders the access label with NO file name (and not the
  preview/download labels); a preview/download with a null `fileName` still renders the action row without
  a file-name line.

- [x] **M-4 — Locale key ordering is inconsistent across files.** In `en-US.json`/`fr-FR.json` the new
  keys sit next to `access`/`download`; in the 21 `[TO_TRANSLATE]` locales they were appended at the END
  of the `activity` object, after the nested `source` block (e.g. `de-DE.json:2033-2034`). Cosmetic only
  (key order is irrelevant at runtime) and likely an artifact of the sync script, but it makes diffs/audits
  noisier. **Fix (optional):** none required; if desired, re-run the sync so keys land in the same position
  as the reference locale.
  *Accepted (no action):* the append-at-end ordering is exactly what `translations:sync` produces and is
  the established repo convention for machine-added `[TO_TRANSLATE]` keys (key order is runtime-irrelevant).
  Hand-reordering would diverge from the tool and churn 21 files for zero functional gain.

- [x] **M-5 — Owner self-preview of own (non-share) files logs `FILE_DOWNLOAD` with `intent:"preview"`.**
  `loadPreview` sends `intent:"preview"` for ALL non-reverse previews, including the owner's own files.
  For those there is no `shareId`, so no `ShareVisit` is recorded (correct), but the `FILE_DOWNLOAD`
  audit row now carries `metadata.intent:"preview"` for a plain owner preview. Pre-existing behavior
  already logged `FILE_DOWNLOAD` on owner preview; this only adds an `intent` label, so it is harmless and
  arguably more accurate. **No fix required** — noted for completeness so it isn't mistaken for a bug later.

---

## Notes (no action)

- The residual `intent:"preview"` spoof is correctly characterized in the design and docs (only keeps the
  spoofer in `remindNonDownloaders`; never hides a real download). The token-gated recipient-stats
  safeguard (`routes.ts:414`) is untouched.
- Cross-window preview re-record (a second `preview` row after the cache expires) is intended log
  behavior, documented in the plan and TD-56.
- Docs are complete and accurate: B-34 in `BUGS.md`/`SESSIONS.md`, TD-55 (reverse-share previews) + TD-56
  (dedicated tracking endpoint) in `TECHNICAL-DEBT.md`.

## Validation run during review

- `pnpm --filter ouitransfer-api type-check` → pass
- `pnpm --filter ouitransfer-web type-check` → pass
- `pnpm --filter ouitransfer-api vitest run share-download-access.integration` → 14 passed
- `pnpm --filter ouitransfer-web vitest run download-url-cache + share-details-activity-section` → 11 passed
- `biome check` on the 6 core changed files → clean
- `pnpm --filter ouitransfer-web translations:check` → exit 0
