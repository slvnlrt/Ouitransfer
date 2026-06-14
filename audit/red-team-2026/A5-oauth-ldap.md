# Red Team Report — A5: OAuth/OIDC & LDAP

## Summary

The OAuth/OIDC subsystem (`apps/server/src/modules/auth-providers/`) is **fundamentally broken from a token-trust standpoint**. The service treats OAuth like a username/password proxy: it exchanges the authorization code for tokens, then issues the application session purely on the basis of the `userinfo` endpoint response. **The `id_token` is never validated** (no signature / `iss` / `aud` / `exp` / `nonce` checks — there is no JWT verification anywhere in the module), and **no `nonce` is ever generated or sent**. Combined with a `state` value that is **client-supplied and never single-use / never expiry-checked**, and **account linking by email with no `email_verified` enforcement** (the `User` model has no `emailVerified` column at all), the flow is exposed to account takeover, login CSRF, and code/session replay.

The LDAP subsystem (`apps/server/src/modules/ldap/`) is in considerably better shape: search filters use `ldapts` typed filter objects (RFC 4515-escaped), attribute names are regex-allowlisted at both the DTO and client layers, and bind credentials are stored with AES-256-GCM (random IV, auth tag). The remaining LDAP risks are configuration-driven: `tlsSkipVerify` / plaintext `ldap://` allow MITM of bind credentials, and there is **no SSRF guard** on the admin-controlled `serverUrl` / OAuth `issuerUrl` / discovery / token / userinfo URLs (relevant because the OAuth provider endpoints are reachable by an admin and, via PUT, by anyone who can hit the admin-protected route). LDAP attribute values flow unsanitized into stored user fields (`firstName`/`lastName`/`displayName`), seeding stored-XSS payloads consumed by the frontend.

**Severity counts:** Critical: 3 | High: 4 | Medium: 4 | Low: 2 | Info: 1

The three most serious issues are **A5-01 (ID token never verified — userinfo blindly trusted)**, **A5-02 (account takeover via unverified-email linking)**, and **A5-03 (state not single-use, not expiry-validated, and attacker-supplied → replay + login CSRF)**.

---

## Flow notes

### OAuth/OIDC flow (trust boundaries)

1. **Initiate** — `GET /api/auth/providers/:provider/authorize` (`routes.ts:493-531`). Accepts **client-controlled `state` and `redirect_uri` query params** (`routes.ts:504-519`). `getAuthorizationUrl` (`service.ts:203-241`) uses `state || generateState()` — so the caller can **fix the state value**. `redirect_uri` is used verbatim as the OAuth `redirect_uri` AND stored as `pendingState.redirectUrl` (`service.ts:218-226`).
2. **PKCE** — `setupPkceIfNeeded` (`oauth-flow.service.ts:149-162`) only generates a verifier when `provider.type === "oidc"`. For `oauth2` providers there is **no PKCE**. The `code_challenge` is sent (`oauth-flow.service.ts:186-189`) but PKCE provides no protection here because state is replayable (see A5-03).
3. **Pending state store** — in-memory `Map` (`service.ts:30`), 10-minute TTL (`service.ts:19`), swept by a 5-minute `setInterval` (`service.ts:34-35, 315-322`). **Single in-process map → breaks under multi-instance / horizontal scaling**, and entries are **never deleted on use**.
4. **Callback** — `GET /api/auth/providers/:provider/callback` (`routes.ts:533-638`). `handleCallback` (`service.ts:243-283`): `validateAndGetPendingState(state)` (`service.ts:67-75`) **only does `.get()`** — no `.delete()`, **no `expiresAt` check**. The "Invalid or expired state" message is misleading; expiry is enforced only by the periodic sweep.
5. **Token exchange** — `executeTokenRequest` (`oauth-flow.service.ts:194-248`). Checks only `tokens.access_token` presence (`oauth-flow.service.ts:243-245`). **`id_token` is ignored entirely.**
6. **Userinfo** — `fetchUserInfo` (`oauth-flow.service.ts:250-271`) GETs the userinfo endpoint with the access token and **returns the JSON as ground truth**. `email_verified` is never read.
7. **User lookup/link/create** — `UserLinkingService.findOrCreateUser` (`user-linking.service.ts:11-58`): matches by `(providerId, externalId)`, else **by email** (`user-linking.service.ts:29`), and if found **links the OAuth identity to that pre-existing account** (`user-linking.service.ts:42-47`) with **no verification that the IdP-asserted email is verified or that it is owned by the OAuth subject**.
8. **Session issue** — `signAndSetCookies` (`routes.ts:593`) mints the JWT + refresh cookie. New OAuth users are always created with `isAdmin: false` (`user-linking.service.ts:159`) — good; `adminEmailDomains` is stored but never used for privilege assignment (Tested-and-OK).

