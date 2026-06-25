# Red Team Report — A6: Email, Notifications, Invites & SSRF

## Summary

I audited the outbound email pipeline (`apps/server/src/modules/email/*`), the in-app
notification + unsubscribe flow (`apps/server/src/modules/notification/*`), the invite
create→send→accept flow (`apps/server/src/modules/invite/*` + frontend
`apps/web/src/app/register-with-invite/*`), the signed-token mechanisms (unsubscribe HMAC
JWT, invite token, share tracking token), and all URL/base-URL construction.

The email subsystem is, overall, well-built and shows clear evidence of prior security
hardening: subjects are CRLF-stripped (`sanitizeForSubject`), all `to` recipients are
`z.email()`-validated at the DTO boundary, HTML email bodies interpolate user values through
an HTML-escaping translation function (`tHtml` / `createTranslationFn`), CTA/unsubscribe
hrefs go through a scheme allowlist (`safeHref`), the unsubscribe JWT enforces the `alg`
header (no algorithm-confusion), uses a derived purpose-scoped HMAC key, a timing-safe
compare, and an `exp` claim, invite tokens are 256-bit and single-use via an atomic
`updateMany` claim (TOCTOU-safe), and **all email base URLs are built from the
admin-configured `appUrl` config value, NOT from the request `Host` header** — so the
classic host-header link-poisoning attack on reset/invite/share links does **not** apply to
the email module.

The findings that remain are mostly availability / abuse-of-function issues (email/invite
spam amplification, unbounded queue growth, bcrypt-DoS on the unauthenticated registration
endpoint) plus one genuine SSRF/host-poisoning sink in the **adjacent** auth-providers
module (OAuth redirect base URL derives from `request.hostname`), and a missing format
validator on the `appUrl`/`appName` config keys. No token forgery, no header injection, no
stored-XSS-into-email, and no IDOR on notifications were found.

**Counts by severity:** Critical 0 · High 1 · Medium 4 · Low 4 · Informational 2

The 3 most serious:
1. **A6-01 (High)** — Host-header / `request.hostname` SSRF & link poisoning in OAuth
   callback base-URL construction (auth-providers), the one place that does NOT use the
   trusted `appUrl`.
2. **A6-02 (Medium)** — Unauthenticated `POST /register-with-invite` runs bcrypt per request
   under only the shared global 100/min rate limit → CPU-exhaustion DoS amplification.
