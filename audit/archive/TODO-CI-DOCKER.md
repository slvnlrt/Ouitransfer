# TODO — CI/Docker Issues Found During Integration Testing

> Discovered while fixing CI workflows and Docker builds (May 2026)

---

## Server Lifecycle

- [x] **Add a server startup integration test** — `apps/server/src/__tests__/server-lifecycle.test.ts` (3 tests): full listen/close lifecycle, health endpoint after listen, onClose hooks fire on shutdown. Exercises Fastify 5's "no mutations after listen" rule that `app.inject()`-only tests never trigger.

- [x] **Audit all post-listen code paths** — Verified: zero post-listen mutations. All 24 `app.register()`, 3 `app.addHook()`, and 4 `set*()` calls occur before `app.listen()` on line 124 of `server.ts`. No route modules contain `addHook`/`decorate`/`addSchema`.

## Docker / Deployment

- [x] **`CORS_ORIGINS` in `docker-compose.yaml`** — Already present at line 81: `CORS_ORIGINS: ""  # REQUIRED: e.g., http://localhost:5487`. Also in `docker-compose.ci.yml:29` with test value.

- [x] **Prisma deprecation warning** — Migrated to `apps/server/prisma.config.ts`. Removed deprecated `"prisma"` key from `package.json`.

- ~~**`apps/server/package.json` still has `"author": "Ouitransfer"`**~~ — Cancelled (intentional).

## Frontend SSR

- ~~**Add a layout SSR smoke test**~~ — Dropped. Testing an async Server Component with 11 font mocks + deep provider tree in jsdom produces a fragile test with massive mock surface that essentially just checks JSX nesting order. The E2E Docker workflow (`e2e.yml`) already catches provider placement bugs (this is how the SkipToContent/Favicon bugs were found). Limitation: E2E detects the crash but doesn't pinpoint the root cause — accepted trade-off.