**Trust boundaries violated:** (a) IdP token authenticity (no signature verification); (b) email ownership (linking on unverified email); (c) request authenticity / replay (state not bound to browser session, not single-use, not expiry-checked, attacker-supplied).

### LDAP flow (trust boundaries)

1. **Config** — admin-only `PUT /admin/ldap/config` (`routes.ts:66-163`). `serverUrl` is a free string (`dto.ts:23`); bind password AES-256-GCM-encrypted before storage (`routes.ts:101`, `encryption.ts:20-30`).
2. **Connect/bind** — `LdapClient.connect` (`ldap.client.ts:60-67`): TLS verification governed by `useTls` + `tlsSkipVerify` (`ldap.client.ts:63`). Plaintext `ldap://` or `tlsSkipVerify:true` → bind DN + password exposed/MITM-able.
3. **Search** — `searchSyncGroupMembers` (`ldap.client.ts:69-119`): filter built from `EqualityFilter`/`AndFilter` (escaped), attribute names re-validated (`ldap.client.ts:76-78`). **No injection sink.**
4. **Sync** — `performSync`/`processAdUser`/`createNewUser` (`sync.service.ts:161-427`): AD attribute values (`email`, `displayName` → `firstName`/`lastName`) written to the DB unsanitized; group membership (`memberOf`) maps to local `groupId` (`sync.service.ts:248-249`).

**Trust boundaries violated:** (a) transport confidentiality (optional TLS / skip-verify); (b) network egress (no SSRF allowlist on `serverUrl`); (c) LDAP attribute values trusted as safe display strings.

---

## Findings

### [Critical] ID token never verified — userinfo response blindly trusted — ID A5-01
- **Severity:** Critical
- **Location:** `apps/server/src/modules/auth-providers/oauth-flow.service.ts:243-271`; `service.ts:259-272`
- **OWASP:** A07:2021 Identification and Authentication Failures (OIDC token validation)
- **Description:** After the code-for-token exchange, the service checks only that `access_token` exists (`oauth-flow.service.ts:243-245`) and then calls `fetchUserInfo`, whose JSON body is taken as the authoritative identity. The `id_token` returned in `TokenResponse` (`types.ts:58`) is **never parsed or verified** — there is no JWKS fetch, no signature check, no `iss`/`aud`/`exp`/`nonce` validation, and no `alg`-confusion guard anywhere in the module. `grep` confirms no `jwt.verify`, `jose`, or JWKS usage in `auth-providers/`.
- **Attack scenario:**
  1. The session is issued solely from the userinfo HTTP response. Any path that lets an attacker influence which userinfo endpoint is hit, or what it returns, yields a forged identity. For a generic/custom provider the token + userinfo endpoints are resolved from admin config or **OIDC discovery over plain `fetch` with no allowlist** (A5-08); a discovery document pointing the userinfo endpoint at an attacker-controlled host makes the IdP-asserted `sub`/`email` fully attacker-chosen.
  2. Because the `id_token` signature is never checked, a provider/proxy (or a MITM on a non-TLS issuer, A5-09) can assert an arbitrary `email`/`sub`; combined with A5-02 (email linking) this is direct account takeover.
