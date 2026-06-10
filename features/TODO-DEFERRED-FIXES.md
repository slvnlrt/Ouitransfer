# Deferred Fixes — Priority for Next Session

Items incorrectly deferred during the 2026-06-10 overnight session.
The project standard is "zero technical debt" — none of these should have been left behind.

---

## 1. Zod v4 — `.describe()` → `.meta()` migration (620 uses, 22 files)

**What:** Every `.describe("...")` call in server schemas should use `.meta({ description: "..." })` instead.
`.describe()` is still functional but explicitly deprecated in Zod v4 — the preferred API is `.meta()`.

**Scope:** 620 uses across 22 files in `apps/server/src/`:

| Count | File |
|------:|------|
| 86 | `modules/file/routes.ts` |
| 81 | `modules/reverse-share/dto.ts` |
| 78 | `modules/reverse-share/routes.ts` |
| 74 | `modules/share/dto.ts` |
| 53 | `modules/folder/routes.ts` |
| 52 | `modules/auth/routes.ts` |
| 31 | `modules/share/routes.ts` |
| 28 | `modules/user/routes.ts` |
| 22 | `modules/app/routes.ts` |
| 21 | `modules/two-factor/routes.ts` |
| 17 | `modules/storage/routes.ts` |
| 15 | `modules/invite/dto.ts` |
| 10 | `modules/auth-providers/dto.ts` |
| 10 | `modules/audit/routes.ts` |
| 9 | `modules/quota/dto.ts` |
| 9 | `modules/background-image/dto.ts` |
| 7 | `modules/auth/dto.ts` |
| 7 | `modules/app/dto.ts` |
| 5 | `modules/file/dto.ts` |
| 2 | `modules/quota/routes.ts` |
| 2 | `env.ts` |
| 1 | `modules/invite/routes.ts` |

**Transform:** `.describe("X")` → `.meta({ description: "X" })`

**Verify:** `jsonSchemaTransform` (swagger) must still pick up descriptions from `.meta()` — check
the `@fastify/type-provider-zod` v1 source to confirm it reads `.meta({ description })`.
If not, keep `.describe()` until FTPZ supports `.meta()`.

---

## 2. Zod v4 — Deprecated `.email()` / `.url()` method forms (19 uses)

**What:** `z.string().email()` and `z.string().url()` are deprecated in Zod v4.
Replace with top-level `z.email()` and `z.url()`.

### `z.string().email()` → `z.email()` (16 uses)

| File | Line(s) |
|------|---------|
| `modules/user/routes.ts` | 52, 85 |
| `modules/user/dto.ts` | 7, 24 |
| `modules/auth/routes.ts` | 79, 170, 389 |
| `modules/share/routes.ts` | 1059 |
| `modules/share/dto.ts` | 10, 12, 171 |
| `modules/reverse-share/dto.ts` | 93, 171, 206, 219, 230 |
| `modules/notification/routes.ts` | 371 |
| `modules/email/catalog.ts` | 98 |

**Note:** Some of these chain further methods (`.optional()`, `.describe()`, `.max()`).
`z.email()` extends `ZodString`, so `.optional()`, `.max()`, `.meta()` etc. all work on it.

### `z.string().url()` → `z.url()` (3 uses)

| File | Line |
|------|------|
| `modules/user/routes.ts` | 408 |
| `modules/auth-providers/dto.ts` | 61, 97 |

### `z.string().trim()` — status unclear

5 uses in `two-factor/routes.ts` (3), `background-image/dto.ts` (1), `group/dto.ts` (1).
`.trim()` was NOT mentioned as deprecated in the Zod v4 changelog — verify before touching.

---

## 3. TD-5 deferred — Prisma `deactivationReason` String? → enum

**What:** `Share.deactivationReason` and `ReverseShare.deactivationReason` are `String?` in Prisma
schema with a comment listing allowed values. Code casts `string | null` to `DeactivationReason | null`
without validation.

**Files:**
- `apps/server/prisma/schema.prisma:125` — `deactivationReason String?` (Share)
- `apps/server/prisma/schema.prisma:351` — `deactivationReason String?` (ReverseShare)
- `apps/server/src/modules/share/service.ts:90` — `share.deactivationReason as DeactivationReason | null`

**Fix:**
1. Add a Prisma `enum DeactivationReason { expired max_views manual }` to schema.prisma
2. Change both fields to `deactivationReason DeactivationReason?`
3. Create migration: `pnpm --filter ouitransfer-api exec prisma migrate dev --name add-deactivation-reason-enum`
4. Remove the `as DeactivationReason` cast in `share/service.ts:90`
5. Update the `DeactivationReason` TypeScript type to use Prisma's generated enum
6. Note: ReverseShare only uses `"expired" | "manual"` (no `"max_views"`) — consider whether
   to use the same enum or separate ones. A single enum with unused values is simpler.

---

## 4. TD-5 deferred — Email catalog generic type erasure

**What:** `NotificationTypeConfig` interface declares `payloadSchema: z.ZodType` (unparameterized),
erasing the payload type. This forces `as EmailPayloads[T]` casts downstream.

**Files:**
- `apps/server/src/modules/email/catalog.ts:48` — `payloadSchema: z.ZodType` (root cause)
- `apps/server/src/modules/email/service.ts:131` — `parsed.data as EmailPayloads[T]`
- `apps/server/src/modules/email/service.ts:239` — `formattedData as unknown`
- `apps/server/src/modules/email/catalog.ts:81` — `fn as (data: any, t: TranslationFn) => LayoutSlots`

