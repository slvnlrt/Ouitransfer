# Bug Report

> Bugs discovered during testing and development.
> **Voir aussi :** [`TECHNICAL-DEBT.md`](TECHNICAL-DEBT.md) — dettes techniques · [`SECURITY.md`](SECURITY.md) — findings sécurité
>
> All resolved bugs are archived:
> - B-1 through B-20: `features/archive/BUGS-2026-05.md`
> - B-21 through B-25: `features/archive/BUGS-2026-05-31.md`

## Open

### B-28: Share password update returns 404 — PATCH/PUT method mismatch

- **Severity**: High (feature broken in production)
- **Files**: `apps/web/src/http/endpoints/shares/index.ts:140`
- **Description**: The frontend calls `PUT /api/shares/:id/password` but the server route declares `PATCH /shares/:shareId/password`. Fastify treats unknown method+URL combinations as 404. The reverse-share equivalent is consistent (`PUT` on both sides) — only shares is affected.
- **Fix**: Changed `apiInstance.put(...)` → `apiInstance.patch(...)` in `shares/index.ts`.
- **Status**: Fixed (2026-06-10)

### B-29 (gap): Authenticated Ouitransfer users not identified in share activity log

- **Severity**: Low — UX/tracking gap, no security impact
- **Description**: When a user is logged into Ouitransfer and accesses a share via `GET /shares/:shareId`, two things happen:
  1. If they are the **owner**, they bypass the password check entirely (intentional — owners manage their own shares). But no `ShareVisit` is created for them, so they don't appear in the share's activity log at all.
  2. If they are a **non-owner authenticated user**, they still need to enter the password (correct), but after access their identity is not linked to the visit — they show as "anonymous" in the activity log even though their `userId` is known from the JWT.
- **Root cause**: `getShare` returns early for owners before visit tracking runs. For non-owners, the visit tracking uses `ShareVisit.identificationSource` which only supports `"token" | "self_declared" | null` — there is no `"authenticated_user"` source, and `userId` is not stored on `ShareVisit`.
- **Fix**: Would require storing the `userId` on `ShareVisit` and surfacing it in the activity UI. Non-trivial schema change. Deferred.
- **Status**: Open — tracked for a future session

## Resolved (recent)

### B-30: CORS rejection returns 500 instead of 403 — RESOLVED

- **Severity**: Medium — mauvaise UX (message "An unexpected error occurred" au lieu d'une erreur CORS explicite)
- **File**: `apps/server/src/app.ts`
- **Description**: Quand une requête arrive depuis une origine non autorisée, le callback CORS appelait `cb(new Error("Not allowed by CORS"), false)`. Cette `Error` générique remontait dans le `globalErrorHandler` qui ne la reconnaît pas comme une `AppError` → retournait 500 au lieu de 403. Le frontend affichait alors "An unexpected error occurred" au lieu d'un message CORS. Symptôme le plus visible : le **login** (un POST → le navigateur envoie un en-tête `Origin`) tombe en 500 depuis un host non listé dans `CORS_ORIGINS`, alors qu'un GET sans `Origin` passe.
- **Reproduced**: Accès depuis un internal host (`OUITRANSFER_INTERNAL_HOST`) non listé dans `CORS_ORIGINS` (qui ne contenait que l'origine externe).
- **Fix**: Remplacé `cb(new Error(...), false)` par `cb(new ForbiddenError("Origin not allowed by CORS policy"), false)` → le `globalErrorHandler` mappe l'`AppError` sur un **403** (code `FORBIDDEN`). Ajout de 2 tests d'intégration `app.inject` (preflight OPTIONS : origine non listée → 403 ; allow-list séparée par virgule → 204 + en-tête `access-control-allow-origin`). Clarifié la doc multi-origines (`.env.docker.example`, `docker-compose.yaml`) : `CORS_ORIGINS` accepte une liste séparée par virgule et doit lister **tous** les hostnames servis (interne ET externe).
- **Status**: Resolved (branch `claude/nice-brown-gr9vp1`)

### B-26: TOCTOU race condition on invite token single-use enforcement — RESOLVED

- **Severity**: Medium
- **File**: `apps/server/src/modules/invite/service.ts`
- **Description**: `validateInviteToken` checked `usedAt` is null, then the `$transaction` did an unconditional `inviteToken.update({ data: { usedAt } })`. Two concurrent requests with the same valid token could both pass validation and both create users before either set `usedAt` — the single-use guarantee was not enforced atomically.
- **Fix**: Token consumption is now atomic inside the transaction via `updateMany({ where: { token, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: new Date() } })`; if `count === 0` the request re-reads the row and throws the precise structured error (`INVITE_TOKEN_USED` / `INVITE_TOKEN_EXPIRED` / `NOT_FOUND`) without creating a user. A fast-fail pre-flight check (before the bcrypt hash) is retained for friendly errors. Extracted pure `evaluateInviteToken()` (shared with the GET validate route) + `invalidInviteTokenError()`. Added 3 lost-race `app.inject` integration tests asserting no user is created when the claim matches 0 rows.
- **Status**: Resolved (branch `claude/project-onboarding-debt-oJkhn`)

### B-27: Container boot skips DB seeding → empty config → crash loop — RESOLVED

- **Severity**: Critical (server unbootable on a fresh volume)
- **Files**: `infra/server-start.sh`, `Dockerfile`, `knip.json`; deleted `infra/check-missing.js` / `infra/configs.json` / `infra/providers.json`; `apps/server/prisma/seed.js` (thin runner) + new `apps/server/src/db/seed-data.ts` (extracted, added to `package.json` `files`) + `apps/server/src/__tests__/seed.integration.test.ts`
- **Introduced by**: TD-48 (`abeff4c`) — reworked the boot to route ALL seeding through a `NEEDS_SEEDING` gate, removing the previous unconditional fresh-DB seed.
- **Description**: `server-start.sh` seeded only when `NEEDS_SEEDING=$(... check-missing.js check-seeding 2>/dev/null || echo "true")` equalled `"true"`. `check-missing.js` calls `dotenv.config()`, and dotenv v17 prints a banner to **stdout**, so the capture became `"<banner>\ntrue"` and the exact `= "true"` match failed → seed skipped → `app_configs` empty → server crash-loops on the first missing config key (`passwordMinLength`, `auditRetentionDays`, `autoCleanupEnabled`, …). Caught by the release-validation gate (`e2e.yml`) only at tag time, so it sat undetected on `main` between releases. Two latent issues compounded it: the seed/check scripts importing `../src/...` (only resolvable via tsx + shipped `src/`), and `infra/configs.json` (the check's hand-maintained key checklist) having silently drifted 26 keys behind `seed.js`.
- **Fix**: Seeding is idempotent ("protected mode"), so `server-start.sh` now runs it **unconditionally** on every boot (backfills new keys, self-heals partial seeds, fails loudly instead of silently). Removed the `check-missing.js` gate + the hand-maintained `configs.json`/`providers.json` checklists entirely. Extracted seed data/logic into `src/db/seed-data.ts` (typed, side-effect-free) with `prisma/seed.js` a thin `dotenv({ quiet: true })` runner. Added `seed.integration.test.ts` (completeness + idempotency) so the boot contract is covered in fast PR CI.
- **Status**: Resolved (branch `claude/fix-docker-seed-boot`)