- **Evidence:**
  - `oauth-flow.service.ts:243` `if (!tokens.access_token) { throw ... }` — the only token check.
  - `oauth-flow.service.ts:254-270` userinfo fetched and returned as `Record<string, unknown>`.
  - `service.ts:267-272` `processUserInfo(...)` → `findOrCreateUser(userInfo, ...)`; the `tokens.id_token` is passed nowhere.
- **Remediation:** For OIDC providers, treat the signed `id_token` as the source of truth. Fetch the provider JWKS (from discovery `jwks_uri`), verify the signature with an allowlisted asymmetric `alg` (reject `none` and HS* when an RS key is expected), and validate `iss` (== configured issuer), `aud` (== client_id), `exp`/`iat`, and `nonce` (== the value bound to this flow). Only fall back to userinfo for non-OIDC OAuth2, and even then over a verified TLS channel to a pinned endpoint.

### [Critical] Account takeover via unverified-email account linking — ID A5-02
- **Severity:** Critical
- **Location:** `apps/server/src/modules/auth-providers/user-linking.service.ts:29-48`
- **OWASP:** A07:2021 Identification and Authentication Failures (pre-account-hijacking / federated account takeover)
- **Description:** When no `(providerId, externalId)` match exists, `findOrCreateUser` looks the user up **by email** (`findExistingUserByEmail`, line 29) and, if a local account with that email exists, **links the OAuth identity to it and logs in as that user** (`linkProviderToExistingUser`, lines 42-47). There is **no check that the IdP marked the email as verified** — indeed the code never reads an `email_verified` claim, and the `User` schema has **no `emailVerified` field** (`prisma/schema.prisma:10-35`), so it cannot enforce one.
- **Attack scenario:**
  1. Victim has a local password account `victim@corp.com`.
  2. Attacker registers an account at an OAuth/OIDC provider that allows setting an arbitrary, unverified email (many self-hosted IdPs, and any custom provider an attacker can stand up and an admin adds), setting it to `victim@corp.com`.
  3. Attacker initiates SSO; the callback fetches userinfo (unverified, A5-01), finds the local `victim@corp.com` user, **links and authenticates as the victim** — full account takeover with no victim interaction.
  - Conversely, this also enables pre-hijacking: attacker links first, victim later logs in via the same email.
- **Evidence:** `user-linking.service.ts:29` `const existingUser = await this.findExistingUserByEmail(userInfo.email);`; `:42-47` link + return without any verification gate; `schema.prisma:10-35` no `emailVerified` column.
- **Remediation:** Never auto-link a federated identity to an existing local account on email alone. Require a verified-email claim from the IdP (`email_verified === true` in the **verified** id_token) **and** an explicit, authenticated link step (user must be logged in to the local account to connect an SSO identity), or send a verification challenge to the email before linking. Add an `emailVerified` column and persist provenance.

### [Critical] OAuth `state` is attacker-supplied, not single-use, and not expiry-validated — ID A5-03
- **Severity:** Critical
- **Location:** `apps/server/src/modules/auth-providers/service.ts:67-75, 216, 250`; `routes.ts:504-519`
- **OWASP:** A01:2021 (CSRF) / A07:2021
- **Description:** Three compounding defects:
  1. **Client-supplied state:** `/authorize` accepts a `state` query param (`routes.ts:504-509,519`) and `getAuthorizationUrl` uses `state || generateState()` (`service.ts:216`). An attacker can fix the state to a known value.
  2. **Not single-use:** `validateAndGetPendingState` (`service.ts:67-75`) does `pendingStates.get(state)` and **never deletes** the entry. The same `(state, code)` (or a replayed valid `state`) survives until the periodic sweep.
  3. **No expiry check at validation:** validation never compares `expiresAt`; expiry is enforced only by the 5-minute `setInterval` sweep (`service.ts:315-322`), so a state is honored well past its nominal TTL boundary, and the "Invalid or expired state" error never actually fires for an expired-but-unswept entry.
  - The state is also **not bound to the user's browser/session** (no cookie correlation) — it is a global server-side map keyed by the state string alone.
