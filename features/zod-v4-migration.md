# Zod v3 → v4 Migration Assessment

## 1. Total Files Importing from `zod`

**46 source files** (excluding `dist/` and `node_modules/`):
- `apps/server/src`: ~37 files (all route files + dtos + env.ts + utils/error-response-schema.ts + utils/error-handler.ts + shared/quota-schema.ts + audit/service.ts)
- `apps/web/src`: 9 files (env.ts, login, profile, settings, forgot-password, reset-password, users-management, groups-management, admin/ldap hooks + login/register-form component)

## 2. Dependency Configuration

- `pnpm-workspace.yaml` catalog: `zod: "^3.25.67"` (line 15)
- `apps/server/package.json`: `"zod": "catalog:"` and `"fastify-type-provider-zod": "^4.0.2"`
- `apps/web/package.json`: `"zod": "catalog:"`
- Current resolved version (from lockfile): `zod@3.25.76`

Both `apps/server` and `apps/web` pull zod from the catalog. Only the server depends on `fastify-type-provider-zod`.

## 3. All Zod APIs Found

| API Pattern | Count | Files |
|---|---|---|
| `z.object({...})` | ~331 uses | All routes/dtos |
| `z.string()` | ~400+ uses | Ubiquitous |
| `z.string().min()` / `.max()` | ~50+ uses | Validation constraints |
| `z.string().email()` | ~15 uses | User schemas, share schemas |
| `z.string().url()` | ~5 uses | Profile image, share links |
| `z.string().regex()` | ~3 uses | Alias validation |
| `z.string().trim()` | ~8 uses | TOTP tokens, names |
| `z.string().optional()` | Many | Optional fields |
| `z.string().nullable()` | Many | Nullable fields |
| `z.number()` | ~50+ uses | IDs, counts, pagination |
| `z.number().int()` | ~10 uses | Pagination, ports, limits |
| `z.number().positive()` | ~8 uses | File sizes, limits |
| `z.boolean()` | ~60+ uses | Flags, toggles, settings |
| `z.date()` | ~30 uses | Timestamps |
| `z.null()` | ~10 uses | Nullable responses |
| `z.unknown()` | 2 uses | Metadata, error details |
| `z.literal()` | ~10 uses | Env vars ("true"/"false") |
| `z.enum()` | ~20 uses | Status, types, methods |
| `z.union()` | ~20 uses | Optional/nullable unions |
| `z.array()` | ~70 uses | Lists, collections |
| `z.record()` | 1 use | `apps/web/settings/hooks`: `z.record(z.string())` — single-arg, will break |
| `z.coerce.number()` | 10 uses | Env vars, query params |
| `z.coerce.boolean()` | 2 uses | Force flags |
| `z.coerce.date()` | 1 use | Invite expiration |
| `.describe()` | ~568 uses | OpenAPI schema descriptions |
| `.default()` | 26 uses | Default values |
| `.optional()` | ~100+ uses | Optional fields |
| `.nullable()` | ~30 uses | Nullable fields |
| `.refine()` | 11 uses | Password confirm, env secrets, auth-providers |
| `.transform()` | 4 uses | Quota bigint, env lowercase, nullable |
| `.extend()` | 8 uses | Schema extension (auth, user, reverse-share) |
| `.passthrough()` | 5 uses | LDAP routes (`z.object({}).passthrough()`) — already using v4 name |
| `.or()` | 4 uses (web) | `z.string().optional().or(z.literal(""))` |
| `z.infer<>` | 29 uses | Type inference |
| `z.input<>` | 3 uses | `auth-providers/dto.ts` — captures pre-transform shape |
| `z.ZodIssueCode.custom` | 6 uses | `quota-schema.ts`, `ldap-config.ts` |
| `z.NEVER` | 3 uses | `quota-schema.ts` |
| `ZodTypeProvider` | 1 use | `server/src/app.ts` |
| `FastifyPluginAsyncZod` | 22 uses | All route files |
| `hasZodFastifySchemaValidationErrors` | 1 use | `error-handler.ts` |
| `isResponseSerializationError` | 1 use | `error-handler.ts` |
| `serializerCompiler` / `validatorCompiler` | 4 uses | `app.ts` + 3 test files |
| `jsonSchemaTransform` | 1 use | `swagger.config.ts` |

**Not used** (safe): `z.intersection()`, `z.nativeEnum()`, `z.promise()`, `z.function()`, `z.brand()` / `.brand()`, `z.preprocess()`, `z.ostring()`/`z.onumber()`, `.nonstrict()`, `.strip()`, `.strict()`, `.merge()`, `.partial()`, `.pick()`, `.omit()`, `.deepPartial()`, `.nonempty()`, `.superRefine()`, `.catch()`, `.pipe()`

## 4. fastify-type-provider-zod Compatibility

This is the main blocker.

| Current | Required for v4 |
|---|---|
| `fastify-type-provider-zod@4.0.2` (peers zod v3) | `fastify-type-provider-zod@>=5.0.0` (peers zod v4) |

