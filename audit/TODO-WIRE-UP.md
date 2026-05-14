# Unconnected API Wrappers — Wire-Up TODO

These frontend API wrappers and server utilities exist and map to **active server endpoints**,
but are not yet consumed by any UI component. They were preserved during the knip audit because
the app was under active development when the refactor began — these are planned API surface,
not dead code.

**Goal**: Wire each function to a UI component or hook. Once connected, remove its knip suppression.

## Reverse Shares — `apps/web/src/http/endpoints/reverse-shares/index.ts`

| Function | Server Endpoint | Purpose | Wire-up Target |
|----------|----------------|---------|----------------|
| `getReverseShare` | `GET /reverse-shares/:id` | Get reverse share details | Admin detail view / edit modal |
| `getReverseShareForUpload` | `GET /reverse-shares/:id/upload` | Public upload page data | Upload page (currently uses `ByAlias` variant) |
| `getPresignedUrlForUpload` | `POST /reverse-shares/:id/presigned-url` | Get upload URL by ID | Upload flow (currently uses `ByAlias` variant) |
| `registerFileUpload` | `POST /reverse-shares/:id/register-upload` | Register completed upload by ID | Upload flow (currently uses `ByAlias` variant) |
| `checkReverseSharePassword` | `POST /reverse-shares/:id/check-password` | Verify password by ID | Password gate (currently uses `ByAlias` variant) |
| `activateReverseShare` | `POST /reverse-shares/:id/activate` | Activate a reverse share | Reverse share management table |
| `deactivateReverseShare` | `POST /reverse-shares/:id/deactivate` | Deactivate a reverse share | Reverse share management table |

**Note**: The `ByAlias` variants of `getPresignedUrlForUpload`, `registerFileUpload`, and
`getReverseShareForUpload` ARE consumed. The by-ID variants exist for admin/internal use.

### Orphaned Types (same file's `types.ts`)
- `DownloadReverseShareFileResult` — used by `downloadReverseShareFile` (connected), but type itself not imported directly
- `DeleteReverseShareFileResult` — used by `deleteReverseShareFile` (connected), but type itself not imported directly

## Two-Factor Auth — `apps/web/src/http/endpoints/auth/two-factor/index.ts`

| Function | Server Endpoint | Purpose | Wire-up Target |
|----------|----------------|---------|----------------|
| `verifyTwoFactorToken` | `POST /two-factor/verify` | Verify a 2FA token | 2FA login flow (may already use `completeTwoFactorLogin` instead) |

## App — `apps/web/src/http/endpoints/app/index.ts`

| Function | Server Endpoint | Purpose | Wire-up Target |
|----------|----------------|---------|----------------|
| `getSystemInfo` | `GET /app/system-info` | System info (storage, version) | Admin dashboard / system status page |
| `checkHealth` | `GET /health` | Health check | Status indicator / admin dashboard |
| `checkUploadAllowed` | `GET /app/check-upload` | Verify uploads are allowed | Upload flow pre-check |

## Config — `apps/web/src/http/endpoints/config/index.ts`

| Function | Server Endpoint | Purpose | Wire-up Target |
|----------|----------------|---------|----------------|
| `updateConfig` | `PUT /app/configs/:key` | Update single config | Settings page (currently uses `bulkUpdateConfigs`) |

## Shares — `apps/web/src/http/endpoints/shares/index.ts`

| Function | Server Endpoint | Purpose | Wire-up Target |
|----------|----------------|---------|----------------|
| `getShareFolderContents` | `GET /shares/:id/folders/:folderId` | Browse share folder tree | Share detail view with folder navigation |

## Users — `apps/web/src/http/endpoints/users/index.ts`

| Function | Server Endpoint | Purpose | Wire-up Target |
|----------|----------------|---------|----------------|
| `getUserById` | `GET /users/:id` | Get user details | Admin user detail view |
| `updateUserImage` | `PUT /users/:id/image` | Update user profile image | Profile / admin user edit |

### Orphaned Type
- `ListUsers200` — response type for `listUsers` (connected), but type itself not imported directly

## Server Utilities

### `apps/server/src/modules/config/service.ts`

| Function | Purpose | Wire-up Target |
|----------|---------|----------------|
| `setConfigValue` | Update a single config in DB | Used by `updateConfig` controller (check if controller uses it) |
| `getGroupConfigs` | Get all configs for a group | Settings page group display |

### `apps/server/src/config/storage.config.ts`

| Export | Purpose | Wire-up Target |
|--------|---------|----------------|
| `isS3Enabled` | Boolean flag for S3 availability | Health check, conditional UI rendering |

### `apps/web/src/hooks/use-secure-configs.ts`

| Hook | Purpose | Wire-up Target |
|------|---------|----------------|
| `useSecureConfigs` | Fetch secure (admin-only) configs | Admin settings pages |

## Knip Pre-commit Hook

A `knip` pre-commit command is prepared but **commented out** in `lefthook.yml`.
Once all items in this file are resolved and `pnpm knip` exits 0, uncomment it:

```yaml
# In lefthook.yml, under pre-commit.commands:
    knip:
      run: pnpm knip
```

When a function is wired up, remove it from this file. When the file is empty, activate the hook.