- **Attack scenario:**
  - **Login CSRF / forced login:** Attacker pre-creates a pending flow with a known `state`, captures their own provider authorization `code`, then tricks the victim's browser into hitting `/callback?code=<attacker_code>&state=<known>`. Because state isn't bound to the victim's session, the victim is silently logged into the **attacker's** account (classic OAuth login CSRF → the victim then uploads/shares files into an account the attacker controls).
  - **Replay:** A captured valid `(state, code)` pair can be replayed against the callback until the sweep removes it, since the entry is never consumed.
- **Evidence:** `service.ts:67-75` (no delete, no expiry compare); `service.ts:216` (`state || generate`); `routes.ts:519,576` (state taken from query and passed straight to `handleCallback`).
- **Remediation:** Generate `state` server-side only (drop the client `state` param), set it in an httpOnly cookie bound to the browser, and verify the callback `state` matches the cookie. Make pending states strictly single-use: `delete` on first lookup. Check `expiresAt < now` at validation time and reject. Tie each pending state to the originating session.

### [High] Open-redirect / `redirect_uri` injection via attacker-controlled callback URL — ID A5-04
- **Severity:** High
- **Location:** `apps/server/src/modules/auth-providers/service.ts:206, 218, 225, 296-297`
- **OWASP:** A01:2021 (Open Redirect) / OAuth redirect_uri manipulation
- **Description:** `/authorize` accepts a `redirect_uri` query param (`routes.ts:507,519`) that is used as **both** the OAuth `redirect_uri` sent to the IdP (`service.ts:218`) **and** stored as `pendingState.redirectUrl` (`service.ts:225`). The post-login redirect target therefore originates from attacker-controllable input. There IS a redirect allowlist applied at the very end of the callback (`routes.ts:614-619`, `isAllowedRedirectUrl`), which mitigates the final browser redirect — but the value is **also** echoed into the IdP authorization request as the OAuth `redirect_uri`, which is not validated against any allowlist here. If the configured IdP is permissive about redirect URIs, the authorization `code` can be delivered to an attacker endpoint (code interception). The token-exchange `redirect_uri` then uses `provider.redirectUri` or the computed base (`service.ts:296-297`), creating a potential mismatch the IdP may or may not catch.
- **Attack scenario:** Attacker crafts `/authorize?redirect_uri=https://evil.tld/...`; against a misconfigured/loose IdP the code is sent to `evil.tld`; attacker exchanges it (PKCE absent for oauth2 providers, A5-06) and logs in as the victim.
- **Evidence:** `routes.ts:519` extracts `redirect_uri`; `service.ts:218` `const callbackUrl = redirectUri || ...` used in `buildAuthorizationUrl`; `service.ts:225` stored as redirectUrl.
- **Remediation:** Do not accept `redirect_uri` from the client for the OAuth request. Always compute the callback URL server-side from a trusted base. Keep a separate, allowlist-validated "post-login return path" that may only be a relative path. Ensure the `redirect_uri` sent at authorize time and at token time are identical and server-fixed.

