# TODO — CI/Docker Issues Found During Integration Testing

> Discovered while fixing CI workflows and Docker builds (May 2026)

---

## Server Lifecycle

- [ ] **Add a server startup integration test** — The `addHook("onClose")` after `app.listen()` bug was invisible to unit tests because `app.inject()` never calls `listen()`. Add a test in `apps/server/src/__tests__/` that calls `startServer()` (or at minimum `app.listen()` + `app.close()`) and verifies the full lifecycle completes without errors. This catches any future violation of Fastify's "no mutations after listen" rule.

- [ ] **Audit all post-listen code paths** — Verify no other code in the server registers hooks, decorators, or plugins after `app.listen()` is called. Fastify 5 is strict about this. Search for any `app.addHook`, `app.decorate`, `app.register` that could execute after the listen promise resolves.

## Docker / Deployment

- [ ] **`CORS_ORIGINS` missing from `docker-compose.yaml` comments** — The server requires `CORS_ORIGINS` in production mode but the base `docker-compose.yaml` doesn't list it in the server environment section. Add it with a `# REQUIRED` comment like the other secrets so self-hosters don't hit a cryptic startup crash.

- [ ] **Prisma deprecation warning** — `The configuration property package.json#prisma is deprecated and will be removed in Prisma 7. Please migrate to a Prisma config file (e.g., prisma.config.ts)`. Low priority but should be addressed before Prisma 7.

- [ ] **`apps/server/package.json` still has `"author": "Burger&Cie"`** — Leftover from the original fork. Should be updated or removed.

## Frontend SSR

- [ ] **Add a layout SSR smoke test** — The `SkipToContent` (outside `NextIntlClientProvider`) and `Favicon` (outside `QueryProvider`) bugs were invisible in dev mode but crashed production SSR with opaque minified errors. Add a test that renders `RootLayout` server-side and asserts no errors are thrown. This catches components placed outside their required provider. In production, de-minifying chunk errors to find the root cause is impractical — this test surfaces the real error message immediately with a clear stack trace.
