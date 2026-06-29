# Review — B-31: Invitation emails sent in the operator's language

Reviewer pass over the uncommitted B-31 change (language switcher persists `user.locale`;
new `PATCH /users/me/locale`; registration/invite locale seeding; email i18n loader BCP-47
prefix matching; new `@ouitransfer/shared/locales`). Each finding is a checkbox; all must be
fixed before B-31 is Done.

## Verdict

The fix is correct in its core mechanics: the loader fallback chain (`requested → base → en`)
is sound for every stored value (full BCP-47 tags from the UI, short codes from LDAP),
`Intl.DateTimeFormat` and the email `lang` attribute both accept full tags (an improvement),
path traversal stays guarded by `LOCALE_PATTERN`, the new route is Zod-validated + JWT-gated +
CSRF-protected, and the single-source-of-truth is genuinely drift-guarded by tests. No Critical
issues. Findings below are documentation staleness, a couple of test gaps, and minor polish.

## Critical

_None._

## Important

- [x] **Invite-registration locale seeding is completely untested.** `Important`
  `apps/server/src/modules/invite/routes.ts:134` now passes `locale: getRequestUiLocale(request)`
  into `registerWithInvite`, and `apps/server/src/modules/invite/service.ts:222` conditionally
  writes it (`...(data.locale ? { locale: data.locale } : {})`). But `registerWithInvite` has
  **no test at all** — it is not referenced anywhere under
  `apps/server/src/modules/invite/__tests__/` (only `generateInviteToken` is covered). The
  parallel `/auth/register` path got three new seeding tests
  (`setup-bypass-register.integration.test.ts:223-273`); the invite path got none, despite the
  spec explicitly listing it as a seeding entry point and CLAUDE.md rule 11 requiring an
  `app.inject()` integration test for each security-critical path. Add a test asserting that the
  `NEXT_LOCALE` cookie / `Accept-Language` on the invite-registration request reaches the
  `prisma.user.create` call (cookie → `fr-FR`, base-language Accept-Language → `fr-FR`, and the
  no-signal case → column default), mirroring the `/auth/register` trio.

## Minor

- [x] **Stale loader doc comment contradicts the new behavior.** `Minor`
  `apps/server/src/modules/email/i18n/loader.ts:259-260` (the `loadLocale` JSDoc) still states:
  *"Fallback chain: requested locale → 'en'. No BCP-47 prefix matching (e.g. de-DE → de). Only
  exact locale files are loaded."* That is now false — `localeCandidates()` performs exactly the
  base-language step this comment says does not happen. Update the comment to describe the
  `requested → base language → en` chain (or delete the fallback paragraph from `loadLocale`,
  since the chain now lives in `localeCandidates`/`resolveAndInterpolate`).

- [x] **Stale `t()` / `tHtml()` JSDoc fallback chain.** `Minor`
  `apps/server/src/modules/email/i18n/loader.ts:49-52` (and the analogous block above `tHtml`)
  documents the old two-step chain ("1. Requested locale 2. English 3. Throw"). The actual chain
  is now three-step (requested → base language → en → throw). Update both JSDoc blocks so the
  public API docs match `localeCandidates()`.