### [High] No SSRF protection on admin-controlled provider/LDAP URLs (discovery, token, userinfo, ldap host) — ID A5-05
- **Severity:** High
- **Location:** `apps/server/src/modules/auth-providers/oauth-flow.service.ts:118-147, 226, 254, 343`; `apps/server/src/modules/ldap/ldap.client.ts:60-67`; `dto.ts` (`issuerUrl`/`serverUrl` free-form)
- **OWASP:** A10:2021 Server-Side Request Forgery
- **Description:** OIDC discovery (`attemptDiscovery`, lines 118-147), token exchange (`fetch(endpoints.tokenEndpoint)`, line 226), userinfo (line 254), and GitHub-style email fetch (line 343) all perform `fetch()` to URLs derived from `provider.issuerUrl` / stored endpoints with **no allowlist and no private-IP/metadata-endpoint guard**. Likewise the LDAP client connects to an arbitrary `serverUrl`. These are admin-configured, but the configuration routes are reachable by anyone passing the admin pre-validation, and SSRF here lets the server be coerced into requesting internal services (cloud metadata `169.254.169.254`, internal admin panels, `localhost` services). The only egress allowlist in the codebase, `isAllowedRedirectUrl` (`redirect-validation.ts`), governs **browser** redirects, not these server-side fetches.
- **Attack scenario:** An admin (or an attacker who has obtained admin access — note the OAuth flaws above can yield admin if the first/seeded user uses SSO) creates a provider with `issuerUrl=http://169.254.169.254/latest/...` or an internal host; the server fetches it during discovery and leaks the response body into logs/error responses (`oauth-flow.service.ts:232-238` logs token error body).
- **Evidence:** `oauth-flow.service.ts:122` `fetch(discoveryUrl, ...)`, `:226` `fetch(endpoints.tokenEndpoint, ...)`, `:254` `fetch(endpoints.userInfoEndpoint, ...)`; `ldap.client.ts:61-66` `new Client({ url: config.serverUrl })`.
- **Remediation:** Resolve and validate all outbound host targets against an allowlist / deny private + link-local + loopback + metadata ranges before fetch/connect. Reject `http://` issuer URLs. Apply consistent DNS-rebinding-resistant validation (resolve, check IP, pin).

### [High] PKCE absent for `oauth2` providers — ID A5-06
- **Severity:** High
- **Location:** `apps/server/src/modules/auth-providers/oauth-flow.service.ts:149-162`
- **OWASP:** A07:2021 (authorization code interception)
- **Description:** `setupPkceIfNeeded` only emits a code verifier/challenge when `provider.type === "oidc"` (`oauth-flow.service.ts:153`). For providers configured as `oauth2` (an allowed enum value, `dto.ts:6`), **no PKCE** is used, so an intercepted authorization code (e.g. via A5-04 redirect manipulation, or a leaky referrer) can be exchanged by an attacker. Even for OIDC, PKCE's value is undermined by the replayable state (A5-03).
- **Evidence:** `oauth-flow.service.ts:153` `const needsPkce = provider.type === DEFAULT_PROVIDER_TYPE;` (`DEFAULT_PROVIDER_TYPE = "oidc"`).
- **Remediation:** Always use PKCE (S256) for the authorization-code flow regardless of provider type; it is harmless even where the IdP also requires a client secret.

### [High] LDAP bind credentials exposable via plaintext/skip-verify transport — ID A5-07
- **Severity:** High
- **Location:** `apps/server/src/modules/ldap/ldap.client.ts:60-67`; `dto.ts:23,35-36`; `schema.prisma:558-559`
- **OWASP:** A02:2021 Cryptographic Failures (in-transit) / A05 Misconfiguration
- **Description:** `connect` sets `tlsOptions` only when `useTls` is true, and even then honors `tlsSkipVerify` to disable certificate validation (`ldap.client.ts:63`). `serverUrl` is unconstrained (`dto.ts:23`), so `ldap://host` (cleartext) is accepted. With cleartext or skip-verify, the **bind DN and bind password are exposed to any network MITM** during every sync. Encryption-at-rest (GCM) is correct, but transport can leak the plaintext credential on the wire.
- **Attack scenario:** On-path attacker (or a malicious internal hop) between the app container and the DC captures the simple-bind credentials when `useTls:false` or `tlsSkipVerify:true`, gaining a privileged directory account.
- **Evidence:** `ldap.client.ts:63` `tlsOptions: config.useTls ? { rejectUnauthorized: !config.tlsSkipVerify } : undefined`; `dto.ts:36` `tlsSkipVerify: z.boolean().default(false)`.
- **Remediation:** Require LDAPS/StartTLS for any non-loopback host; reject `ldap://` to remote hosts. Treat `tlsSkipVerify` as a dev-only flag, warn loudly, and forbid it when `enabled` for non-private targets. Prefer StartTLS upgrade verification.

