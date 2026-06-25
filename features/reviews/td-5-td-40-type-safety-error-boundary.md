# Review: TD-5 (Type Safety) + TD-40 (Global Error Boundary i18n)

**Reviewer:** Code Review Agent
**Date:** 2026-06-10
**Commits:** 0f37724 (TD-5), 1a7b35d (TD-40)

## TD-5 — Type Safety Audit

### Strengths
- **`isNotificationKey()` type guard is correct** (`email/catalog.ts:742-744`). `type in notificationCatalog` is the right runtime check, and the `type is NotificationKey` predicate narrows correctly because `NotificationKey = keyof typeof notificationCatalog` (line 739) and the catalog is `as const satisfies Record<...>` (line 734), so the key set is exact. Verified all call sites compile with the narrowed type.
- **Guard applied consistently and idiomatically.** All five sites that previously used `as NotificationKey` / `as keyof typeof notificationCatalog` now go through the guard:
  - `notification/service.ts:71-75` (update prefs — throws on unknown)
  - `notification/service.ts:114-118` (unsubscribe — silent no-op, preserves the "don't leak catalog info" defense-in-depth intent)
  - `notification/routes.ts:56-59` (`getTypeDisplayName` — falls back to raw key)
  - `email/service.ts:376` (`resolveFrequency` — `?? undefined` then `?? "immediate"`, semantics unchanged)
  This removes the `in`-check-then-blind-cast anti-pattern, which was the actual risk: the old `if (type in catalog) { catalog[type as NotificationKey] }` worked only by convention; the guard makes the narrowing type-system-enforced.
- **CSRF `getToken` fix is correct** (`app.ts:193-196`). `Array.isArray(h) ? h[0] : (h ?? "")` handles all three header shapes (`string` / `string[]` / `undefined`) and returns `""` for the absent case, which the csrf plugin treats as a missing/invalid token — correct fail-closed behavior. The old `as string` would have passed an array through as-is (or `undefined`), defeating validation.
- **Challenge `userId` runtime guard is correct** (`auth/challenge.ts:33-35`). After `jose.jwtVerify`, `payload.userId` is `unknown` from the JWT claim set; the `typeof !== "string"` check rejects numbers/objects/undefined and throws `UnauthorizedError` rather than returning a non-string `userId` that would silently corrupt downstream DB lookups. Fail-closed and security-appropriate.
- **`headerString()` utility is correct** (`auth-cookies.ts:83-85`). Handles `string | string[] | undefined`, returns first array element, preserves `undefined`. The `||` fallback chain at lines 101-102 still produces `""` when everything is absent. Behavior is identical to the old casts for the happy path but now actually type-safe for the multi-value-header path.
- **Removed body/query casts are genuinely redundant** (`notification/routes.ts:293-294`). The plugin type is `FastifyPluginAsyncZod`, so `request.body` / `request.query` are inferred from the route's Zod schema (`body: z.object({ token: z.string().optional() }).passthrough().optional()`, `querystring: z.object({ token: z.string().optional() })`). `body?.token` and `query.token` resolve correctly; removing the casts does not break inference. Verified by `tsc --noEmit` passing.
- **`tsc --noEmit` passes clean** for `ouitransfer-api` — no regressions introduced.

### Issues

#### Critical (Must Fix)
- None.

#### Important (Should Fix)
- None.

#### Minor (Nice to Have)
- [x] **`getTypeDisplayName` fallback semantics shifted slightly** (`notification/routes.ts:56-59`). Old: `entry?.displayName ?? type` — returned `type` if a (hypothetical) catalog entry existed but lacked a `displayName`. New: `if (!isNotificationKey(type)) return type; return notificationCatalog[type].displayName`. Because every catalog entry is `satisfies NotificationTypeConfig` and `displayName` is required, the entry can never lack a `displayName`, so the behavior is in fact equivalent and arguably cleaner. No action strictly required — noting only that the optional-chaining safety net was removed; it is provably unreachable, so this is acceptable.
- [x] **Deferred items — justification is sound but should be tracked.** The 4 deferred casts (Prisma `deactivationReason` enum, email catalog generic erasure, error-handler double-escape, S3 stream type) are each genuinely non-trivial: the Prisma enum and S3 stream casts cross library type boundaries, and the catalog generic erasure is a known TS limitation around mapped-type payload inference. Deferral is justified. Confirm these are recorded in `TECHNICAL-DEBT.md` so they are not lost — the commit message lists them but the tracking file is the source of truth.

## TD-40 — Global Error Boundary i18n