3. **A6-03 (Medium)** — Email-spam amplification: an authenticated low-priv user can enqueue
   unbounded share/reverse-share invitation emails to arbitrary external addresses (your SMTP
   relay is the attacker's mailer) with no per-user send cap.

---

## Token & URL-construction notes

### Base URL construction — SAFE (uses trusted config, not Host)
- `getAppUrl()` reads `appUrl` from the config store (`url-builder.ts:12-16`). Every email
  link builder (`buildShareLink`, `buildResetPasswordUrl`, `buildInviteRegistrationUrl`,
  `buildUnsubscribeUrl`, `buildShareManageUrl`, `buildReverseShareUploadLink`) derives from
  this value. None of them read `request.headers.host` / `request.hostname`. This is the
  correct design and defeats host-header poisoning of emailed links.
- Counter-example (out-of-strict-scope but reported as A6-01): `auth-providers/routes.ts:43-53`
  builds the OAuth base URL from `request.protocol` + `request.hostname`.

### Unsubscribe token (`email/unsubscribe-token.ts`) — strong
- HS256 HMAC JWT, key derived from `JWT_SECRET` with a purpose label
  (`deriveKey("unsubscribe")`, line 21-23) — prevents cross-purpose reuse of an auth JWT.
- `verifyUnsubscribeToken` validates `alg === "HS256"` (line 87) → no alg-confusion / `none`.
- Constant-time signature compare via `crypto.timingSafeEqual` with length pre-check
  (lines 99-108). `exp` enforced (line 122). Forgery requires `JWT_SECRET`. Good.
- Scope: payload is `{ userId, type }`. A token only ever sets `frequency=disabled` for that
  one `type`, and `unsubscribeUser()` (`notification/service.ts:112-135`) silently no-ops for
  `isCritical` or non-`configurable` types — so even a replayed/leaked token cannot disable
  password_reset / welcome. Defense-in-depth is solid.
- Weaknesses (see A6-05, A6-08): 90-day lifetime, no single-use / no revocation, idempotent —
  a leaked link (email forwarding, proxy logs, Referer) unsubscribes that user from that one
  non-critical type for 90 days.

### Invite token (`invite/service.ts`) — strong
- `randomBytes(32).toString("hex")` = 256-bit, unique column (schema `InviteToken.token @unique`).
- 15-minute TTL (`INVITE_TOKEN_TTL_MINUTES`, line 14).
- Single-use enforced atomically inside a transaction:
  `tx.inviteToken.updateMany({ where: { token, usedAt: null, expiresAt: { gt: now } }, data:{ usedAt } })`
  then `claim.count === 0` → reject (lines 178-188). This closes the validate→use TOCTOU
  (B-26) — two concurrent registrations cannot both win.
- **Role is NOT taken from the token** — `registerWithInvite` hardcodes `isAdmin:false`
  (line 197). The token carries no role/email, so there is no privilege-escalation-via-token.
  Good. (See A6-04 for the email-trust nuance.)

### Share tracking token / recipient identity
- `crypto.randomBytes(24).toString("base64url")` per recipient (`share/service.ts:587`).
- Recipient attribution is explicitly noted as a spoofable comfort signal in the schema
  (`schema.prisma:243-245`) — used only to label notifications, not for authz. Acceptable.

---

## Findings

### [HIGH] OAuth callback base URL derives from request Host (SSRF / link poisoning) — A6-01
- **Severity:** High
- **Location:** `apps/server/src/modules/auth-providers/routes.ts:43-53`
- **OWASP:** A10:2021 SSRF / A01 (host-header injection)
- **Description:** `buildRequestContext()` sets `host: request.hostname` and `buildBaseUrl()`
  returns `` `${protocol}://${host}` ``. This is the one base-URL construction in the audited
  blast radius that trusts the client-supplied Host (`request.hostname` resolves from the
  `Host` / `X-Forwarded-Host` headers depending on `trustProxy`). It is used to build the
  OAuth `redirect_uri` and the post-login redirect base. Everywhere else (all emails) correctly
  uses `appUrl`.
- **Attack scenario:** If the deployment is not strictly fronted by a proxy that pins/overwrites
  `Host` (or `TRUST_PROXY` is set such that `X-Forwarded-Host` is honored from the edge), an
  attacker sends `Host: attacker.example` to the OAuth start endpoint. The generated
  `redirect_uri` / state-bound URLs then point at the attacker host, enabling auth-code/redirect
  interception and phishing links that look first-party.
- **Evidence:**
  ```ts
  // routes.ts:43-53
  function buildRequestContext(request) {
    return { protocol: request.protocol, host: request.hostname, headers: request.headers };
  }
  function buildBaseUrl(ctx) { return `${ctx.protocol}://${ctx.host}`; }
  ```
- **Remediation:** Build OAuth callback/redirect base URLs from the same trusted `appUrl`
  config as the email module (`getAppUrl()`), not from `request.hostname`. If a request-derived
  host is genuinely required, validate it against an allowlist (the configured `appUrl` host).

### [MEDIUM] Unauthenticated invite registration runs bcrypt under only the global rate limit (DoS amplification) — A6-02
- **Severity:** Medium
- **Location:** `apps/server/src/modules/invite/routes.ts:83-128`, `invite/service.ts:173`
- **OWASP:** A04:2021 Insecure Design / DoS
- **Description:** `POST /register-with-invite` is `csrfExempt` and unauthenticated. It always
  performs `bcrypt.hash(password, 10)` (service.ts:173) **before** the authoritative token
  claim, even when the token is invalid only at the transaction stage, and there is no
  per-route rate limit — it inherits only the global `max:100/min` (`app.ts:150-152`) shared
  across all IPs/routes. bcrypt cost-10 is intentionally CPU-heavy.
- **Attack scenario:** An attacker (no valid token needed to trigger the hash for the
  pre-flight path order — note the pre-flight check at service.ts:149-156 actually rejects an
  unknown token *before* bcrypt, which limits this; the bcrypt runs only after a valid-looking
  unexpired token passes pre-flight) floods the endpoint. Even with the pre-flight guard, a
  single still-valid invite token (15-min window) can be hammered with concurrent registration
  attempts, each paying bcrypt, to exhaust CPU. 100 req/min global also means this endpoint can
  consume the entire global budget and starve other routes.
- **Evidence:** `routes.ts:83` (`config: { csrfExempt: true }`, no `rateLimit`); the only
  limiter is `app.ts:150-152`.
- **Remediation:** Add a strict per-route rate limit (e.g. `max:5, timeWindow:"1 minute"` keyed
  by IP) on `/register-with-invite`, `/invite-tokens/:token` (GET validate) and
  `/notifications/unsubscribe`. Keep the cheap pre-flight token check ahead of bcrypt (already
  done) and consider an IP-scoped limiter so one source cannot exhaust the global bucket.

### [MEDIUM] Email-spam amplification — authenticated user can mass-mail arbitrary external addresses with no per-user cap — A6-03
- **Severity:** Medium
- **Location:** `share/service.ts:1021-1070` (notifyRecipients), `share` remind flow,
  `reverse-share/service.ts:586-660` (notifyRecipients), `invite/routes.ts:39-58` (admin invite
  with recipient email)
- **OWASP:** A04:2021 Insecure Design (abuse of functionality / mailer-as-a-service)
- **Description:** Any authenticated share owner can attach arbitrary external recipient emails
  to a share/reverse-share and trigger `share_invitation` / `reverse_share_invitation` /
  `share_download_reminder` emails to them, with attacker-controlled `senderName`/`shareName`
  body content (escaped, so no XSS, but free-text). There is no per-user / per-time cap on how
  many invitation emails are enqueued, no recipient-count ceiling per share, and the global
  100/min limit is on HTTP requests, not on emails enqueued per request (one request enqueues
  N recipients). The configured SMTP relay becomes a spam/abuse vector and a reputation/blast-
  radius risk; the attacker also chooses the human-readable `senderName` text shown to victims.
- **Attack scenario:** A low-priv user creates a share, adds 500 external recipient addresses
  with `name`/`senderName` crafted as a phishing lure ("Your bank — verify now"), and calls the
  notify endpoint repeatedly. Each call enqueues hundreds of emails from your trusted domain.
- **Evidence:** `share/service.ts:1038-1053` enqueues per recipient using `senderName`
  (derived from the user's own profile name, attacker-settable) and `recipient.email`; no cap
  in the loop. Recipient list size is bounded only by request body size.
- **Remediation:** Per-user daily invitation/email quota (count enqueued non-critical external
  emails per user), a max-recipients-per-share ceiling, and an enqueue-rate cap independent of
  HTTP request count. Optionally require email-verification of the sending user before allowing
  external invitations.

### [MEDIUM] Invite registration trusts the registrant-supplied email; admin-targeted invite email does not bind the recipient — A6-04
- **Severity:** Medium
- **Location:** `invite/service.ts:116-124, 137-205`; `invite/routes.ts:39-58`
- **OWASP:** A01:2021 Broken Access Control (trust-boundary)
- **Description:** An invite token is **not bound to the email it was sent to.** When an admin
  generates a token with `email` (routes.ts:41), the link is emailed to that address, but the
  `InviteToken` row stores no `email`. At registration, `registerWithInvite` accepts **any**
  `email`/`username` the registrant supplies (dto.ts:28-35) and only checks global uniqueness
  (service.ts:158-171). So whoever obtains the token URL — not necessarily the intended invitee
  — can register under any identity. Combined with the 15-min TTL this is limited, but the
  invariant "the person who registers is the person we invited" does not hold.
- **Attack scenario:** Admin invites alice@corp. The invite email is forwarded / intercepted /
  the link is shoulder-surfed; Mallory opens it within 15 min and registers as
  `mallory@evil` (or as `alice`'s desired username), consuming the seat. The admin believes
  Alice registered.
- **Evidence:** `schema.prisma:499-509` — `InviteToken` has no `email` column;
  `service.ts:190-205` creates the user from `data.*` with no comparison to the invited email.
- **Remediation:** Store the invited `email` on the `InviteToken` row when provided, and at
  registration require `data.email === inviteToken.email` (case-insensitive). For open invites
  (no email), document that they are bearer tokens by design.

### [LOW] Unsubscribe token: long-lived (90d), idempotent, single shared secret, no revocation — A6-05
- **Severity:** Low
- **Location:** `email/unsubscribe-token.ts:11-12, 45-63`
- **OWASP:** A07:2021 (identification/authn weaknesses) — token lifecycle
- **Description:** Tokens live 90 days, carry no nonce/jti, are not single-use, and there is no
  revocation list. The same `JWT_SECRET`-derived key signs every user's token. A leaked
  unsubscribe link (email forwarding, mail-gateway logging, `Referer` leakage from the
  confirmation page to third-party assets, browser history) lets a third party unsubscribe that
  user from that one non-configurable... (correction: that one *configurable* non-critical)
  type for the full 90 days. Impact is bounded by the `unsubscribeUser` allowlist (critical/
  non-configurable types are no-ops), so confidentiality/integrity impact is low — it is a
  targeted denial of (one) notification stream.
- **Evidence:** `UNSUBSCRIBE_TOKEN_EXPIRY_SECONDS = 90*24*60*60` (line 12); no `jti`/usage
  tracking in `signUnsubscribeToken` (lines 45-63); `unsubscribeUser` upsert is idempotent
  (`notification/service.ts:130-134`).
- **Remediation:** Shorten TTL (e.g. 30 days), and/or include the user's `tokenVersion` or a
  per-user `unsubscribeNonce` in the payload so tokens can be invalidated. The action is
  low-impact, so this is defense-in-depth.

### [LOW] Unbounded email-job queue growth / retry & digest amplification (storage DoS) — A6-06
- **Severity:** Low
- **Location:** `email/service.ts:315-341`, `email/queue.ts:200-334`
- **OWASP:** A04:2021 Insecure Design (resource exhaustion)
- **Description:** `emailService.send()` inserts an `EmailJob` row for every enqueue with no
  global cap on pending rows. The worker drains only `BATCH_SIZE=10` every `interval` (~30s
  default) ≈ 20/min, so a burst of enqueues (see A6-03) grows the `EmailJob` table unbounded
  and lets the backlog outpace drain indefinitely. Failed jobs are retried with backoff
  (queue.ts:294-306) and `digest_pending` jobs persist the full payload JSON (service.ts:329).
  Sent-job cleanup only runs hourly and only deletes `status:"sent"` (queue.ts:165-191) — failed
  and pending rows are never auto-pruned.
- **Attack scenario:** Combine with A6-03: enqueue tens of thousands of invitation jobs; SQLite
  table and disk grow without bound while the 20/min drain never catches up.
- **Evidence:** No `count()` ceiling before `emailJob.create` (service.ts:322); cleanup filters
  `status:"sent"` only (queue.ts:178-183).
- **Remediation:** Cap pending-queue depth (reject/drop with logging beyond a threshold), prune
  old `failed` rows on a schedule, and enforce the per-user enqueue cap from A6-03.

### [LOW] No `appUrl` / `appName` / `smtpFrom*` config validators — malformed base URL poisons all email links — A6-07
- **Severity:** Low
- **Location:** `email/url-builder.ts:12-16`, `config/config-validation.ts:146-214`
- **OWASP:** A05:2021 Security Misconfiguration
- **Description:** `validateConfigValue` has **no validator** for `appUrl`, `appName`,
  `smtpFromName`, or `smtpFromEmail` (the validator map at config-validation.ts:146-206 omits
  them; unknown keys are accepted as-is per the test at
  config-validation.test.ts:334). `getAppUrl()` only checks non-empty (url-builder.ts:14). So
  an admin (or anything that can write config) can set `appUrl` to a non-`http(s)` value or a
  wrong host. The HTML CTA/unsubscribe hrefs are saved by `safeHref` (base-layout.ts:67-82,
  scheme allowlist), but the **plain-text body** prints the raw URL with no scheme check
  (base-layout.ts:237, 254) and links built for `reset-password`/`invite` are interpolated
  raw into query strings.
- **Attack scenario:** Mostly an admin-trust / footgun issue (admin-only config). A wrong/hostile
  `appUrl` silently sends every user a link to the wrong origin. Becomes higher impact if any
  lower-priv path can write config.
- **Evidence:** Absent keys in `configValueValidators` (lines 146-206); raw URL in plaintext
  renderer (base-layout.ts:237 `${slots.cta.url}`, line 254 `${slots.unsubscribeUrl}`).
- **Remediation:** Add a validator for `appUrl` requiring a parseable `http(s)://` origin with no
  path/CRLF; validate `smtpFromEmail` as an email and CRLF-strip `smtpFromName`/`appName`.

### [LOW] Invite-token validate endpoint enables existence oracle / unthrottled probing — A6-08
- **Severity:** Low
- **Location:** `invite/routes.ts:61-81` (`GET /invite-tokens/:token`)
- **OWASP:** A01 / A04
- **Description:** The validate endpoint returns distinct `{valid|used|expired}` states and has
  no per-route rate limit (only the global 100/min). With 256-bit tokens brute force is
  infeasible, so the practical risk is low, but it is an unauthenticated, unthrottled oracle
  that also feeds the bcrypt path indirectly.
- **Evidence:** No `config.rateLimit` on the route (lines 61-81).
- **Remediation:** Add a strict per-route IP rate limit (shared with A6-02 remediation).

### [INFO] Unsubscribe GET/POST render server HTML with correct escaping — verified safe — A6-09
- **Severity:** Informational
- **Location:** `notification/routes.ts:95-157, 228-320`
- **Description:** The public unsubscribe pages embed `token`, `type`/`displayName`, and `lang`
  via `escapeHtml` / the HTML-escaping `tr` (e.g. lines 97, 108, 111, 132). The `displayName`
  comes from the catalog, `type` from the verified token. No reflected/stored XSS sink found.
  The POST is correctly `csrfExempt` + permissive body (`passthrough`) to support RFC 8058
  one-click, and reads the token from body or query (lines 286-296). `formbody` is registered
  (app.ts:183) so the HTML form POST parses. This matches RFC 8058 and is implemented safely.

### [INFO] Email header injection / template injection — verified mitigated — A6-10
- **Severity:** Informational
- **Location:** `email/service.ts:26-32, 284-301`; `email/i18n/loader.ts:308-337`;
  `email/templates/base-layout.ts:67-82, 108-204`; `email/transport.ts:111-143`; all DTOs
- **Description:** (a) Subjects: every interpolated value (incl. `appName`, `senderName`,
  `shareName`) is CRLF-stripped via `sanitizeForSubject` before `t(... )` builds the subject
  (service.ts:286-293). (b) Recipients: `to` is always a `z.email()`-validated address
  (share/dto.ts:10-13, reverse-share, invite dto.ts:4-7, notification test `z.email()`), so no
  extra-recipient / BCP injection through `to`. (c) `from` is `{name, address}` from admin
  config — nodemailer encodes the display name. (d) HTML bodies: user values flow through
  `createTranslationFn`→`tHtml`→`interpolate(..., htmlEscape=true)` which `escapeHtml`s each
  substituted value (loader.ts:317-321); only developer-controlled template markup is raw.
  (e) hrefs (CTA/unsubscribe) pass `safeHref` scheme allowlist (base-layout.ts:67-82). No CRLF
  header injection, no extra-recipient injection, and no HTML/email XSS sink was found in the
  email render path.

---

## Tested-and-OK

- **Host-header poisoning of emailed reset/invite/share/unsubscribe links** — NOT exploitable:
  all link builders use `getAppUrl()` (config), never `request.host` (`url-builder.ts`).
- **Unsubscribe JWT forgery / alg-confusion / `none`** — blocked: `alg==="HS256"` check
  (`unsubscribe-token.ts:87`), purpose-derived key, timing-safe compare, `exp` enforced.
- **Unsubscribe token disabling critical mails (password_reset/welcome)** — blocked by the
  `isCritical` / `!configurable` no-op allowlist (`notification/service.ts:112-135`).
- **Invite single-use / TOCTOU double-accept** — blocked by atomic `updateMany` claim with
  `usedAt:null, expiresAt>now` guard inside a transaction (`invite/service.ts:178-188`).
- **Privilege escalation via invite (admin-by-token)** — not possible: role is hardcoded
  `isAdmin:false`; token carries no role (`invite/service.ts:197`).
- **Open invite creation by non-admins** — blocked: `POST /invite-tokens` requires
  `createAdminPreValidation({allowSetupBypass:false})` (`invite/routes.ts:38`).
- **Notification preference IDOR** — not present: GET/PUT prefs and the email-stats/test routes
  are scoped to `request.user.userId` or admin-gated (`notification/routes.ts:183-223, 322-406`).
  `updateUserPreferences` validates type/configurable/frequency (`notification/service.ts:65-98`).
- **Stored XSS via notification content into web UI** — n/a: the in-app "notifications" are
  scheduler-driven emails to the resource owner only; bodies are HTML-escaped; no user-authored
  notification text is stored and rendered raw.
- **Email recipient (`to`) injection / extra recipients / BCP** — blocked by `z.email()` at
  every DTO boundary feeding `emailService.send({ to })`.
- **Open redirect via unsubscribe** — n/a: the unsubscribe pages contain no redirect; they
  render static localized HTML.
- **Frontend invite acceptance XSS** — clean: `register-with-invite/[token]/page.tsx` and
  `register-form.tsx` use the token only as a prop / query key; no `dangerouslySetInnerHTML`,
  no reflection into HTML.
- **Path traversal via locale** — blocked: `LOCALE_PATTERN` rejects `.`/`/`/`\`/NUL before the
  locale is joined into a file path (`email/i18n/loader.ts:23, 231`).
- **Email queue worker job locking / double-send** — guarded by `updateMany` status-guard lock
  (`queue.ts:233-247`).
