# Phase 7: Dependency Modernization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dead/redundant dependencies, modernize package names, consolidate pnpm catalogs, replace date-fns with native Intl, and consolidate 3 icon libraries down to 2.

**Architecture:** Pure dependency cleanup — no new features, no architectural changes. Each task modifies `package.json` files, import statements, and optionally `pnpm-workspace.yaml`. The icon consolidation (Task 4) is the largest task, touching ~100 files.

**Tech Stack:** pnpm 10.6, Node 24, Next.js 15, Fastify 5, TypeScript 5.8

**Items covered:**
- 7.4: Consolidate icon libraries (3 → 2: lucide-react + react-icons)
- 7.5: Remove `node-fetch` (unused, Node 24 native fetch)
- 7.6: Remove `ts-node` (redundant with tsx)
- 7.7: Replace `nookies` → native `document.cookie`
- 7.8: Rename `framer-motion` → `motion`
- 7.9: Move/remove misplaced `@types/*`
- 7.10: Prisma CLI/Client alignment (pre-verified: already at `^6.11.0`)
- **NEW — 7.11:** Remove `openid-client` (unused, OAuth is manual via fetch)
- **NEW — 7.12:** Remove `js-cookie` + `@types/js-cookie` (installed but zero imports)
- **NEW — 7.13:** Add `jose` and `motion` to pnpm catalog (shared across apps)
- **NEW — 7.14:** Replace `date-fns` → existing `formatDateTime()` utility (fixes hardcoded ptBR locale bug)

---

## Task 1: Server Dependency Cleanup

**Covers:** 7.5, 7.6, 7.11

**Files:**
- Modify: `apps/server/package.json`
- Modify: `knip.json`

**Context:** Three server dependencies are dead weight:
- `node-fetch` (line 62): Zero imports in source. The server uses native `fetch()` (6 call sites in `oauth-flow.service.ts` and `upload.service.ts`). Node 24 has native fetch.
- `openid-client` (line 64): Zero imports in source. OAuth is implemented manually via native fetch in `oauth-flow.service.ts`.
- `ts-node` (line 76, devDependencies): Zero usage. All scripts use `tsx`. The Prisma seed script uses `node prisma/seed.js` (compiled JS).
- `knip.json` line 7: `ignoreDependencies: ["tsx", "ts-node"]` — remove `ts-node` from this array.

- [ ] **Step 1: Remove dependencies from `apps/server/package.json`**

In `apps/server/package.json`:
- Remove `"node-fetch": "^3.3.2"` from `dependencies`
- Remove `"openid-client": "^6.6.2"` from `dependencies`
- Remove `"ts-node": "^10.9.2"` from `devDependencies`

- [ ] **Step 2: Update `knip.json`**

In `knip.json`, line 7, change:
```json
"ignoreDependencies": ["tsx", "ts-node"]
```
to:
```json
"ignoreDependencies": ["tsx"]
```

- [ ] **Step 3: Verify no imports exist**

Use Grep tool to confirm zero matches for:
- `from ["']node-fetch` in `apps/server/src/`
- `from ["']openid-client` in `apps/server/src/`
- `ts-node` in any script or config (should only be in the files we already edited)

- [ ] **Step 4: Install and verify**

```bash
pnpm install
pnpm --filter ouitransfer-api type-check
pnpm --filter ouitransfer-api test
```

All tests must pass. Type-check must succeed.

- [ ] **Step 5: Commit**

```bash
git add apps/server/package.json knip.json pnpm-lock.yaml
git commit -m "chore(deps): remove unused server deps (node-fetch, openid-client, ts-node)"
```

---

## Task 2: framer-motion → motion + Catalog Consolidation

**Covers:** 7.8, 7.13

**Files:**
- Modify: `pnpm-workspace.yaml` (add `motion` and `jose` to catalog)
- Modify: `apps/web/package.json` (framer-motion → motion catalog:, jose → catalog:)
- Modify: `apps/docs/package.json` (motion → catalog:)
- Modify: `apps/server/package.json` (jose → catalog:)
- Modify: 9 source files in `apps/web/src/` (update imports)

**Context:**
- `framer-motion` was renamed to `motion` starting v11. The web app uses `^12.20.1` under the old name. The docs app already uses `motion: ^12.23.0` under the new name.
- All 9 web imports use `import { motion } from "framer-motion"` — the new import path is `"motion/react"`. The docs app already uses `"motion/react"`.
- `jose` is used by both server (`^5.10.0`) and web (`^5.10.0`) but is not in the pnpm catalog. It should be.