### Strengths
- **Correct architectural choice.** A `global-error.tsx` catches root-layout crashes, so the next-intl provider, theme provider, and `next/link` are all unavailable. Inlining a static translation map and using a raw `<a href="/">` (line 269) is the right call — `useTranslations()` would throw inside this very boundary. The comment at lines 9-14 documents this clearly.
- **Locale base-code mapping is correct.** The `NEXT_LOCALE` cookie stores full codes (`fr-FR`, `pt-BR`, `zh-CN`) — confirmed via `language-switcher.tsx:57` and `i18n/request.ts:35`. `detectLocale()` does `.split("-")[0].toLowerCase()` (line 202) → base code, and the `translations` map is keyed by base code (`fr`, `pt`, `zh`). Every one of the 23 supported locales maps to a present key. Verified `pt-BR → pt`, `zh-CN → zh`, `ar-SA → ar` all resolve.
- **RTL set is complete.** `["ar", "fa", "he"]` (line 229) matches `RTL_LANGUAGES = ["ar-SA", "fa-IR", "he-IL"]` (`lib/rtl-languages.ts:2`) exactly (as base codes). No RTL locale is missed.
- **SSR-safe against crashes.** `detectLocale()` wraps `document.cookie` / `navigator.language` in try/catch (lines 198-208). During server prerender `document` is undefined → returns `"en"`. No server crash. `tsc --noEmit --skipLibCheck` passes for `ouitransfer-web`.
- **Fallback chain works.** `getStrings(lang)` returns `translations[lang] ?? translations.en` (line 212), and `en` is always present, so an unknown base code degrades to English rather than rendering `undefined`.

### Issues

#### Critical (Must Fix)
- None.

#### Important (Should Fix)
- [x] **Hydration mismatch on `<html lang>`, `<html dir>`, and all text content** (`global-error.tsx:226-232, 257-274`). `global-error.tsx` is server-rendered by Next.js App Router. On the server, `detectLocale()` returns `"en"` (no `document`), so the markup is `<html lang="en" dir="ltr">` with English strings. On the client, `useMemo(() => detectLocale(), [])` runs during the same initial render pass and returns the real locale (e.g. `fr`), producing `<html lang="fr">` + French text. React will emit a hydration mismatch warning and, for an RTL locale, the `dir` attribute flip can cause a visible layout jump. For a non-English user this also means a flash of English before correction.
  **Fix:** Defer locale-dependent rendering to a post-mount state so the server and first client render agree on English, then update after mount:
  ```tsx
  const [lang, setLang] = useState("en");
  useEffect(() => { setLang(detectLocale()); }, []);
  const t = getStrings(lang);
  const dir = ["ar", "fa", "he"].includes(lang) ? "rtl" : "ltr";
  ```
  This trades a one-frame English flash (already implicitly present) for a clean, warning-free hydration. Using `useMemo` with `[]` does *not* avoid the mismatch — `useMemo` runs during render on both server and client, and the two environments disagree on `document` availability.

#### Minor (Nice to Have)
- [x] **Hardcoded English fallback ignores the configured default locale** (`global-error.tsx:207, 212`). The app supports `NEXT_PUBLIC_DEFAULT_LANGUAGE` (`i18n/request.ts:30-31`). A deployment defaulting to, say, German will still show English in the error boundary for any user without a `NEXT_LOCALE` cookie whose browser is not German. `NEXT_PUBLIC_*` env vars are inlined at build time and *are* available in client components, so `detectLocale()` could fall back to `process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE` (split to base code) before hardcoding `"en"`. Low impact (only the rare crash-without-cookie path) but trivially correct to wire up.
- [x] **Cookie value not `decodeURIComponent`-ed** (`global-error.tsx:200`). The cookie is written with `encodeURIComponent(fullLocale)` (`language-switcher.tsx:57`). For all 23 current locale codes this is a no-op (no special chars), so it works today. For consistency and future-proofing, decode the captured group: `decodeURIComponent(match[1])` before `.split("-")`. Harmless now; defensive.
- [x] **RTL list duplicated as base codes instead of reusing `RTL_LANGUAGES`** (`global-error.tsx:229`). `RTL_LANGUAGES` is full-code (`ar-SA`), so it can't be reused verbatim against the base-code `lang`. Consider exporting a `RTL_BASE_LANGUAGES = ["ar", "fa", "he"]` (or deriving it) from `lib/rtl-languages.ts` and importing it, so the RTL set has a single source of truth and a new RTL language is added in one place. The current duplication is a small DRY violation, not a bug.
- [x] **Translation quality of placeholder locales** — As stated in the brief, only EN/FR are expected to be high quality; the other 21 are machine/placeholder translations. The EN and FR strings read naturally and correctly. The others are plausible but should be flagged for native-speaker review before any claim of "fully localized." Not a blocker for an error-boundary safety net. (Spot-checked de, es, ja, ru — all grammatically reasonable.)

## Recommendations
- **TD-5:** Ship as-is. The fixes are textbook — replacing convention-based casts with type-system-enforced guards, all fail-closed on the security-relevant paths (CSRF, challenge token). Just confirm the 4 deferred items live in `TECHNICAL-DEBT.md`.
- **TD-40:** Address the hydration mismatch (Important) before merge — it produces console warnings on every non-English crash and a visible RTL layout flip. Move locale detection into `useEffect` + `useState`. The three Minor items can be bundled into the same small follow-up: decode the cookie, fall back to `NEXT_PUBLIC_DEFAULT_LANGUAGE`, and centralize the RTL base-code list.

## Assessment
**Ready to merge?** TD-5: Yes. TD-40: With fixes (one Important).
**Reasoning:** TD-5 is correct, type-checked, and security-sound with no outstanding issues. TD-40 is functionally correct and a clear improvement over the hardcoded-English baseline, but the server/client locale disagreement causes a genuine hydration mismatch that should be fixed with a `useEffect`/`useState` pattern before merge.
