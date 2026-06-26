# TD-54 — Implementation Plan

**Spec:** `features/specs/td-54-message-splitting.md`

## Batch 1 — Namespace definitions + pick utility (1 agent)

### Task 1.1 — Create `apps/web/src/i18n/message-keys.ts`

Create a module that exports:

1. **`pickMessages(messages, namespaces)`** — a simple utility that returns an object with only the
   specified top-level keys from `messages`. No lodash needed.
   ```ts
   export function pickMessages(
     messages: Record<string, unknown>,
     namespaces: readonly string[],
   ): Record<string, unknown> {
     const result: Record<string, unknown> = {};
     for (const ns of namespaces) {
       if (ns in messages) result[ns] = messages[ns];
     }
     return result;
   }
   ```

2. **Namespace group constants** — frozen arrays for each route group:
   - `GLOBAL_NAMESPACES` = `['a11y', 'common', 'errors', 'validation']`
   - `AUTH_NAMESPACES` = `['login', 'auth', 'forgotPassword', 'resetPassword', 'register', 'registerWithInvite', 'twoFactor', 'authProviders']`
   - `PUBLIC_SHARE_NAMESPACES` = `['share', 'shareDetails', 'shareSecurity', 'shareExpiration', 'files', 'filePreview', 'downloadQueue', 'bulkDownload', 'footer', 'languageSwitcher', 'theme']`
   - `REVERSE_SHARE_NAMESPACES` = `['reverseShares', 'uploadFile', 'fileSelector', 'files', 'shareSecurity', 'footer', 'languageSwitcher', 'theme']`
   - `HOME_NAMESPACES` = `['home', 'footer', 'languageSwitcher', 'theme']`

   **Note:** The exact namespaces per group should be verified by the implementing agent by tracing
   `useTranslations()` calls in the component trees of each route. The lists above are initial
   estimates — the agent should grep for actual usage and adjust.

3. **Helper to combine groups:**
   ```ts
   export function routeMessages(
     messages: Record<string, unknown>,
     ...groups: (readonly string[])[]
   ): Record<string, unknown> {
     const combined = new Set(groups.flat());
     return pickMessages(messages, [...combined]);
   }
   ```

### Task 1.2 — Unit tests

Add `apps/web/src/i18n/message-keys.test.ts`:
- `pickMessages` picks only specified keys
- `pickMessages` ignores missing keys
- `routeMessages` merges multiple groups without duplicates

## Batch 2 — Root layout modification (1 agent)

### Task 2.1 — Modify `apps/web/src/app/layout.tsx`

1. Add imports: `getMessages` from `next-intl/server`, `pickMessages` + `GLOBAL_NAMESPACES`
2. Call `const messages = await getMessages()` in the component body
3. Change `<NextIntlClientProvider>` to
   `<NextIntlClientProvider messages={pickMessages(messages, GLOBAL_NAMESPACES)}>`

This is the key change — root now provides ~3 KB instead of ~122 KB.

## Batch 3 — Public route layouts (1 agent, mechanical)

All public route layouts follow the same pattern:

```tsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
import { routeMessages, GLOBAL_NAMESPACES, XXX_NAMESPACES } from "@/i18n/message-keys";

export default async function XxxLayout({ children }: LayoutProps) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={routeMessages(messages, GLOBAL_NAMESPACES, XXX_NAMESPACES)}>
      {children}
    </NextIntlClientProvider>
  );
}
```

**Important:** The layout function must become `async` (it needs `await getMessages()`).

Files to modify:
1. `apps/web/src/app/login/layout.tsx` — GLOBAL + AUTH
2. `apps/web/src/app/forgot-password/layout.tsx` — GLOBAL + AUTH
3. `apps/web/src/app/reset-password/layout.tsx` — GLOBAL + AUTH
4. `apps/web/src/app/register-with-invite/[token]/layout.tsx` — GLOBAL + AUTH
5. `apps/web/src/app/(shares)/s/[alias]/layout.tsx` — GLOBAL + PUBLIC_SHARE
6. `apps/web/src/app/(shares)/r/[alias]/layout.tsx` — GLOBAL + REVERSE_SHARE
7. `apps/web/src/app/(home)/layout.tsx` — GLOBAL + HOME

## Batch 4 — Authenticated route layouts (1 agent, mechanical)

All authenticated route layouts pass ALL messages:

```tsx
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

export default async function XxxLayout({ children }: LayoutProps) {
  const messages = await getMessages();
  return (
    <NextIntlClientProvider messages={messages}>
      {children}
    </NextIntlClientProvider>
  );
}
```

Files to modify:
1. `apps/web/src/app/dashboard/layout.tsx`
2. `apps/web/src/app/files/layout.tsx`
3. `apps/web/src/app/(shares)/shares/layout.tsx`
4. `apps/web/src/app/(shares)/reverse-shares/layout.tsx`
5. `apps/web/src/app/profile/layout.tsx`
6. `apps/web/src/app/notifications/layout.tsx`
7. `apps/web/src/app/customization/layout.tsx`
8. Create `apps/web/src/app/admin/layout.tsx` (new file — shared admin layout)

**Important for admin:** A new `apps/web/src/app/admin/layout.tsx` provides the messages provider
once, so the 5 sub-route layouts (`audit`, `groups`, `ldap`, `settings`, `users`) don't each need one.

## Batch 5 — Validation (1 agent)

1. Run `pnpm --filter ouitransfer-web type-check` — verify TypeScript compiles
2. Run `pnpm --filter ouitransfer-web test` — verify all tests pass
3. Verify namespace coverage: for each public route, trace the component tree's `useTranslations()`
   calls and confirm all needed namespaces are in the group. Adjust if any are missing.

## Expected Results

| Page      | Before  | After   | Reduction |
|-----------|---------|---------|-----------|
| `/login`  | ~122 KB | ~14 KB  | ~88%      |
| `/s/xxx`  | ~122 KB | ~13 KB  | ~89%      |
| `/r/xxx`  | ~122 KB | ~23 KB  | ~81%      |
| Dashboard | ~122 KB | ~122 KB | 0% (same) |
