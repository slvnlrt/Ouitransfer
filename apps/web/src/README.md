# Web Architecture

Next.js 15 (App Router) frontend. Port 3000 in development, 5487 in production.

## Directory Structure

```
src/
  app/                Pages and layouts (Next.js App Router)
  components/         Reusable UI components
  hooks/              TanStack Query hooks (data fetching + mutations)
  http/               Typed Axios wrappers grouped by domain
  lib/                Core utilities (proxy, axios instance, etc.)
  config/             Frontend configuration (query keys, constants)
  contexts/           React contexts (minimal — prefer TQ cache)
  providers/          React providers (QueryProvider, ThemeProvider, etc.)
  types/              Shared TypeScript types
  utils/              Pure utility functions
   i18n/               next-intl routing and request config
   proxy.ts            Proxy — JWT auth + route protection + security headers
   env.ts              Zod-validated environment variables
```

## Routing & Pages (`src/app/`)

Next.js App Router convention: `page.tsx` = route, `layout.tsx` = shared layout, `loading.tsx` = suspense fallback, `error.tsx` = error boundary.

Key route groups:
- `app/(auth)/` — login, register, password reset
- `app/(app)/` — authenticated app shell (dashboard, settings, etc.)
- `app/share/[token]/` — public share pages (no auth required)

## API Communication

All requests to `/api/*` are routed directly to the Fastify server backend. 

- **Development (local):** Next.js `rewrites` natively proxy `/api/:path*` to the `API_BASE_URL` (typically `http://localhost:3333/:path*`).
- **Production:** A reverse proxy (e.g., Traefik) directly intercepts `/api/*` and routes it to Fastify, bypassing the Next.js container completely.
- **Typed endpoints:** `src/http/endpoints/{domain}/` — Axios wrappers with clean TypeScript types that match the Fastify REST endpoints exactly.

The 401 interceptor in `src/lib/axios.ts` hard-navigates to `/login` on auth failure (skips auth and public pages to avoid redirect loops).

## Data Fetching (`src/hooks/`)

All server state uses **TanStack Query v5**. No Zustand or React Context for server data.

- Query client is configured in `src/providers/query-client-provider.tsx`
- Centralized query keys are in `src/config/query-keys.ts`
- Hooks follow the pattern: `use{Resource}Query` for reads, `use{Action}Mutation` for writes

```ts
// Example hook
export function useShareQuery(token: string) {
  return useQuery({
    queryKey: queryKeys.shares.detail(token),
    queryFn: () => ShareEndpoints.getByToken(token),
  });
}
```

Cache invalidation: call `queryClient.invalidateQueries({ queryKey: queryKeys.{resource}.all() })` after mutations.

## Authentication

**Proxy** (`src/proxy.ts`) runs on every request:
- Verifies the JWT access token in the `token` cookie using `jose`
- Redirects unauthenticated users to `/login` for protected routes
- Redirects authenticated users away from auth pages
- Enforces admin-only routes
- Adds security headers (CSP, X-Frame-Options, etc.)

Cookie refresh is handled server-side by the Fastify API.

## i18n

- **Library**: next-intl
- **Languages**: 23 (see `messages/` directory at app root)
- **Config**: `src/i18n/routing.ts` — supported locales and default locale
- **Usage**: `useTranslations("namespace")` in client components, `getTranslations("namespace")` in server components and route handlers

Translation files live at `apps/web/messages/{locale}.json`. All 23 files must be updated when adding new keys.

## UI Components

- **Component library**: shadcn/ui (new-york style) — components in `src/components/ui/`
- **Primitives**: Radix UI (via shadcn)
- **Icons**: lucide-react (general icons), react-icons/tb (Tabler brand icons in `src/components/file-icons.tsx`)
- **Animations**: `motion/react` (Motion library)

Custom shared primitives are in `src/components/common/`:
- `EditableField` — inline text editing with save/cancel
- `ItemActions` — dropdown action menu for file/folder items
- `ErrorDisplay` — unified error UI with 3 variants (full-page, card, inline)

## State Management

| State type | Where it lives |
|-----------|---------------|
| Server data (files, shares, users) | TanStack Query cache |
| UI state (modals, selections) | Local `useState` in components |
| Auth state | TanStack Query (`useAuthQuery`) |
| App config | TanStack Query (`useAppInfoQuery`) |

Avoid adding new Zustand stores or React contexts for server-originated data.

## Adding a New Page

1. Create `src/app/{locale}/{route}/page.tsx`
2. If the page needs data from the API:
   - Add a typed endpoint in `src/http/endpoints/{domain}/` matching the backend Fastify REST route.
   - Create a TQ hook in `src/hooks/`
3. Add translations to all 23 `messages/{locale}.json` files
4. If the page requires auth, it's covered automatically by the proxy (adjust `src/proxy.ts` matcher if the path pattern is unusual)
5. Add a loading state (`loading.tsx`) and error boundary (`error.tsx`) for the route if needed