- [ ] **Step 1: Add `motion` and `jose` to pnpm catalog**

In `pnpm-workspace.yaml`, add under the `# ── Runtime` section:
```yaml
  motion: "^12.23.0"
  jose: "^5.10.0"
```

- [ ] **Step 2: Update `apps/web/package.json`**

- Replace `"framer-motion": "^12.20.1"` with `"motion": "catalog:"`
- Replace `"jose": "^5.10.0"` with `"jose": "catalog:"`

- [ ] **Step 3: Update `apps/docs/package.json`**

- Replace `"motion": "^12.23.0"` with `"motion": "catalog:"`

- [ ] **Step 4: Update `apps/server/package.json`**

- Replace `"jose": "^5.10.0"` with `"jose": "catalog:"`

- [ ] **Step 5: Update 9 import statements in `apps/web/src/`**

All 9 files import `{ motion } from "framer-motion"`. Change each to `{ motion } from "motion/react"`:

1. `apps/web/src/components/layout/loading-screen.tsx:1`
2. `apps/web/src/app/reset-password/page.tsx:3`
3. `apps/web/src/app/login/components/login-header.tsx:1`
4. `apps/web/src/app/forgot-password/page.tsx:3`
5. `apps/web/src/app/(home)/components/home-header.tsx:1`
6. `apps/web/src/app/(home)/components/home-content.tsx:2`
7. `apps/web/src/components/ui/background-lights.tsx:1`
8. `apps/web/src/app/login/page.tsx:3`
9. `apps/web/src/app/register-with-invite/[token]/page.tsx:5`

Each line changes from:
```ts
import { motion } from "framer-motion";
```
to:
```ts
import { motion } from "motion/react";
```

- [ ] **Step 6: Install and verify**

```bash
pnpm install
pnpm --filter ouitransfer-web type-check
pnpm --filter ouitransfer-docs type-check
pnpm --filter ouitransfer-api type-check
```

All type-checks must pass.

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml apps/web/package.json apps/docs/package.json apps/server/package.json pnpm-lock.yaml apps/web/src/components/layout/loading-screen.tsx apps/web/src/app/reset-password/page.tsx apps/web/src/app/login/components/login-header.tsx apps/web/src/app/forgot-password/page.tsx "apps/web/src/app/(home)/components/home-header.tsx" "apps/web/src/app/(home)/components/home-content.tsx" apps/web/src/components/ui/background-lights.tsx apps/web/src/app/login/page.tsx "apps/web/src/app/register-with-invite/[token]/page.tsx"
git commit -m "chore(deps): rename framer-motion to motion, add motion+jose to pnpm catalog"
```

---

## Task 3: Web Dependency Cleanup + date-fns Replacement

**Covers:** 7.7, 7.9, 7.12, 7.14

**Files:**
- Modify: `apps/web/package.json` (remove 4 deps)
- Modify: `apps/web/src/components/general/language-switcher.tsx` (replace nookies setCookie)
- Modify: `apps/web/src/components/tables/shares-table.tsx` (replace date-fns format)
- Modify: `apps/web/src/components/modals/share-details-modal.tsx` (replace date-fns format)
- Modify: `apps/web/src/app/(shares)/reverse-shares/components/received-files-file-row.tsx` (replace date-fns format + fix ptBR bug)
- Modify: `apps/web/src/app/(shares)/s/[alias]/components/share-details.tsx` (replace date-fns format)

**Context:**
- `nookies` is a server-side cookie library for Next.js Pages Router. We're on App Router. Only 1 usage: `setCookie(null, ...)` in `language-switcher.tsx` — this is a client-side call. Replace with native `document.cookie`.
- `js-cookie` + `@types/js-cookie`: installed but ZERO imports in source code. Dead weight.
- `@types/react-dropzone`: in `dependencies` (should be in devDeps). But `react-dropzone@14.3.8` ships its own types, making `@types/react-dropzone@5.1.0` unnecessary. Remove entirely.
- `date-fns`: used in 4 files, only `format()` function. The app already has `formatDateTime()` at `apps/web/src/lib/format-date-time.ts` that uses `Intl.DateTimeFormat` with locale support. Replacing date-fns with this utility also fixes a bug: `received-files-file-row.tsx` hardcodes `ptBR` locale instead of using the app's current locale.

### Sub-task 3A: Replace nookies with native document.cookie

- [ ] **Step 1: Update `language-switcher.tsx`**

In `apps/web/src/components/general/language-switcher.tsx`:

Remove the import:
```ts
import { setCookie } from "nookies";
```

Replace the `setCookie` call (lines 55-60):
```ts
setCookie(null, COOKIE_LANG_KEY, fullLocale, {
  maxAge: COOKIE_MAX_AGE,
  path: "/",
  sameSite: "lax",
  secure: window.location.protocol === "https:",
});
```

With native `document.cookie`:
```ts
const secure = window.location.protocol === "https:" ? "; Secure" : "";
document.cookie = `${COOKIE_LANG_KEY}=${fullLocale}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
```

