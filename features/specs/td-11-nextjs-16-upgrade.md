# TD-11 — Next.js 15 → 16 Upgrade

## Overview

Next.js 16 makes Turbopack the default bundler, renames middleware to proxy, and drops sync request API access.

**Current state:** Next.js 15.5.18 (pinned in `pnpm-workspace.yaml` catalogs)
**Target:** Next.js 16.x (latest stable, currently 16.2.x)
**Codemod available:** `pnpm dlx @next/codemod@canary upgrade latest`

## Breaking Changes (Impact on Ouitransfer)

### 1. Middleware → Proxy Rename (HIGH impact)

- `middleware.ts` → `proxy.ts`
- `export function middleware` → `export function proxy`
- `skipMiddlewareUrlNormalize` → `skipProxyUrlNormalize`
- **Edge runtime NOT supported in `proxy.ts`** — runs on Node.js only
- **next-intl** already supports `proxy.ts` in v4.12+

### 2. Turbopack Default (MEDIUM impact — verify)

- `next dev` and `next build` use Turbopack by default
- No custom webpack config in our project → should work
- Remove `--turbopack` flag from scripts if present
- Sass `~` prefix imports not supported → verify no usage

### 3. Async Request APIs — Sync Removed (CHECK)

Sync access to `cookies()`, `headers()`, `params`, `searchParams` fully removed (was deprecated in v15). Must verify all are already `await`ed. Should be fine since v15 migration was done.

### 4. `next lint` Removed (NO impact)

Project uses Biome, not `next lint`.

### 5. Parallel Routes Need `default.js` (CHECK)

All parallel route slots require explicit `default.js`. Verify if any parallel routes exist.

### 6. `next/image` Default Changes (LOW impact)

- `minimumCacheTTL`: 60s → 4 hours
- `imageSizes`: 16px removed from list
- `qualities`: `[1..100]` → `[75]` only
- Review if any explicit image config overrides needed

### 7. React 19 → 19.2 (LOW impact)

Backward compatible. New features available (`<ViewTransition>`, `useEffectEvent`, `<Activity>`) but not required.

### 8. Removals (verify no usage)

- AMP support (`useAmp`, `config.amp`)
- `serverRuntimeConfig` / `publicRuntimeConfig`
- `devIndicators` options
- `next/legacy/image`
- `images.domains` (use `images.remotePatterns`)
- `eslint` config option in `next.config`
- `experimental.dynamicIO`, `experimental.useCache`, `experimental.ppr`

## Version Requirements

| Requirement | Current | Required |
|-------------|---------|----------|
| Node.js | 24 | 20.9+ ✅ |
| React | 19 | 19.2 (update needed) |
| TypeScript | 5.x | 5.1+ ✅ |

## Dependency Compatibility

| Dependency | Compatible? | Notes |
|------------|-------------|-------|
| **next-intl** (^4.3.1) | ✅ v4.12+ | Supports `proxy.ts`, async `params` |
| **shadcn/ui** | ✅ | Code-generated, no runtime dep |
| **Tailwind CSS 4** | ✅ | Bundler-independent |
| **Radix primitives** | ✅ | React 19.2 compatible |
| **lucide-react** | ✅ | No known issues |
| **motion** (framer-motion) | ✅ verify | Check latest compatibility |

## Automated Migration

```bash
pnpm dlx @next/codemod@canary upgrade latest
```

The codemod handles:
- Turbopack config move to top-level
- `middleware.ts` → `proxy.ts` rename + export rename
- Remove `unstable_` prefix from stabilized APIs
- Remove `experimental_ppr` Route Segment Config

Additional codemods:
```bash
npx @next/codemod@canary migrate-to-async-dynamic-apis .  # if any sync APIs remain
npx next typegen  # auto-generate types for async params/searchParams
```

## Risk Assessment

- **Medium risk** — middleware rename is the biggest change, but next-intl handles it
- **Codemod reduces manual work** significantly
- **Test suite** — 222 web tests + E2E validates frontend
- **No webpack config** — Turbopack switch should be transparent

## Decisions

1. **Use codemod first**, then manual fixes for anything it misses
2. **Update next-intl** to latest v4.x before upgrading Next.js
3. **Keep `middleware.ts`** only if Edge runtime is strictly needed (likely not)