- [x] **Stale schema comment: `user.locale` is no longer ISO 639-1.** `Minor`
  `apps/server/prisma/schema.prisma:44` reads `// User's preferred locale for emails (ISO 639-1)`.
  The column now stores full BCP-47 tags (`fr-FR`) from the switcher/registration *and* short
  codes (`en`, `fr`) from LDAP sync. Update the comment to reflect the mixed BCP-47 reality
  (e.g. "full UI tag like `fr-FR`, or a short code from LDAP; the email loader maps either down
  to a base language") so a future reader does not assume two-letter codes and write a consumer
  that breaks on `fr-FR`.

- [x] **Redundant `updatedAt: new Date()` in `updateLocale`.** `Minor`
  `apps/server/src/modules/user/service.ts:379` sets `updatedAt: new Date()` manually, but
  `User.updatedAt` is `@updatedAt` (schema.prisma:23) and Prisma maintains it automatically on
  every `update`. The manual assignment is dead weight (and could in theory diverge from the DB
  clock). It mirrors a pre-existing instance at service.ts:360 (avatar update), so this is
  consistency-with-a-bug rather than a new defect — per the project's "fix pre-existing issues
  along the way" standard, drop it in both places, or leave both and accept the redundancy
  knowingly. Flagging so the choice is deliberate.

## Resolution (all findings fixed)

- **Important (invite seeding untested):** added
  `apps/server/src/__tests__/invite-register-locale.integration.test.ts` — an `app.inject()` trio
  mirroring `/auth/register` (cookie → `fr-FR`, base-language Accept-Language → `fr-FR`, no-signal →
  column default), asserting the seeded locale reaches the transactional `prisma.user.create`.
- **Minor (loadLocale doc):** rewrote the JSDoc to state it loads only the exact file and that the
  base-language/en chain lives in `localeCandidates()`.
- **Minor (t/tHtml doc):** updated `t()` to the four-step chain and noted the shared chain on `tHtml()`.
- **Minor (schema comment):** `schema.prisma:44` now documents the mixed BCP-47/short-code reality.
- **Minor (redundant updatedAt):** dropped the manual `updatedAt: new Date()` in `updateLocale` AND
  the pre-existing `updateUserImage` (both rely on Prisma's `@updatedAt`).

## Reviewed and OK (no action)

- **Loader fallback chain correctness.** `localeCandidates()` always terminates in `"en"`:
  `en-US` → `["en-US","en"]`; `fr-FR` → `["fr-FR","fr","en"]`; `en` → `["en"]` (the
  `base !== locale` and `!includes("en")` guards prevent loading `en` twice and handle the
  "already en" edge). Empty string → `["", "en"]` (`"".split("-")[0]` is `""`, `base !== locale`
  is false, so just `["", "en"]`); `loadLocale("")` fails `LOCALE_PATTERN` → null → falls to en.
  Multi-subtag (`zh-Hant-CN`) → `["zh-Hant-CN","zh","en"]`, fine — though such values can never be
  stored (route enum + Accept-Language resolver only emit `^[a-z]{2}-[A-Z]{2}$` tags). The
  sync-cache path mirrors the async path and `createTranslationFn`/`createPlainTranslationFn`
  preload the full chain, so the sync resolver never misses a candidate.

- **Security.** Stored locale still flows through `LOCALE_PATTERN` (loader.ts:265) before any
  filesystem path is built; the new route enum (`z.enum(SUPPORTED_UI_LOCALES)`) is strictly
  tighter than that pattern, so no traversal vector is introduced. Route is `preValidation:
  jwtPreValidation` + global CSRF; integration test confirms 401 unauth, 400 on `xx-XX` and on
  base-only `fr`, and that rejected values never reach `prisma.user.update`. `UserResponseSchema`
  still strips `locale` from the register response (no new field leak).

- **`?? "en"` interplay across all 25+ send sites.** Every email send reads `user.locale ?? "en"`;
  with a stored `fr-FR` the `??` is a no-op and the loader maps `fr-FR → fr`, so French users now
  get French mail. `?? "en"` only triggers on a genuine null. No site assumed a two-letter value.

- **`Intl.DateTimeFormat(locale)` and email `lang` attribute** (`base-layout.ts:169`) both accept
  full BCP-47 tags; `fr-FR` yields correct regional formatting and a more accurate `lang`.

- **Anonymous-visitor safety in the switcher.** `useAuth()` has a default context value
  (auth-context.tsx:19-24) so it never throws without a provider, and `AuthProvider` wraps the
  root layout regardless; on public share pages `isAuthenticated` is `null`/`false`, so
  `updateMyLocale` is skipped. Fire-and-forget with a `logger.warn` catch is acceptable; the
  `router.refresh()` race is benign because the UI is driven by the cookie, not by `user.locale`.

- **Single-source-of-truth drift guards.** `locale-keys.test.ts` (message files ↔
  `SUPPORTED_UI_LOCALES`) and `language-switcher-flags.test.ts` (switcher `languages` ↔
  `SUPPORTED_UI_LOCALES`) both assert exact set equality; `request.ts` and server DTO consume the
  shared list. Drift is genuinely enforced.

## Note (out of scope, not a defect)

- The persisted `user.locale` is **write-only from the web UI's perspective**: the frontend
  derives its language solely from the `NEXT_LOCALE` cookie and never reads `user.locale` from
  `/auth/me`. So on a fresh browser (no cookie) a returning user sees the default UI language
  even though their account preference is set; only emails honor it. This matches the B-31 scope
  (an *email*-language fix) and the BUGS.md note, so it is acceptable — but if "preference follows
  the account into a new browser" is ever desired, `i18n/request.ts` would need to consult the
  authenticated user's stored locale as a cookie-precedence step. Recording for traceability only.