### Sub-task 3B: Replace date-fns with formatDateTime

- [ ] **Step 2: Update `shares-table.tsx`**

In `apps/web/src/components/tables/shares-table.tsx`:

Remove import:
```ts
import { format } from "date-fns";
```

Add import:
```ts
import { formatDateTime } from "@/lib/format-date-time";
```

The component needs access to `locale`. It's a client component — add `useLocale` from `next-intl` if not already imported.

Replace line 404:
```ts
{format(new Date(share.createdAt), "MM/dd/yyyy HH:mm")}
```
with:
```ts
{formatDateTime(share.createdAt, "table", locale)}
```

Replace line 414:
```ts
format(new Date(share.expiration), "MM/dd/yyyy HH:mm")
```
with:
```ts
formatDateTime(share.expiration, "table", locale)
```

- [ ] **Step 3: Update `share-details-modal.tsx`**

In `apps/web/src/components/modals/share-details-modal.tsx`:

Remove import:
```ts
import { format } from "date-fns";
```

Add import:
```ts
import { formatDateTime } from "@/lib/format-date-time";
```

Add locale support via `useLocale` from `next-intl`.

Replace line 123:
```ts
return format(new Date(dateString), "MM/dd/yyyy HH:mm");
```
with:
```ts
return formatDateTime(dateString, "table", locale);
```

- [ ] **Step 4: Update `received-files-file-row.tsx`**

In `apps/web/src/app/(shares)/reverse-shares/components/received-files-file-row.tsx`:

Remove both imports:
```ts
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
```

Add import:
```ts
import { formatDateTime } from "@/lib/format-date-time";
```

Add locale support via `useLocale` from `next-intl`.

Replace line 49:
```ts
return format(new Date(dateString), "dd/MM/yyyy HH:mm", { locale: ptBR });
```
with:
```ts
return formatDateTime(dateString, "table", locale);
```

**Note:** This fixes a bug — the original code hardcoded `ptBR` locale regardless of the user's actual locale.

- [ ] **Step 5: Update `share-details.tsx`**

In `apps/web/src/app/(shares)/s/[alias]/components/share-details.tsx`:

Remove import:
```ts
import { format } from "date-fns";
```

Add import:
```ts
import { formatDateTime } from "@/lib/format-date-time";
```

Add locale support via `useLocale` from `next-intl`.

Replace line 92:
```ts
date: format(new Date(share.createdAt), "MM/dd/yyyy HH:mm"),
```
with:
```ts
date: formatDateTime(share.createdAt, "table", locale),
```

Replace line 98:
```ts
date: format(new Date(share.expiration), "MM/dd/yyyy HH:mm"),
```
with:
```ts
date: formatDateTime(share.expiration, "table", locale),
```

### Sub-task 3C: Remove dead dependencies

- [ ] **Step 6: Update `apps/web/package.json`**

Remove from `dependencies`:
- `"nookies": "^2.5.2"`
- `"js-cookie": "^3.0.5"`
- `"date-fns": "^4.1.0"`
- `"@types/react-dropzone": "^5.1.0"`

Remove from `devDependencies`:
- `"@types/js-cookie": "^3.0.6"`

### Sub-task 3D: Verify

- [ ] **Step 7: Install and verify**

```bash
pnpm install
pnpm --filter ouitransfer-web type-check
pnpm --filter ouitransfer-web test
```

All type-checks and tests must pass.