### [Medium] LDAP attribute values flow unsanitized into stored user fields (stored-XSS seed) — ID A5-08
- **Severity:** Medium
- **Location:** `apps/server/src/modules/ldap/sync.service.ts:245, 276-279, 346-357`; `ldap.client.ts:113-115`
- **OWASP:** A03:2021 Injection (stored XSS via directory data)
- **Description:** `displayName`/`email` from the directory are parsed (`parseDisplayName`, `sync.service.ts:436-455`) and written verbatim to `firstName`/`lastName`/`email` (`sync.service.ts:276-278, 350-353`). Directory attributes are attacker-influençable in environments where users can edit their own AD display name, so a payload like `<img src=x onerror=...>` is persisted and later rendered in admin user lists / dashboards. The server performs no output encoding here; safety depends entirely on every frontend consumer escaping.
- **Evidence:** `sync.service.ts:350-352` writes `firstName`/`lastName`/`email` straight from parsed AD values; no allowlist/encoding.
- **Remediation:** Validate/normalize directory-sourced strings on ingest (length caps, strip control chars), and ensure all render sites encode. Treat directory data as untrusted input.

### [Medium] Pending-state store is in-process only (multi-instance breakage / DoS surface) — ID A5-09
- **Severity:** Medium
- **Location:** `apps/server/src/modules/auth-providers/service.ts:30, 34-35, 227`
- **OWASP:** A04:2021 Insecure Design
- **Description:** Pending OAuth states live in a per-process `Map`. Behind any load balancer / multiple replicas, the callback may hit a different instance than the one that issued the state → flows fail, **or** operators "fix" it by disabling state validation. The map is also an unbounded growth surface (one entry per `/authorize` hit, attacker can pre-seed many with chosen `state` values per A5-03) until the 5-minute sweep.
- **Evidence:** `service.ts:30` `private pendingStates = new Map<...>()`; populated `service.ts:227`.
- **Remediation:** Move state to a shared store (signed cookie binding the state, or Redis) so it survives across instances and is naturally bounded; combine with the single-use + expiry fixes from A5-03.

### [Medium] OAuth provider error/userinfo bodies logged at error level — ID A5-10
- **Severity:** Medium
- **Location:** `apps/server/src/modules/auth-providers/oauth-flow.service.ts:232-238, 262-268`
- **OWASP:** A09:2021 Logging Failures (sensitive data in logs)
- **Description:** On token-exchange or userinfo failure the full response body is logged (`{ status, body: errorText }`). These bodies can contain tokens, codes, or PII from the IdP, and—combined with the SSRF in A5-05—can be used to exfiltrate internal-service responses into logs.
- **Evidence:** `oauth-flow.service.ts:234-237`, `:263-266`.
- **Remediation:** Log status + a redacted/truncated marker only; never log raw IdP bodies.

### [Medium] `useTls`/`tlsSkipVerify` test endpoint accepts arbitrary host with full credentials, no rate limit/SSRF guard — ID A5-11
- **Severity:** Medium
- **Location:** `apps/server/src/modules/ldap/routes.ts:165-202`
- **OWASP:** A10:2021 SSRF / A05 Misconfiguration
- **Description:** `POST /admin/ldap/test` binds to an arbitrary `serverUrl` with an admin-supplied password and reports `success`/`message` (error string surfaced, `ldap.client.ts:136`). This is a convenient SSRF/port-scan oracle (connect to internal hosts and read back the error text) for anyone past admin pre-validation, and the error text may leak internal topology.
- **Evidence:** `routes.ts:188-200` passes raw body to `client.testConnection`; `ldap.client.ts:132-137` returns `error.message`.
- **Remediation:** Apply the same egress allowlist/private-IP block (A5-05); return generic success/failure without raw connection error text.

### [Low] Generic field-mapping accepts `id`/`login` as subject → unstable external identity — ID A5-12
- **Severity:** Low
- **Location:** `apps/server/src/modules/auth-providers/providers.config.ts:289`; `githubConfig` `:142`
- **OWASP:** A04:2021 Insecure Design
- **Description:** The generic and GitHub mappings allow the external subject to come from mutable fields (`login`, `username`, etc.) rather than a stable immutable identifier. If a directory/provider recycles usernames, a new owner of a recycled `login` could collide with an existing `externalId` linkage.
- **Evidence:** `providers.config.ts:289` `id: ["sub","id","user_id","uid","userid","account_id"]`; `:142` `id: ["id","login"]`.
- **Remediation:** Bind to the immutable subject only (`sub` for OIDC, numeric `id` for GitHub); never fall back to mutable usernames for identity.

