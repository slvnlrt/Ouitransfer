# Red Team 2026 — Closure Report

**Engagement:** Full offensive-security audit of Ouitransfer (Fastify/Prisma server, Next.js web,
Docker infra) followed by complete remediation.
**Outcome:** All 108 findings across 8 domains remediated. Branch
`claude/app-red-team-audit-7kabwh`.

## Phase 1 — Red team (8 parallel Opus agents, read-only)
Each produced a written report in `audit/red-team-2026/`:
- `A1-auth-session.md`, `A2-access-control.md`, `A3-file-storage.md`, `A4-sharing-public.md`,
  `A5-oauth-ldap.md`, `A6-email-invite-ssrf.md`, `A7-web-frontend.md`, `A8-infra-config-deps.md`

**Findings: 108 total — 10 Critical · 21 High · 34 Medium · 29 Low · 14 Info.**

### The 10 Criticals (all fixed)
1. Reverse-share multipart `objectName` injection → cross-tenant S3 write/abort/enumerate (A3-01/A4-01)
2. Magic-byte/MIME validation fail-open → unrestricted dangerous-content upload (A3-02)
3. Share download bypassed all lifecycle gates (expiry/maxViews/pause/owner-inactive) (A4-02)
4. OIDC `id_token` never verified — userinfo blindly trusted (A5-01)
5. OAuth account takeover via unverified-email auto-linking (A5-02)
6. OAuth `state` client-supplied, not single-use, not browser-bound → login CSRF + replay (A5-03)
7. Lockout & rate-limit bypass + audit-log poisoning via spoofable `X-Real-IP`/`X-User-Agent` (A1-01/A8-02)
8. Weak default signing secrets shipped in `docker-compose.yaml` → admin JWT forgery (A8-01)

(8 unique Criticals; 10 raw counting the two cross-corroborated duplicates.)

## Phase 2 — Remediation (7 sequential Opus implementer batches)
Plan: `audit/red-team-2026/REMEDIATION-PLAN.md` (80 tracked items, all checked).

| Batch | Domain | Key outcomes |
|---|---|---|
| R1 | Storage/upload integrity | multipart objectName validation, MIME fail-closed + dangerous-ext denylist, HEAD size reconciliation, reverse-share quota/TOCTOU, folder objectName guard, SSRF-guard util, sharp pixel caps, bidi-strip |
| R2 | Download/share access control | opaque per-share file token + `assertShareAccessible` lifecycle gate, forced attachment + proxy CSP, per-share password lockout, metadata gating, add-items IDOR fix, recipient-stats hardening |
| R3a | 2FA / trusted-device / secrets-at-rest | X-Real-IP fix + per-IP throttle, 2FA-verify lockout, TOTP replay protection, cookie-secret trusted devices, 2FA enable re-auth, encrypted TOTP secret + hashed backup codes, HKDF challenge |
| R3b | Login/password/session + admin authz | no-enumeration forgot-password, 12-char/72-byte/complexity policy, constant-time login, await+tokenVersion logout, last-admin protection, setup-bypass restriction, isAdmin removed from register |
| R4a | OAuth/OIDC | id_token JWKS verification (iss/aud/exp/nonce, alg allowlist), no email auto-link (+`emailVerified`), browser-bound single-use state/nonce/PKCE, server-fixed redirect_uri, SSRF-guarded IdP fetches, always-PKCE |
| R4b | LDAP/AD | SSRF egress guard + generic test errors, LDAPS/StartTLS enforcement, directory-attribute sanitization, canonical appUrl validation |
| R5 | Email/invite/notification | per-route IP rate limits, per-user email spam quota + recipient caps, email-bound invites, unsubscribe revocation, queue depth cap, central appUrl/smtp config validators |
| R6 | Web frontend | footerUrl scheme validation + rel=noopener, nonce-based CSP + hardened directives, no-wildcard storage origins, canonical OG host, window.open noopener, dropped reflected login message |
| R7 | Infra/config/deps/logging | fail-fast compose secrets + prod placeholder/entropy gate, RustFS console off + localhost bind, 4xx genericization, Pino redaction, CORS null-origin block, admin-gated docs/health, container hardening (no-new-privileges/cap_drop/USER/read_only), pinned image tags, HSTS preload, Renovate security-dep exclusions, env-var wiring |

## Final verification (green)
- Server type-check ✅ · Web type-check ✅
- Server tests: **1839 passing** (was 1642 baseline; +197 incl. new security integration tests)
- Web tests: **397 passing** (net of A8-11 intentional health-UI behavior change)
- Biome lint ✅ · Knip ✅ · `next build` ✅ · Prisma migrations apply on fresh DB ✅
- Dev env boots; production secret gate active

## New schema / migrations
`add_last_totp_step`, `trusted_device_per_user_unique`, `add_user_email_verified`,
`r5_email_invite_hardening` (InviteToken.email, EmailJob.senderUserId).

## New required env var
`ENCRYPTION_SECRET` (≥32, distinct) — now required (encrypts TOTP secrets + LDAP bind password).
Optional SSRF opt-ins documented: `S3_ALLOW_PRIVATE_ENDPOINT`, `OAUTH_ALLOW_PRIVATE_ENDPOINT`,
`STORAGE_ALLOWED_HOSTS` / `OAUTH_ALLOWED_ENDPOINT_HOSTS` / `LDAP_ALLOWED_HOSTS`, and web `APP_URL`
for canonical metadata.

## Owner-requested adjustments (post-remediation review)
Several remediations were product/ops decisions; the owner reviewed and adjusted them:
- **`/health/status`**: relaxed from admin-only to **authenticated** (any logged-in user) — keeps the
  unauthenticated-probe vector closed while restoring the user-facing email/notifications indicator.
- **LDAP transport**: **no longer forces LDAPS/StartTLS** — the admin decides; cleartext/`tlsSkipVerify`
  are warned, not blocked. Egress now blocks only cloud-metadata (private DCs work by default);
  `LDAP_ALLOW_PRIVATE_HOST` removed, `LDAP_ALLOWED_HOSTS` kept as optional lockdown.
- **API docs (`/swagger`,`/docs`)**: **admin gate removed** — they remain off by default and gated
  by the `ENABLE_API_DOCS` opt-in (the operator's choice); strict API-JSON CSP + scoped docs CSP kept.
- **Image tags**: **reverted to `:latest`** (placeholder version tags were unpublished; maintainer
  preference). Pin to a version/digest for reproducible deploys when releases are cut.
- **RustFS port**: default compose publishes `9000:9000` again (LAN browser uploads); internet-facing
  deployments bind `127.0.0.1` + reverse-proxy (Traefik example).
- **Kept after review**: logout-all-sessions, password policy (12 + complexity), email spam caps,
  alias min length 8, CORS null-origin block, container hardening.

## Follow-up notes (non-blocking)
- `bcryptjs@3` upgrade intentionally deferred to a dedicated dependency PR (cost-12 hardening applied
  now; Renovate excludes the lib from automerge so the bump is human-reviewed).
- Pre-existing cross-file test-isolation flake in `storage-ensure-bucket.test.ts` (passes in isolation
  and on re-run; not introduced by this work) — optional follow-up to reset shared mocks between files.
