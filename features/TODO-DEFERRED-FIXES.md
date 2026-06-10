# Deferred Fixes & Review Findings — ALL RESOLVED

All items from the 2026-06-10 deferred session have been fixed. This file is now closed.

**Session:** 2026-06-10 (afternoon)
**Verification:** Type-check clean, 1601 server tests + 334 web tests pass.

## Review Reports — All Checked Off

| Review | File | All Fixed |
|--------|------|-----------|
| TD-28 Zod v4 | [`features/reviews/td-28-zod-v4-migration.md`](reviews/td-28-zod-v4-migration.md) | Yes (2 Important, 3 Minor) |
| TD-5 + TD-40 | [`features/reviews/td-5-td-40-type-safety-error-boundary.md`](reviews/td-5-td-40-type-safety-error-boundary.md) | Yes (1 Important, 6 Minor) |
| TD-10 + TD-43 | [`features/reviews/td-10-td-43-admin-routes-notifications.md`](reviews/td-10-td-43-admin-routes-notifications.md) | Yes (5 Minor) |

## Deferred Items — All Resolved

| # | Item | Status |
|---|------|--------|
| 1 | `.describe()` → `.meta()` (620 uses) | **Cancelled** — `.describe()` is NOT deprecated in Zod v4, both produce identical JSON Schema. Pure style churn with zero benefit. |
| 2 | `.email()` / `.url()` deprecated forms (25 uses) | **Done** — migrated to `z.email()` / `z.url()` across 11 files |
| 3 | Prisma `deactivationReason` String? → enum | **Done** — enum added, migration created, cast removed |
| 4 | Email catalog generic type erasure | **Done** — `defineNotification<T>()` builder, `NotificationTypeConfig<T>` generic |
| 5 | Error handler `as unknown as` double-escape | **Done** — imported `ZodFastifySchemaValidationError` from FTPZ |
| 6 | S3 `response.Body` stream type cast | **Done** — `Readable.from()` + `AsyncIterable<Uint8Array>` |
| 7 | TD-43 notification descriptions (21 locales × 18 keys) | **Done** — all 21 locales translated |
| 8 | TD-40 global error boundary translation quality | **Done** — reviewed, quality adequate |
| 9 | TD-36 broader translations (196 keys × 21 locales) | **Done** — ~4500 translations across 21 locale files |