### [Low] `appUrl` welcome links built from admin config without integrity binding — ID A5-13
- **Severity:** Low
- **Location:** `apps/server/src/modules/ldap/sync.service.ts:394-405`
- **OWASP:** A04:2021
- **Description:** New LDAP users receive a password-set link built from `appUrl` (admin-set). A wrong/hostile `appUrl` sends valid reset tokens to a link pointing at an attacker host. Low because it requires admin misconfiguration, but the reset token is a credential.
- **Evidence:** `sync.service.ts:396` `buildResetPasswordUrl(resetToken)` using config `appUrl`.
- **Remediation:** Validate `appUrl` against a known canonical origin; warn when it differs from the request origin.

### [Info] Encryption key derivation uses unsalted SHA-256 of `ENCRYPTION_SECRET` — ID A5-14
- **Severity:** Info
- **Location:** `apps/server/src/modules/ldap/encryption.ts:6-14`
- **OWASP:** A02:2021
- **Description:** The AES key is `sha256(ENCRYPTION_SECRET)` with no KDF/salt. AES-256-GCM usage itself is correct (random 12-byte IV, auth tag stored/verified). Acceptable if `ENCRYPTION_SECRET` is high-entropy, but a low-entropy secret is directly brute-forceable, and the same derived key is reused for all records.
- **Evidence:** `encryption.ts:13` `crypto.createHash("sha256").update(secret).digest()`.
- **Remediation:** Derive via HKDF/scrypt with a salt; enforce a minimum secret length at boot.

---

## Tested-and-OK

- **LDAP search filter injection** — `searchSyncGroupMembers` uses `ldapts` `EqualityFilter`/`AndFilter` objects, which RFC 4515-escape values; the `syncGroupDn`/`searchBase` are DNs, not filter values. No string concatenation into a filter. (`ldap.client.ts:82-100`)
- **LDAP attribute-name injection / enumeration** — attribute names allowlisted by regex at the DTO (`dto.ts:4-11`) **and** re-checked in the client (`assertSafeAttributeName`, `ldap.client.ts:12-17, 76-78`).
- **LDAP credential encryption-at-rest** — AES-256-GCM with per-record random IV and authenticated tag; tampering is detected on decrypt. (`encryption.ts:20-53`)
- **LDAP bind password masking** — config reads return `MASKED_PASSWORD`, never the ciphertext or plaintext. (`routes.ts:50, 149`)
- **Anonymous/empty-password bind bypass** — `LdapTestSchema.bindPassword` requires `min(1)` (`dto.ts:49`); the sync path uses a stored, encrypted password. (No empty-bind auth path; LDAP here is sync-only, not an interactive auth bypass surface.)
- **OAuth admin-privilege escalation via `adminEmailDomains`** — `adminEmailDomains` is stored but never consulted during login; OAuth/LDAP-created users are always `isAdmin: false`. (`user-linking.service.ts:159`, `sync.service.ts` create path)
- **Final browser redirect on OAuth callback** — guarded by `isAllowedRedirectUrl` allowlist (same-origin / relative / known OAuth hosts). (`routes.ts:614-619`) — note this does **not** cover the OAuth `redirect_uri` itself (see A5-04).
- **Frontend callback pages** — do not set auth cookies via JS; rely on server-set httpOnly cookies and only verify session via `getCurrentUser`. (`auth/callback/page.tsx`, `auth/oidc/callback/page.tsx`)
- **LDAP sync concurrency** — single-flight mutex (`syncInProgress`) + chained `setTimeout` scheduler prevents overlapping syncs; stale "running" logs recovered on boot. (`sync.service.ts:37,59-63`; `sync.scheduler.ts:20-45,80-98`)