- [ ] **Step 8: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/components/general/language-switcher.tsx apps/web/src/components/tables/shares-table.tsx apps/web/src/components/modals/share-details-modal.tsx "apps/web/src/app/(shares)/reverse-shares/components/received-files-file-row.tsx" "apps/web/src/app/(shares)/s/[alias]/components/share-details.tsx"
git commit -m "chore(deps): remove nookies/js-cookie/date-fns/@types/react-dropzone, use native cookie + formatDateTime"
```

---

## Task 4: Icon Consolidation (@tabler/icons-react → lucide-react + react-icons/tb)

**Covers:** 7.4

**Files:**
- Modify: `apps/web/package.json` (remove @tabler/icons-react)
- Modify: ~90 source files in `apps/web/src/` (update icon imports)

**Context:**
The web app uses 3 icon libraries:
1. `@tabler/icons-react` — 122 import sites, ~80 unique icons (primary UI icons + 17 brand icons)
2. `lucide-react` — 14 import sites (shadcn/ui primitives)
3. `react-icons` — 2 files (icon-picker feature)

**Goal:** Remove `@tabler/icons-react`. Migrate its icons to:
- **Non-brand icons** → `lucide-react` (already installed via catalog)
- **Brand icons** (17 icons in `file-icons.tsx` + 1 in `home-content.tsx`) → `react-icons/tb` (tabler pack via react-icons, already installed)

**End state:** 2 icon libraries (lucide-react for UI, react-icons for icon-picker + brand icons).

### Icon Mapping Rules

**Non-brand icons (tabler → lucide):**
1. Strip the `Icon` prefix: `IconCheck` → `Check`
2. Most icons map directly. Common exceptions where names differ:
   - `IconEdit` → `Pencil`
   - `IconEditOff` → `PencilOff`
   - `IconTrash` → `Trash2`
   - `IconBolt` → `Zap`
   - `IconPhoto` → `Image`
   - `IconMail` → `Mail`
   - `IconWorld` → `Globe`
   - `IconDeviceFloppy` → `Save`
   - `IconArrowBarToDown` → `ArrowDownToLine`
   - `IconArrowBarToUp` → `ArrowUpToLine`
   - `IconClipboardCopy` → `ClipboardCopy`
   - `IconDotsVertical` → `EllipsisVertical`
   - `IconDots` → `Ellipsis`
   - `IconInfoCircle` → `Info`
   - `IconAlertCircle` → `AlertCircle`
   - `IconAlertTriangle` → `AlertTriangle`
   - `IconExternalLink` → `ExternalLink`
   - `IconCircleCheck` → `CircleCheck`
   - `IconCircleX` → `CircleX`
   - `IconReload` → `RotateCw`
   - `IconRefresh` → `RefreshCw`
   - `IconAdjustments` → `SlidersHorizontal`
   - `IconCloudUpload` → `CloudUpload`
   - `IconCloudDownload` → `CloudDownload`
   - `IconLanguage` → `Languages`
   - `IconUserPlus` → `UserPlus`
   - `IconDeviceDesktop` → `Monitor`
   - `IconTransfer` → `ArrowLeftRight`
   - `IconFileUpload` → `FileUp`
   - `IconSortAscending` → `ArrowUpNarrowWide`
   - `IconSortDescending` → `ArrowDownWideNarrow`
   - `IconLayoutGrid` → `LayoutGrid`
   - `IconLayoutList` → `LayoutList`
   - `IconChevronDown` → `ChevronDown`
   - `IconChevronRight` → `ChevronRight`
   - `IconChevronUp` → `ChevronUp`
3. For any icon where the lucide equivalent is uncertain, search the lucide-react package exports. You can check by reading `node_modules/lucide-react/dist/esm/icons/index.js` or by doing a Grep for the icon name (without Icon prefix) in `node_modules/lucide-react/dist/esm/icons/`.
4. **Lucide icons use the same `className` prop as tabler icons** — no prop changes needed.

**Brand icons (tabler → react-icons/tb):**
- `IconBrandXxx` → `TbBrandXxx`
- `IconBrandGithubFilled` → `TbBrandGithubFilled`
- The naming convention is: strip `Icon` prefix, add `Tb` prefix.
- **Import path:** `import { TbBrandXxx } from "react-icons/tb"`
- **Prop difference:** react-icons uses `size` and `className` like tabler. The `className="size-5"` pattern with Tailwind should work. But react-icons components accept `size` as a number, not via className. Test that `className="h-5 w-5"` or `className="size-5"` works correctly. If not, pass `size={20}` as a prop instead.

### Implementation approach

- [ ] **Step 1: Build the complete icon mapping**

Use the Grep tool to find ALL unique tabler icon names imported across `apps/web/src/`:
- Pattern: `Icon[A-Z]\w+` in files matching `*.{ts,tsx}`
- From the `@tabler/icons-react` imports

Create a complete mapping of every unique icon to its lucide-react or react-icons/tb equivalent. Verify each lucide icon exists by checking the package.

- [ ] **Step 2: Update brand icon files first**

Start with the 2 files that use brand icons, since these go to `react-icons/tb`:

**`apps/web/src/utils/file-icons.tsx`:**
- Change the import from `@tabler/icons-react` to two imports:
  - Non-brand icons (like `IconFile`, `IconFileText`, etc.) → import from `lucide-react`
  - Brand icons (`IconBrandJavascript`, etc.) → import from `react-icons/tb` as `TbBrandXxx`
- Update all references in the file icon mapping to use the new names
- **Important:** The file assigns icons as React components in an object. Both lucide and react-icons/tb components work as `React.ComponentType` — no wrapper needed.

**`apps/web/src/app/(home)/components/home-content.tsx`:**
- Change `import { IconBrandGithubFilled } from "@tabler/icons-react"` to `import { TbBrandGithubFilled } from "react-icons/tb"`
- Update the JSX: `<IconBrandGithubFilled .../>` → `<TbBrandGithubFilled .../>`

- [ ] **Step 3: Update all remaining files (non-brand icons → lucide)**

For each file that imports from `@tabler/icons-react`:
1. Change the import source from `"@tabler/icons-react"` to `"lucide-react"`
2. Rename each imported icon according to the mapping (strip `Icon` prefix, apply name changes)
3. Update all JSX usages to use the new component names
4. If the file already imports from `lucide-react`, merge the imports into one import statement

**Work through files systematically.** There are ~90 files to update. Process them in directory order.

- [ ] **Step 4: Remove @tabler/icons-react from package.json**

In `apps/web/package.json`, remove:
```json
"@tabler/icons-react": "^3.34.0"
```

- [ ] **Step 5: Install and verify**

```bash
pnpm install
pnpm --filter ouitransfer-web type-check
pnpm --filter ouitransfer-web test
```

**Type-check is critical here.** If any icon was mapped incorrectly, TypeScript will catch it with "Module '"lucide-react"' has no exported member 'Xxx'" errors. Fix each one by finding the correct lucide icon name.

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml apps/web/src/
git commit -m "chore(deps): consolidate icons — remove @tabler/icons-react, use lucide-react + react-icons/tb"
```

