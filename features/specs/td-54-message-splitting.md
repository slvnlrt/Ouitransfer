# TD-54 — next-intl Message Splitting per Route

## Problem

`NextIntlClientProvider` in the root layout (`apps/web/src/app/layout.tsx:132`) inherits ALL
messages from `i18n/request.ts` by default (no `messages` prop). This serializes ~122 KB of JSON
(67 namespaces) into the RSC payload of **every** page, including unauthenticated ones like `/login`.

**Impact:**
1. **Performance** — every page carries ~122 KB of unused translations
2. **Information disclosure** — an anonymous `curl` on `/login` reveals the full feature surface
   (admin, audit, LDAP, quotas, etc.)

## Solution

**Approach:** Filter messages via `NextIntlClientProvider`'s `messages` prop at two levels:

1. **Root layout** — provide only the namespaces used by root-level components (`SkipToContent` →
   `a11y`). This is the only translation-using component rendered directly in root layout.
2. **Route layouts** — each route layout wraps children in a nested `NextIntlClientProvider` with
   the namespaces needed for that route group.

In next-intl v4, when a `NextIntlClientProvider` sets an explicit `messages` prop, it overrides
inheritance from the parent provider. Nested providers with explicit messages are independent.

Server-side `getTranslations()` (used in `generateMetadata`) is **not affected** — it reads from
`getRequestConfig()` which always loads the full message file.

### Namespace Groups

| Group           | Namespaces                                                                                                   | ~Size |
|-----------------|-------------------------------------------------------------------------------------------------------------|-------|
| `GLOBAL`        | `a11y`, `common`, `errors`, `validation`                                                                    | ~3 KB |
| `AUTH`          | `login`, `auth`, `forgotPassword`, `resetPassword`, `register`, `registerWithInvite`, `twoFactor`, `authProviders` | ~11 KB |
| `PUBLIC_SHARE`  | `share`, `shareDetails`, `shareSecurity`, `shareExpiration`, `files`, `filePreview`, `downloadQueue`, `bulkDownload`, `errors`, `common`, `footer`, `languageSwitcher`, `theme` | ~10 KB |
| `REVERSE_SHARE` | `reverseShares`, `uploadFile`, `fileSelector`, `files`, `shareSecurity`, `validation`                       | ~20 KB |
| `APP_SHELL`     | `navbar`, `footer`, `theme`, `languageSwitcher`, `navigation`, `logo`, `dashboard`, `home`, `searchBar`, `contextMenu`, `emptyState`, `profile`, `notifications` | ~5 KB |

**Authenticated routes** receive ALL namespaces — no filtering. The win here is on public/anonymous
routes where disclosure is the concern and performance matters most (first impression).

### Route → Namespaces Mapping

| Route Layout                             | Provider Messages                     |
|------------------------------------------|---------------------------------------|
| Root (`layout.tsx`)                       | `GLOBAL` only                         |
| `/login`                                 | `GLOBAL` + `AUTH`                     |
| `/forgot-password`                       | `GLOBAL` + `AUTH` (subset)            |
| `/reset-password`                        | `GLOBAL` + `AUTH` (subset)            |
| `/register-with-invite/[token]`          | `GLOBAL` + `AUTH`                     |
| `(shares)/s/[alias]`                     | `GLOBAL` + `PUBLIC_SHARE`             |
| `(shares)/r/[alias]`                     | `GLOBAL` + `REVERSE_SHARE`            |
| `(home)`                                 | `GLOBAL` + `home`, `footer`, `languageSwitcher`, `theme` |
| All authenticated routes                 | All messages (full `getMessages()`)   |

### Why Not Filter Authenticated Routes?

Authenticated routes share many namespaces via modals (share creation, file actions, recipient
selector, etc.). Mapping precisely which modal opens from which page is fragile and low-ROI — the
user is authenticated, so disclosure isn't a concern, and the performance win is marginal vs. the
maintenance cost. Can be optimized in a future pass if needed.

## Decisions

- **No lodash dependency** — write a simple `pickMessages()` utility
- **Namespace definitions in a central module** — `apps/web/src/i18n/message-keys.ts`
- **Authenticated layouts get all messages** — pragmatic, avoids fragile modal namespace tracking
- **Root layout provides minimal set** — only `a11y` (SkipToContent) + safety namespaces
- **Each public layout is self-contained** — includes GLOBAL + its own namespaces (no reliance on
  parent provider inheritance)