**Fix:** Make `NotificationTypeConfig` generic:
```ts
interface NotificationTypeConfig<T = unknown> {
  payloadSchema: z.ZodType<T>;
  render: (data: T, t: TranslationFn) => LayoutSlots;
  // ...
}
```
Then parameterize each catalog entry. This eliminates the downstream casts.

**Complexity:** Medium — the `as const satisfies` pattern on the catalog object needs adjustment
to work with the generic. May require a builder function or explicit type annotations per entry.

---

## 5. TD-5 deferred — Error handler `as unknown as` double-escape

**What:** `error-handler.ts:172` uses `error as unknown as Parameters<typeof handleZodValidationError>[0]`
— a double-escape indicating a real type boundary mismatch.

**File:** `apps/server/src/utils/error-handler.ts:172`

**Root cause:** `hasZodFastifySchemaValidationErrors(error)` is a type guard, but its narrowing
doesn't carry through because `error` is typed as `FastifyError | Error` in the handler signature.

**Fix:** Extract the validation error type from `@fastify/type-provider-zod` and use a proper
type assertion or restructure the conditional to let the type guard narrow correctly. The simplest
fix is to assign the guard result and use the narrowed variable:
```ts
if (hasZodFastifySchemaValidationErrors(error)) {
  // error is now narrowed by the type guard — pass directly
  return handleZodValidationError(error);
}
```
If FTPZ's type guard doesn't narrow to the exact type `handleZodValidationError` expects,
adjust `handleZodValidationError`'s parameter type to match the guard's return type.

---

## 6. TD-5 deferred — S3 `response.Body as NodeJS.ReadableStream`

**What:** AWS SDK v3 types `Body` as `SdkStream<...> | undefined`. The cast to `NodeJS.ReadableStream`
is unverified — `SdkStream` is a web-compatible stream wrapper, not a `NodeJS.ReadableStream`.

**File:** `apps/server/src/providers/s3-storage.provider.ts:190`

**Fix:** Use AWS SDK streaming utilities:
```ts
import { Readable } from "node:stream";
// ...
const body = response.Body;
if (!body) throw new Error("Empty response body");
// AWS SDK v3 SdkStream implements Symbol.asyncIterator
return Readable.from(body as AsyncIterable<Uint8Array>);
```
Or use `body.transformToByteArray()` / `body.transformToWebStream()` depending on consumer needs.

---

## 7. Translations — TD-43 notification descriptions (21 locales × 18 keys)

**What:** The 21 non-EN/FR locale files have English placeholder text for the `notificationPreferences.descriptions`
namespace (18 keys each). These should be translated to the target language.

**Locales:** ar-SA, de-DE, el-GR, es-ES, fa-IR, he-IL, hi-IN, id-ID, it-IT, ja-JP, ko-KR,
nl-NL, pl-PL, pt-BR, ru-RU, sv-SE, th-TH, tr-TR, uk-UA, vi-VN, zh-CN

**File pattern:** `apps/web/messages/{locale}.json` → `notificationPreferences.descriptions.*`

**Keys to translate (18):**
```
share_accessed, share_downloaded, share_expiring, share_expired,
share_pending_deletion, share_max_views_reached, share_no_activity,
reverse_share_uploaded, reverse_share_expiring, reverse_share_expired,
reverse_share_pending_deletion, reverse_share_auto_deleted,
quota_warning, quota_exceeded, files_auto_deleted, share_auto_deleted,
admin_user_registered, admin_quota_alert
```

**Reference text (en-US):** See `apps/web/messages/en-US.json` under `notificationPreferences.descriptions`.

---

## 8. Translations — TD-40 global error boundary (verify quality)

**What:** The inline translation map in `apps/web/src/app/global-error.tsx` was generated by LLM,
not verified by native speakers. The 4 strings per locale should be reviewed for accuracy.

**File:** `apps/web/src/app/global-error.tsx` (lines 28-196, `translations` object)

**Strings per locale (4):** title, description, tryAgain, goHome

**Action:** Review each locale's translations. Fix any that are awkward or incorrect.
Since this is LLM-generated, the quality is likely acceptable but not guaranteed for all 23 locales.

---

## 9. Translations — TD-36 broader scope (149 strings × 21 locales)

**What:** ~149 strings across multiple namespaces were added to all locale files with English values
during feature development. Only en-US (source) and fr-FR (manually translated) have correct values.

This is tracked as TD-36 in `TECHNICAL-DEBT.md` with full scope breakdown by namespace.
Items 7 and 8 above are subsets of this broader issue.

**Priority order for translation:**
1. `errors.*` (8 keys) — UX critical, shown during failures
2. `audit.*` (61 keys) — largest namespace
3. `quickShare.*` (13 keys)
4. `settings.*` (12 keys)
5. `backgroundImages.*` (9 keys)
6. `ldap.*` (29 keys)
7. Remaining (~17 keys across `fileActions`, `folderActions`, etc.)

**Approach:** Process one namespace at a time, all 21 locales per namespace. Use LLM translation
capabilities. Reference `en-US.json` for source text, `fr-FR.json` for translation quality baseline.