---

## Verification Checklist (after all tasks)

- [ ] `pnpm install` succeeds
- [ ] `pnpm --filter ouitransfer-api type-check` passes
- [ ] `pnpm --filter ouitransfer-web type-check` passes
- [ ] `pnpm --filter ouitransfer-docs type-check` passes
- [ ] `pnpm --filter ouitransfer-api test` passes
- [ ] `pnpm --filter ouitransfer-web test` passes
- [ ] `pnpm knip` reports no new unused dependencies
- [ ] No `@tabler/icons-react` imports remain in source
- [ ] No `framer-motion` imports remain in source
- [ ] No `nookies` or `js-cookie` imports remain in source
- [ ] No `date-fns` imports remain in source
- [ ] No `node-fetch` or `openid-client` imports remain in source

## Removed Dependencies Summary

| Package | Was in | Reason |
|---------|--------|--------|
| `node-fetch` | server deps | Unused, Node 24 native fetch |
| `openid-client` | server deps | Unused, OAuth via manual fetch |
| `ts-node` | server devDeps | Redundant with tsx |
| `framer-motion` | web deps | Renamed to `motion` |
| `nookies` | web deps | Replaced with native document.cookie |
| `js-cookie` | web deps | Installed but never imported |
| `@types/js-cookie` | web devDeps | Dead with js-cookie removal |
| `date-fns` | web deps | Replaced with Intl.DateTimeFormat (formatDateTime) |
| `@types/react-dropzone` | web deps | Unnecessary, react-dropzone ships own types |
| `@tabler/icons-react` | web deps | Icons migrated to lucide-react + react-icons/tb |

## Added to pnpm Catalog

| Package | Version | Used by |
|---------|---------|---------|
| `motion` | `^12.23.0` | web, docs |
| `jose` | `^5.10.0` | server, web |
