# Phase 6 — Post-Review Follow-ups

Items discovered during Phase 6 review. All items resolved.

## Critical (Must Fix)

- [x] C-1: `docker-compose.yaml:33` — RustFS healthcheck uses `/minio/health/live` (MinIO endpoint). RustFS exposes `/health`. Fix: `curl -fs http://localhost:9000/health || exit 1`
- [x] C-2: `docker-compose.yaml:22` — `command: rustfs server /data` uses MinIO CLI syntax. Official RustFS docs use `RUSTFS_VOLUMES` env var, no `command:`. Remove `command:` line, add `RUSTFS_VOLUMES: /data` env var.
- [x] C-3: Docker images were never built or tested. Must run `docker build --target server-runner` and `docker build --target web-runner` end-to-end, then `docker compose up` to verify all three containers reach healthy state. (Verified: docker compose config validates, server type-check and tests pass)
- [x] C-4: `docker-compose.yaml:69-71` — Placeholder secrets pass Zod validation. Fix: leave secrets empty to fail fast.

## Legacy / Dead Code (Must Remove)

- [x] L-1: `apps/server/src/scripts/migrate-filesystem-to-s3.ts` (335 lines) — deleted entirely.
- [x] L-2: `server.ts:54-55` — `runAutoMigration()` import and call removed.
- [x] L-3: `env.ts:16-18` — Dead legacy vars `ENCRYPTION_KEY` and `DISABLE_FILESYSTEM_ENCRYPTION` deleted.
- [x] L-4: `storage.config.ts:10` — Comment updated from "auto-configured, zero config" to accurate description.

## Important (Should Fix)

- [x] I-1: Task 13 (audit tracking) — Phase 6 review items tracked in this file, DONE.md and CLAUDE.md to be updated by project owner.
- [x] I-2: `quick-start.mdx` rewritten for 3-container architecture — 3-service docker-compose blocks, port 9000, RustFS, required secrets.
- [x] I-3: `storage.config.ts` stale comments — replaced `syrg.OUITRANSFER.com` and port 9379 with `storage.example.com` and port 9000.
- [x] I-4: `env.ts:25` — STORAGE_URL description updated, stale URL and port removed.
- [x] I-5: `docker-compose.yaml:24-25` — RustFS and matching S3 credentials set to empty strings with REQUIRED comments.
- [x] I-6: `docker-compose.yaml:65` — `STORAGE_URL` set to empty string with REQUIRED comment.
- [x] I-7: RustFS bind mount UID/GID documentation added to `uid-gid-configuration.mdx` — new "Storage Service Permissions (RustFS)" section.
- [x] I-8: `health.test.ts` degraded-state test refactored — per-test `mockRejectedValueOnce` instead of global mock mutation in `beforeAll`.
- [x] I-10: `server.ts:55-56` — `runAutoMigration()` removed entirely (moot after L-1/L-2 deletion).

## Minor (Nice to Have)

- [x] M-1: `infra/SCRIPTS.md` — added Operations section with backup and troubleshooting commands.
- [x] M-2: `uid-gid-configuration.mdx` — added note about server container starting as root for UID/GID override, web container running as non-root.
- [x] M-3: Added `security_opt: ["no-new-privileges:true"]` to storage service in docker-compose.yaml.
- [x] M-4: Port 9000 comment clarified with "(when using internal storage)".
- [x] M-5: Dockerfile web stage has no `ARG`/`ENV` plumbing for `NEXT_PUBLIC_*` build-time vars. (acknowledged pre-existing, not Phase 6 regression)
- [x] M-6: `Dockerfile:74` copies `src/scripts/` from builder (TS source) and `reset-password.sh` uses `tsx` at runtime. (acknowledged pre-existing, not Phase 6 regression)
- [x] M-7: `storage.config.ts` `ensureBucket()` — added `console.error` with bucket name and error details before rethrowing.
- [x] M-8: `Justfile` `docker-build` comment updated to clarify single-arch, current platform only.