**Key changes in v5+ of fastify-type-provider-zod:**
- Import from `zod/v4` instead of `zod` — every import path changes
- Drops `zod-to-json-schema` dependency in favor of zod's built-in JSON Schema
- `jsonSchemaTransform` may behave differently (schemas need `id` properties in global registry)
- Error response structure may differ from zod v3

**Version tiers for fastify-type-provider-zod:**
- **v5.x** (June 2025): First zod v4 support, import from `zod/v4`
- **v6.x** (Sep 2025): Latest stable, same import pattern
- **v7.x** (Jan 2026): Requires zod v4.2+, uses `.encode()`/`.decode()` APIs
- Also: `@fastify/type-provider-zod` (v1.0.0, April 2026) is the new official fastify org package, requires zod v4.2+

## 5. Migration Blocker Details

### CRITICAL blockers — must be addressed:

| # | Issue | Impact | Details |
|---|---|---|---|
| B1 | `fastify-type-provider-zod` must upgrade to v5+ | ALL server routes | Currently v4.0.2, incompatible with zod v4. Must bump to `^5.0.0` or `^6.0.0` |
| B2 | All imports must change from `"zod"` to `"zod/v4"` | 46 files | No shorthand — `fastify-type-provider-zod` v5+ requires `import { z } from 'zod/v4'` |
| B3 | `z.record(z.string())` — single argument dropped | 1 file: `apps/web/settings/hooks/use-settings.ts` | In v4, `z.record()` requires 2 args: `z.record(keySchema, valueSchema)` |
| B4 | Error handler `handleZodValidationError` | 1 file: `error-handler.ts` lines 96-118 | The `validation` array structure from `fastify-type-provider-zod` may differ in v5+ due to zod v4's changed issue format. The custom `Symbol.for("ZodFastifySchemaValidationError")` in tests (line 79) may also change |
| B5 | `z.input<>` behavior may differ | 3 uses: `auth-providers/dto.ts` lines 121-131 | Pre-transform shape capture may work differently if zod v4 changed how transforms and refinements interact with input types |

### IMPORTANT issues — need careful handling:

| # | Issue | Impact | Details |
|---|---|---|---|
| I1 | `z.number().int()` now rejects unsafe integers (>2^53) | ~10 uses | Port numbers, pagination limits are safe, but verify all `int()` inputs don't exceed `Number.MAX_SAFE_INTEGER` |
| I2 | `.default()` behavior changed for optional fields | ~26 uses | In v4, defaults inside optional fields ARE applied (v3 ignored them). `z.boolean().optional().default(false)` will now always produce `false` instead of `undefined` for missing keys |
| I3 | `.describe()` is deprecated (but still works) | ~568 uses | Works in v4, but emits deprecation warnings. `.meta()` is the replacement |
| I4 | `.email()` / `.url()` deprecated | ~20 uses | Still works in v4 but deprecated. Top-level `z.email()` / `z.url()` recommended |
| I5 | `.refine()` no longer has `ctx.path` | 0 direct uses | No code uses `ctx.path`, but if any `.refine()` fn uses the second param's `path` property, it will break |
| I6 | `z.coerce` input type changed to `unknown` | 10 uses | `z.input<typeof schema>` now yields `unknown` instead of `string` for `z.coerce.number()` etc. |
| I7 | `z.unknown()` / `z.any()` no longer "key optional" in objects | 2 uses | `z.object({a: z.unknown()})` produces `{a: unknown}` not `{a?: unknown}`. But only 2 uses in `ErrorResponseSchema` |
| I8 | `z.ZodIssueCode.custom` → `z.core.$ZodIssueCustom` | 6 uses | `z.ZodIssueCode.custom` may still work but the types moved to `z.core.*` namespace |
| I9 | `jsonSchemaTransform` may require `id` in global registry | 1 file: `swagger.config.ts` | The new `z.toJSONSchema()` requires schemas to have `id` in the global registry for swagger compatibility |

### MINOR issues — cosmetic or deprecated APIs:

| # | Issue | Impact | Details |
|---|---|---|---|
| M1 | `z.object({}).passthrough()` → use `z.looseObject({})` | 5 uses | Both work; the old `.passthrough()` is deprecated |
| M2 | `.or()` usage might need review | 4 uses (web) | `z.string().optional().or(z.literal(""))` — should still work but verify |
| M3 | `z.NEVER` → `z.core.NEVER` | 3 uses | May still work, types may have moved |

## 6. Summary Effort Estimate

**Files touched**: 46 source files + pnpm-workspace.yaml + 2 package.json files

**High-risk areas** (need testing):
1. `fastify-type-provider-zod` upgrade (v4→v5+): changes to error response shape, swagger integration, serialization
2. Error handler refactoring for new ZodError format
3. All route validation schemas need to work with `zod/v4` imports
4. Swagger config may break if `jsonSchemaTransform` behaves differently

**Low-risk mechanical changes**:
- Bulk find-and-replace `from "zod"` → `from "zod/v4"` in 46 files
- Fix single `z.record(z.string())` → `z.record(z.string(), z.string())`
- Catalog version bump

**Total estimated effort**: Medium-high. The fastify integration upgrade is the riskiest part — if error handling or swagger breaks, it will ripple across the entire server. The `.default()` behavior change in optional fields is a subtle semantic change that could cause unexpected bugs.
